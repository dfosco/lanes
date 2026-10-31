import type { ModelRoutingPolicy, AgentRole } from "./contracts";

export type OrderedRoute = { provider: string; models: string[] };

/**
 * Reasoning effort for one ranked entry: the effort chosen on that entry (when the model still offers it),
 * else the role default, else the offered effort nearest the default in `reasoningEffortOrder`, else the model default.
 */
export function entryReasoningEffort(
  policy: ModelRoutingPolicy, role: AgentRole, provider: string, modelId: string,
  availableEfforts: readonly string[], roleDefault: string, modelDefault?: string | null,
): string {
  const own = policy.modelEffort?.[role]?.[`${provider}/${modelId}`];
  if (own && availableEfforts.includes(own)) return own;
  if (roleDefault && availableEfforts.includes(roleDefault)) return roleDefault;
  const configuredIndex = policy.reasoningEffortOrder.indexOf(roleDefault);
  const nearest = configuredIndex < 0 ? undefined : availableEfforts.filter((effortId) => policy.reasoningEffortOrder.includes(effortId))
    .sort((left, right) => Math.abs(policy.reasoningEffortOrder.indexOf(left) - configuredIndex) -
      Math.abs(policy.reasoningEffortOrder.indexOf(right) - configuredIndex))[0];
  return nearest ?? modelDefault ?? "";
}

/** Provider priority chooses the fallback tier; qualified model order ranks models inside each provider. */
export function orderedRoleRoutes(policy: ModelRoutingPolicy, role: AgentRole): OrderedRoute[] {
  const modelOrder = policy.modelOrder[role];
  const modelProviders = modelOrder.map((agent) => agent.slice(0, agent.indexOf("/")));
  const providers = [...new Set([...policy.providerOrder, ...modelProviders])];
  return providers.map((provider) => ({
    provider,
    models: modelOrder.filter((agent) => agent.startsWith(`${provider}/`)).map((agent) => agent.slice(provider.length + 1)),
  }));
}
