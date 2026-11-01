import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  AgentRoleError, composeRoleSystemPrompt, responsibilityType, roleMarker,
  type AgentRoleDefinition, type ResolvedSkillContent, type RoleAttempt, type RoleResolution,
} from "../shared/agent-roles";
import { defaultSkillRoots, resolveSkills, type SkillRoot } from "./agent-skills";

type Paseo = PluginHandlerContext["paseo"];

/** The existing launch configuration shape (AgentConfiguration in shared/contracts). */
export type LaunchConfiguration = {
  provider: string;
  modeId: string;
  thinkingOptionId?: string;
  featureValues?: Record<string, boolean | string>;
  systemPrompt?: string;
};
/** A launch override: a routed model, or explicit manual options. Validated by the existing backend resolver. */
export type ConfigureOverride = {
  provider: string;
  thinkingOptionId?: string;
  featureValues: Record<string, boolean | string>;
  modeId?: string;
};
/** One ranked `provider/model` from the Routing policy, in launch order. */
export type RoleRoute = { agent: string; effort?: string };

export class AgentRoleResolutionError extends Error {
  constructor(readonly roleId: string, readonly attempts: RoleAttempt[]) {
    super(`No eligible launch route for role ${roleId}: ${attempts.map((a) => `[${a.index}] ${a.agent} — ${a.code}: ${a.message}`).join("; ")}`);
    this.name = "AgentRoleResolutionError";
  }
}

const text = (error: unknown) => error instanceof Error ? error.message : String(error);
const MAX_USAGE_AGE_MS = 30 * 60_000;

/** Return an evidence-based provider usage value. Missing, malformed, and stale data are unknown. */
export async function readProviderUsage(paseo: Paseo, providerId: string): Promise<{ usedPct: number } | { reason: string }> {
  const usageApi = (paseo.providers as unknown as { listUsage?: () => Promise<unknown> }).listUsage;
  if (!usageApi) return { reason: "This Paseo host does not expose provider usage." };
  let report: any;
  try { report = await usageApi.call(paseo.providers); }
  catch (error) { return { reason: `Paseo usage report failed: ${text(error)}` }; }
  const provider = report?.providers?.find((item: any) => item.providerId === providerId);
  if (!provider || provider.status !== "available") return { reason: `Paseo has no available usage report for ${providerId}.` };
  const fetchedAt = Date.parse(provider.fetchedAt ?? report.fetchedAt ?? "");
  const age = Date.now() - fetchedAt;
  if (!Number.isFinite(fetchedAt) || age < -60_000 || age > MAX_USAGE_AGE_MS) {
    return { reason: `Paseo usage report for ${providerId} is missing or stale.` };
  }
  const values = Array.isArray(provider.windows) ? provider.windows.map((window: any) => window.usedPct) : [];
  if (!values.length || values.some((value: unknown) => typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100)) {
    return { reason: `Paseo usage report for ${providerId} has no valid quota windows.` };
  }
  return { usedPct: Math.max(...values) };
}

export type ResolveDeps = {
  paseo: Paseo;
  roles: readonly AgentRoleDefinition[];
  roleId: string;
  /** Working directory for live provider discovery. */
  cwd: string;
  /** Ranked routes for this role from the Routing policy. Empty means the existing role defaults apply. */
  routes: readonly RoleRoute[];
  /** Shared Routing policy handoff threshold; automatic routes fail closed without fresh host usage. */
  handoffThreshold: number;
  /** Shared warning thresholds; crossed values are included in the selected route's launch diagnostics. */
  warningThresholds?: readonly number[];
  /** The existing launch validator (backend agentConfiguration). One engine; no copy of its rules here. */
  configure: (override?: ConfigureOverride, options?: { automaticRoute?: boolean }) => Promise<LaunchConfiguration>;
  /** The unchanged work prompt. It is never altered by role guidance. */
  workPrompt?: string;
  /** Skill roots to search, in precedence order. Defaults to this workspace and the user's ~/.agents/skills. */
  skillRoots?: readonly SkillRoot[];
  /** Caller-supplied creation systemPrompt, preserved and composed with (never replaced by) role guidance. */
  systemPrompt?: string;
  /** Explicit user-selected options. They always win over routing; the role still contributes guidance. */
  agentConfig?: ConfigureOverride;
};

export async function resolveRoleLaunch(deps: ResolveDeps): Promise<RoleResolution> {
  const role = deps.roles.find((item) => item.id === deps.roleId);
  if (!role) throw new AgentRoleError("not_found", `Role ${deps.roleId} does not exist.`);
  // Skill content is resolved before any launch decision, so a missing required skill fails every role launch.
  const skills: ResolvedSkillContent[] = resolveSkills(role.skills, deps.skillRoots ?? defaultSkillRoots(deps.cwd));
  const systemPrompt = composeRoleSystemPrompt(role, skills, deps.systemPrompt);
  const composition = {
    instructions: Boolean(role.instructions.trim()), marker: roleMarker(role), delivery: "system_prompt" as const,
    skills: skills.map(({ id, scope, path, sha256, bytes }) => ({ id, scope, path, sha256, bytes })),
  };
  const prompt = deps.workPrompt ?? null;
  const withPrompt = (config: LaunchConfiguration): LaunchConfiguration =>
    systemPrompt === undefined ? config : { ...config, systemPrompt };
  const finish = (
    source: RoleResolution["source"], config: LaunchConfiguration, selectedIndex: number | null, attempts: RoleAttempt[],
  ): RoleResolution => ({
    role: { id: role.id, name: role.name, type: responsibilityType(role), revision: role.revision },
    source, selectedIndex, config: withPrompt(config), prompt, composition, attempts,
  });

  if (deps.agentConfig) return finish("manual", await deps.configure(deps.agentConfig), null, []);
  if (!deps.routes.length) return finish("defaults", await deps.configure(), null, []);

  const snapshot = (await deps.paseo.providers.snapshot({ cwd: deps.cwd })).entries;
  const attempts: RoleAttempt[] = [];
  const usage = new Map<string, Awaited<ReturnType<typeof readProviderUsage>>>();
  for (const [index, route] of deps.routes.entries()) {
    const skip = (code: RoleAttempt["code"], message: string) => {
      attempts.push({ index, agent: route.agent, code, message });
    };
    const slash = route.agent.indexOf("/");
    const providerId = route.agent.slice(0, slash);
    const modelId = route.agent.slice(slash + 1);
    const entry = snapshot.find((item) => item.provider === providerId);
    if (!entry || entry.status !== "ready" || entry.enabled === false) {
      skip("provider_unavailable", `Provider ${providerId} is not ready on this host.`); continue;
    }
    let providerQuota = usage.get(providerId);
    if (!providerQuota) {
      providerQuota = await readProviderUsage(deps.paseo, providerId);
      usage.set(providerId, providerQuota);
    }
    if ("reason" in providerQuota) { skip("quota_unknown", providerQuota.reason); continue; }
    if (providerQuota.usedPct >= deps.handoffThreshold) {
      skip("quota_handoff", `${providerId} usage is ${providerQuota.usedPct}%, at or above the ${deps.handoffThreshold}% handoff threshold.`);
      continue;
    }
    const model = entry.models?.find((item) => item.id === modelId && item.isSelectable !== false);
    if (!model) { skip("model_unavailable", `Model ${modelId} is not in the live ${providerId} catalog.`); continue; }
    // A saved effort the model no longer offers is ignored, so the model still launches at its default effort.
    const effort = route.effort && model.thinkingOptions?.some((option) => option.id === route.effort) ? route.effort : undefined;
    let config: LaunchConfiguration;
    try {
      config = await deps.configure({
        provider: route.agent,
        ...(effort ? { thinkingOptionId: effort } : {}),
        featureValues: {},
      }, { automaticRoute: true });
    } catch (error) {
      skip("configuration_invalid", text(error)); continue;
    }
    const warnings = (deps.warningThresholds ?? []).filter((threshold) => providerQuota.usedPct >= threshold);
    const warning = warnings.length
      ? ` Usage is ${providerQuota.usedPct}%, crossing warning threshold${warnings.length === 1 ? "" : "s"} ${warnings.map((threshold) => `${threshold}%`).join(", ")}.`
      : "";
    attempts.push({ index, agent: route.agent, code: "selected", message: `First eligible entry in the Routing order.${warning}` });
    return finish("routing", config, index, attempts);
  }
  throw new AgentRoleResolutionError(role.id, attempts);
}

/** Live catalog for role editors: ready providers, their modes and selectable fully qualified models. */
export async function readProviderCatalog(paseo: Paseo, cwd: string) {
  const entries = (await paseo.providers.snapshot({ cwd })).entries;
  return {
    providers: entries.filter((entry) => entry.status === "ready" && entry.enabled !== false).map((entry) => ({
      provider: entry.provider,
      label: entry.label ?? entry.provider,
      modes: (entry.modes ?? []).map((mode) => ({ id: mode.id, label: mode.label, ...(mode.colorTier ? { colorTier: mode.colorTier } : {}) })),
      defaultModeId: entry.defaultModeId ?? null,
      models: (entry.models ?? []).filter((model) => model.isSelectable !== false).map((model) => ({
        agent: `${entry.provider}/${model.id}`, id: model.id, label: model.label ?? model.id,
        thinkingOptions: (model.thinkingOptions ?? []).map((option) => ({ id: option.id, label: option.label })),
        defaultThinkingOptionId: model.defaultThinkingOptionId ?? null,
      })),
    })),
  };
}
