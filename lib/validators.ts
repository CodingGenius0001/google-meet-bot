const GOOGLE_MEET_HOSTS = new Set(["meet.google.com", "g.co"]);

export function normalizeMeetUrl(input: string) {
  let parsed: URL;

  try {
    parsed = new URL(input.trim());
  } catch {
    throw new Error("Enter a full Google Meet URL.");
  }

  if (!GOOGLE_MEET_HOSTS.has(parsed.hostname)) {
    throw new Error("Only Google Meet links are supported.");
  }

  const codeMatch = parsed.pathname.match(/([a-z]{3}-[a-z]{4}-[a-z]{3})/i);

  if (!codeMatch) {
    throw new Error("That URL does not look like a standard Google Meet room.");
  }

  return {
    meetUrl: `https://meet.google.com/${codeMatch[1].toLowerCase()}`,
    meetCode: codeMatch[1].toLowerCase()
  };
}

export function ensureString(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required.`);
  }

  return value.trim();
}

