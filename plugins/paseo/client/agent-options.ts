export function agentOptionsTarget(
  providerId: string | undefined,
  agent: string,
  fallback: string | null,
  selectableModels: readonly string[] = [],
): string {
  if (!providerId) return agent || fallback || "";
  const modelId = agent.startsWith(`${providerId}/`)
    ? agent.slice(providerId.length + 1)
    : agent.includes("/") && !selectableModels.includes(agent) ? "" : agent;
  return modelId ? `${providerId}/${modelId}` : "";
}
