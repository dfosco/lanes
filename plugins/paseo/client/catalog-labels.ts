const friendlyTerms: Record<string, string> = {
  api: "API", claude: "Claude", codex: "Codex", gemini: "Gemini", github: "GitHub",
  gpt: "GPT", openai: "OpenAI", opus: "Opus", sonnet: "Sonnet", haiku: "Haiku", xai: "xAI",
};

function humanizeIdentifier(value: string): string {
  return value.split(/[._/\\-]+/).filter(Boolean).map((part) =>
    friendlyTerms[part.toLowerCase()] ?? `${part[0].toUpperCase()}${part.slice(1)}`).join(" ");
}

export function providerDisplayName(label: string | null | undefined, provider: string, index: number): string {
  const name = label?.trim();
  return name && name !== provider ? name : humanizeIdentifier(provider) || `Provider ${index + 1}`;
}

export function modelDisplayName(label: string | null | undefined, model: string, provider: string, index: number): string {
  const name = label?.trim();
  return name && name !== model && !name.includes(`${provider}/`)
    ? name : humanizeIdentifier(model) || `Model ${index + 1}`;
}
