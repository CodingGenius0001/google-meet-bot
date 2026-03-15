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

type OllamaGenerateResponse = {
  response?: string;
};

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

async function summarizeWithOllama(transcript: string) {
  const model = process.env.OLLAMA_MODEL?.trim();

  if (!model) {
    return null;
  }

  const host = (process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
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
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama summary request failed: ${response.status} ${errorText}`);
  }

  const payload = (await response.json()) as OllamaGenerateResponse;
  return payload.response?.trim() || null;
}

export async function summarizeTranscript(transcript: string) {
  const normalized = transcript.trim();

  if (normalized.length < 40) {
    return buildHeuristicSummary(normalized);
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
