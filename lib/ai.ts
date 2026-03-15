type OpenAIResponse = {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      text?: string;
    }>;
  }>;
};

function extractText(payload: OpenAIResponse) {
  if (payload.output_text?.trim()) {
    return payload.output_text.trim();
  }

  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.text?.trim()) {
        return content.text.trim();
      }
    }
  }

  return null;
}

export async function summarizeTranscript(transcript: string) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey || transcript.trim().length < 60) {
    return null;
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "You summarize meeting transcripts. Produce a concise summary with sections titled Overview, Decisions, Action Items, and Risks."
        },
        {
          role: "user",
          content: transcript
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI summary request failed: ${response.status} ${errorText}`);
  }

  const payload = (await response.json()) as OpenAIResponse;
  return extractText(payload);
}

