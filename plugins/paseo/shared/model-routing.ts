import type { ModelRoutingPolicy } from "./contracts";

export type OrderedRoute = { provider: string; models: string[] };

/**
 * Routing keys. Lane roles keep their existing `manager` and `dev` keys so saved policies stay valid;
 * every other role routes by its own ID. Reserved keys cannot name custom roles (see agent-roles).
 */
const LANE_ROUTING_KEYS = new Map<string, string>([["lane-manager", "manager"], ["lane-dev", "dev"]]);
export const RESERVED_ROUTING_KEYS: readonly string[] = ["manager", "dev"];
export const routingKeyForRole = (roleId: string): string => LANE_ROUTING_KEYS.get(roleId) ?? roleId;

/**
 * Reasoning effort for one ranked entry: the effort chosen on that entry (when the model still offers it),
 * else the role default, else the offered effort nearest the default in `reasoningEffortOrder`, else the model default.
 */
export function entryReasoningEffort(
  policy: ModelRoutingPolicy, routingKey: string, provider: string, modelId: string,
  availableEfforts: readonly string[], roleDefault: string, modelDefault?: string | null,
): string {
  const effortByRole = policy.modelEffort && Object.hasOwn(policy.modelEffort, routingKey)
    ? policy.modelEffort[routingKey] : undefined;
  const effortKey = `${provider}/${modelId}`;
  const own = effortByRole && Object.hasOwn(effortByRole, effortKey) ? effortByRole[effortKey] : undefined;
  if (own && availableEfforts.includes(own)) return own;
  if (roleDefault && availableEfforts.includes(roleDefault)) return roleDefault;
  const configuredIndex = policy.reasoningEffortOrder.indexOf(roleDefault);
  const nearest = configuredIndex < 0 ? undefined : availableEfforts.filter((effortId) => policy.reasoningEffortOrder.includes(effortId))
    .sort((left, right) => Math.abs(policy.reasoningEffortOrder.indexOf(left) - configuredIndex) -
      Math.abs(policy.reasoningEffortOrder.indexOf(right) - configuredIndex))[0];
  return nearest ?? modelDefault ?? "";
}

/** Provider priority chooses the fallback tier; qualified model order ranks models inside each provider. */
export function orderedRoleRoutes(policy: ModelRoutingPolicy, roleId: string): OrderedRoute[] {
  const key = routingKeyForRole(roleId);
  const modelOrder = Object.hasOwn(policy.modelOrder, key) ? policy.modelOrder[key] : [];
  const modelProviders = modelOrder.map((agent) => agent.slice(0, agent.indexOf("/")));
  const providers = [...new Set([...policy.providerOrder, ...modelProviders])];
  return providers.map((provider) => ({
    provider,
    models: modelOrder.filter((agent) => agent.startsWith(`${provider}/`)).map((agent) => agent.slice(provider.length + 1)),
  }));
}

/** Every ranked `provider/model` for a role in launch order, with its saved effort when one is set. */
export function roleRouteAgents(policy: ModelRoutingPolicy, roleId: string): { agent: string; effort?: string }[] {
  const key = routingKeyForRole(roleId);
  return orderedRoleRoutes(policy, roleId).flatMap((route) => route.models.map((modelId) => {
    const agent = `${route.provider}/${modelId}`;
    const effort = policy.modelEffort?.[key]?.[agent];
    return effort ? { agent, effort } : { agent };
  }));
}
