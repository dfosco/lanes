import type { ModelRoutingPolicy, AgentRole } from "./contracts";

export type OrderedRoute = { provider: string; models: string[] };

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
