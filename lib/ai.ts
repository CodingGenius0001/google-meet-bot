const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "his",
  "i",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "our",
  "she",
  "that",
  "the",
  "their",
  "them",
  "there",
  "they",
  "this",
  "to",
  "was",
  "we",
  "were",
  "will",
  "with",
  "you",
  "your"
]);

import { withRetry } from "./retry";

type OllamaGenerateResponse = {
  response?: string;
};

type OpenAIChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

const LOCALHOST_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

// Hosted LLM provider allow-list. These are well-known OpenAI-compatible
// inference endpoints that offer free tiers for open-source models (Llama,
// Mixtral, DeepSeek, Qwen, etc). Only hostnames in this set are allowed by
// default — anything else must be opted into via LLM_ALLOWED_HOSTS.
const DEFAULT_LLM_HOSTS = new Set([
  "api.groq.com",
  "openrouter.ai",
  "api-inference.huggingface.co",
  "api.cloudflare.com",
  "api.together.xyz",
  "api.deepinfra.com"
]);

// Default to Groq — free tier, very fast, runs Llama 3.3 70B. Users who
// want a different provider override LLM_BASE_URL + LLM_MODEL.
const DEFAULT_LLM_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_LLM_MODEL = "llama-3.3-70b-versatile";

// Truncate long transcripts before sending to the LLM. Groq/OpenRouter free
// tiers have context limits (8k-32k tokens) and we don't want to get rate
// limited for sending a novel. ~24k chars ≈ 6-8k tokens in English, safe.
const LLM_MAX_TRANSCRIPT_CHARS = 24_000;

const SUMMARY_SYSTEM_PROMPT =
  "You are a meeting-notes assistant. Summarize transcripts into concise, well-structured notes. Use plain text only — no markdown, no emoji. Always output exactly four sections with these exact headings on their own lines: Overview, Decisions, Action Items, Risks. Under each heading, write bullet points that start with '- '. If a section has nothing to report, write '- None.' — never omit a section. Keep bullets factual and short.";

/**
 * Validate the Ollama host to prevent SSRF. We allow:
 *  - localhost / loopback (default for self-hosted Ollama)
 *  - any hostname explicitly listed in OLLAMA_ALLOWED_HOSTS (comma-separated)
 *
 * Bare IPs that are not loopback are rejected unless allow-listed, since they
 * could point at cloud metadata endpoints (169.254.169.254) or internal services.
 */
function resolveOllamaHost(): string | null {
  const raw = (process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").trim();

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`OLLAMA_HOST is not a valid URL: ${raw}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`OLLAMA_HOST must be http:// or https://, got ${parsed.protocol}`);
  }

  // URL.hostname returns IPv6 addresses wrapped in square brackets, e.g. "[::1]".
  // Strip them so we can compare against the loopback set.
  const hostname = parsed.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  const allowList = new Set(
    (process.env.OLLAMA_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );

  const isLocalhost = LOCALHOST_HOSTNAMES.has(hostname);
  const isAllowListed = allowList.has(hostname);

  if (!isLocalhost && !isAllowListed) {
    throw new Error(
      `OLLAMA_HOST ${hostname} is not allowed. Use localhost or add it to OLLAMA_ALLOWED_HOSTS.`
    );
  }

  return parsed.toString().replace(/\/+$/, "");
}

/**
 * Validate the hosted-LLM base URL the same way we validate Ollama — the
 * configured host must resolve to one of our known safe inference providers
 * (or be explicitly listed in LLM_ALLOWED_HOSTS). This prevents an attacker
 * or misconfiguration from pointing the summarizer at cloud metadata IPs
 * (169.254.169.254) or internal services.
 */
function resolveHostedLLMBaseUrl(): string {
  const raw = (process.env.LLM_BASE_URL ?? DEFAULT_LLM_BASE_URL).trim();

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`LLM_BASE_URL is not a valid URL: ${raw}`);
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`LLM_BASE_URL must be http:// or https://, got ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  const extraHosts = new Set(
    (process.env.LLM_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );

  const isDefaultAllowed = DEFAULT_LLM_HOSTS.has(hostname);
  const isExplicitlyAllowed = extraHosts.has(hostname);

  if (!isDefaultAllowed && !isExplicitlyAllowed) {
    throw new Error(
      `LLM_BASE_URL ${hostname} is not a known provider. Add it to LLM_ALLOWED_HOSTS if you trust it.`
    );
  }

  return parsed.toString().replace(/\/+$/, "");
}

// Exported for unit tests.
export const __testing = { resolveOllamaHost, resolveHostedLLMBaseUrl };

function tokenize(text: string) {
  return text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
}

function cleanupSentence(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function splitTranscriptIntoSentences(transcript: string) {
  return transcript
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map(cleanupSentence)
    .filter((line) => line.length >= 24);
}

function normalizeForDeduplication(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function formatBullet(text: string) {
  const trimmed = cleanupSentence(text);

  if (!trimmed) {
    return null;
  }

  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function takeUnique(items: string[], limit: number) {
  const seen = new Set<string>();
  const results: string[] = [];

  for (const item of items) {
    const normalized = normalizeForDeduplication(item);

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    results.push(item);

    if (results.length >= limit) {
      break;
    }
  }

  return results;
}

function rankOverviewSentences(sentences: string[]) {
  const frequencies = new Map<string, number>();

  for (const sentence of sentences) {
    for (const token of tokenize(sentence)) {
      if (token.length < 3 || STOPWORDS.has(token)) {
        continue;
      }

      frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    }
  }

  return sentences
    .map((sentence, index) => {
      const tokens = tokenize(sentence).filter(
        (token) => token.length >= 3 && !STOPWORDS.has(token)
      );

      const score =
        tokens.reduce((sum, token) => sum + (frequencies.get(token) ?? 0), 0) +
        Math.min(sentence.length / 80, 1.5);

      return { sentence, index, score };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .sort((left, right) => left.index - right.index)
    .map((item) => item.sentence);
}

function collectKeywordSentences(
  sentences: string[],
  keywords: RegExp,
  limit: number
) {
  return takeUnique(
    sentences.filter((sentence) => keywords.test(sentence)).map((sentence) => sentence),
    limit
  );
}

function buildHeuristicSummary(transcript: string) {
  const sentences = splitTranscriptIntoSentences(transcript);

  if (!sentences.length) {
    return "Overview\n- Transcript was too short to summarize automatically.\n\nDecisions\n- No explicit decisions captured.\n\nAction Items\n- No explicit action items captured.\n\nRisks\n- No explicit risks captured.";
  }

  const overview = takeUnique(
    rankOverviewSentences(sentences).map((sentence) => formatBullet(sentence) ?? "").filter(Boolean),
    3
  );
  const decisions = collectKeywordSentences(
    sentences,
    /\b(decide|decided|decision|agree|agreed|approved|confirmed|settled|chosen)\b/i,
    4
  );
  const actionItems = collectKeywordSentences(
    sentences,
    /\b(action item|follow up|follow-up|todo|to do|next step|owner|assign|assigned|need to|should|must|send|review|schedule|share|update)\b/i,
    5
  );
  const risks = collectKeywordSentences(
    sentences,
    /\b(risk|blocker|blocked|issue|problem|concern|dependency|delay|delayed|waiting)\b/i,
    4
  );

  return [
    "Overview",
    ...formatSummarySection(
      overview.length ? overview : [formatBullet(sentences[0]) ?? "Meeting content captured."]
    ),
    "",
    "Decisions",
    ...formatSummarySection(
      decisions.length
        ? decisions.map((sentence) => formatBullet(sentence) ?? "").filter(Boolean)
        : ["No explicit decisions captured."]
    ),
    "",
    "Action Items",
    ...formatSummarySection(
      actionItems.length
        ? actionItems.map((sentence) => formatBullet(sentence) ?? "").filter(Boolean)
        : ["No explicit action items captured."]
    ),
    "",
    "Risks",
    ...formatSummarySection(
      risks.length
        ? risks.map((sentence) => formatBullet(sentence) ?? "").filter(Boolean)
        : ["No explicit risks captured."]
    )
  ].join("\n");
}

function formatSummarySection(items: string[]) {
  return items.map((item) => `- ${item}`);
}

/**
 * Summarize with a hosted OpenAI-compatible chat-completions endpoint.
 * Designed to work with free-tier open-source model providers — Groq by
 * default, or any endpoint whitelisted via LLM_ALLOWED_HOSTS.
 *
 * Returns null when the feature is not configured (no LLM_API_KEY), so the
 * caller can fall back to Ollama or the local heuristic summary.
 */
async function summarizeWithHostedLLM(transcript: string) {
  const apiKey = process.env.LLM_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const baseUrl = resolveHostedLLMBaseUrl();
  const model = (process.env.LLM_MODEL ?? DEFAULT_LLM_MODEL).trim();

  // Keep the prompt inside the free-tier context window.
  const truncated =
    transcript.length > LLM_MAX_TRANSCRIPT_CHARS
      ? `${transcript.slice(0, LLM_MAX_TRANSCRIPT_CHARS)}\n\n[Transcript truncated for length.]`
      : transcript;

  return withRetry(
    async () => {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 800,
          messages: [
            { role: "system", content: SUMMARY_SYSTEM_PROMPT },
            {
              role: "user",
              content: `Summarize the following meeting transcript:\n\n${truncated}`
            }
          ]
        }),
        signal: AbortSignal.timeout(60_000)
      });

      if (!response.ok) {
        const errorText = await response.text();
        // Surface 4xx clearly so the caller stops retrying auth problems.
        throw new Error(
          `Hosted LLM summary failed: ${response.status} ${errorText.slice(0, 400)}`
        );
      }

      const payload = (await response.json()) as OpenAIChatResponse;
      const content = payload.choices?.[0]?.message?.content?.trim();
      return content || null;
    },
    {
      label: "hosted llm summarize",
      attempts: 3,
      isRetryable: (error) => {
        if (!(error instanceof Error)) return true;
        const message = error.message.toLowerCase();
        // Never retry: SSRF guard, config errors, auth failures, bad requests.
        if (/not allowed|not a valid url|must be http/i.test(error.message)) return false;
        if (/\b4(0[01345689]|1[0-9])\b/.test(message)) return false; // 4xx except 408/429
        return true;
      }
    }
  );
}

async function summarizeWithOllama(transcript: string) {
  const model = process.env.OLLAMA_MODEL?.trim();

  if (!model) {
    return null;
  }

  const host = resolveOllamaHost();
  if (!host) {
    return null;
  }

  return withRetry(
    async () => {
      const response = await fetch(`${host}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          stream: false,
          prompt: [
            "Summarize this meeting transcript.",
            "Return plain text with these exact sections:",
            "Overview",
            "Decisions",
            "Action Items",
            "Risks",
            "",
            transcript
          ].join("\n")
        }),
        signal: AbortSignal.timeout(120_000)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama summary request failed: ${response.status} ${errorText}`);
      }

      const payload = (await response.json()) as OllamaGenerateResponse;
      return payload.response?.trim() || null;
    },
    {
      label: "ollama summarize",
      attempts: 3,
      // Don't retry permanent SSRF/auth errors.
      isRetryable: (error) => {
        if (!(error instanceof Error)) return true;
        return !/not allowed|not a valid URL|must be http/i.test(error.message);
      }
    }
  );
}

export async function summarizeTranscript(transcript: string) {
  const normalized = transcript.trim();

  if (normalized.length < 40) {
    return buildHeuristicSummary(normalized);
  }

  // Priority order:
  //   1. Hosted open-source LLM (Groq / OpenRouter / etc) if LLM_API_KEY set
  //   2. Self-hosted Ollama if OLLAMA_MODEL set
  //   3. Lightweight local heuristic summary (always available fallback)
  try {
    const hostedSummary = await summarizeWithHostedLLM(normalized);
    if (hostedSummary) {
      return hostedSummary;
    }
  } catch (error) {
    console.warn(
      "[ai] Hosted LLM summary failed, falling back.",
      error instanceof Error ? error.message : error
    );
  }

  try {
    const ollamaSummary = await summarizeWithOllama(normalized);

    if (ollamaSummary) {
      return ollamaSummary;
    }
  } catch {
    // Fall back to the lightweight local summary path if Ollama is unavailable.
  }

  return buildHeuristicSummary(normalized);
}
