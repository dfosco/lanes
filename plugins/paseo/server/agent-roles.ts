import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  AgentRoleError, MAX_QUOTA_PCT, composeRoleSystemPrompt, roleMarker,
  type AgentRoleDefinition, type ResolvedSkillContent, type RoleAttempt, type RoleResolution, type RoleUsageEvidence,
} from "../shared/agent-roles";
import { defaultSkillRoots, resolveSkills, type SkillRoot } from "./agent-skills";
import { resolvePermissionMode, type ProviderPermissionMode } from "../shared/permission-modes";

type Paseo = PluginHandlerContext["paseo"];

/** The existing launch configuration shape (AgentConfiguration in shared/contracts). */
export type LaunchConfiguration = {
  provider: string;
  modeId: string;
  thinkingOptionId?: string;
  featureValues?: Record<string, boolean | string>;
  systemPrompt?: string;
};
/** A launch override: a candidate, or explicit manual options. Validated by the existing backend resolver. */
export type ConfigureOverride = {
  provider: string;
  thinkingOptionId?: string;
  featureValues: Record<string, boolean | string>;
  modeId?: string;
};

export class AgentRoleResolutionError extends Error {
  constructor(readonly roleId: string, readonly attempts: RoleAttempt[]) {
    super(`No eligible launch candidate for role ${roleId}: ${attempts.map((a) => `[${a.index}] ${a.agent} — ${a.code}: ${a.message}`).join("; ")}`);
    this.name = "AgentRoleResolutionError";
  }
}

const text = (error: unknown) => error instanceof Error ? error.message : String(error);

export type UsageReportLike = {
  providerId?: string;
  status?: string;
  fetchedAt?: string | null;
  windows?: readonly { id: string; label?: string; usedPct?: number | null; remainingPct?: number | null }[];
};

/**
 * Evidence for one provider from the host usage report. The maximum used percentage across numeric windows
 * is the signal. Missing, stale, failed or non-numeric readings stay unknown; they are never treated as zero.
 */
export function usageEvidence(
  provider: string,
  report: UsageReportLike | null | undefined,
  options: { maxAgeMinutes: number; now: number; fallbackFetchedAt?: string | null; failure?: string },
): RoleUsageEvidence {
  const unknown = (reason: string, fetchedAt: string | null = null, ageMinutes: number | null = null): RoleUsageEvidence =>
    ({ provider, state: "unknown", maxUsedPct: null, window: null, fetchedAt, ageMinutes, reason });
  if (options.failure) return unknown(`usage unavailable: ${options.failure}`);
  if (!report) return unknown("no usage report for this provider");
  const fetchedAt = report.fetchedAt ?? options.fallbackFetchedAt ?? null;
  const fetched = fetchedAt ? Date.parse(fetchedAt) : NaN;
  const ageMinutes = Number.isFinite(fetched) ? Math.max(0, (options.now - fetched) / 60_000) : null;
  if (report.status !== "available") return unknown(`usage report is ${report.status ?? "unavailable"}`, fetchedAt, ageMinutes);
  if (ageMinutes === null) return unknown("usage report has no fetch time", fetchedAt);
  if (ageMinutes > options.maxAgeMinutes) {
    return unknown(`usage reading is stale (${Math.round(ageMinutes)} min old, limit ${options.maxAgeMinutes})`, fetchedAt, ageMinutes);
  }
  let max: number | null = null;
  let window: string | null = null;
  for (const entry of report.windows ?? []) {
    const used = typeof entry.usedPct === "number" ? entry.usedPct
      : typeof entry.remainingPct === "number" ? 100 - entry.remainingPct : null;
    if (used !== null && Number.isFinite(used) && (max === null || used > max)) { max = used; window = entry.label || entry.id; }
  }
  if (max === null) return unknown("usage report has no numeric windows", fetchedAt, ageMinutes);
  return { provider, state: "known", maxUsedPct: max, window, fetchedAt, ageMinutes, reason: null };
}

/** Coarse permission rank: planning/safe < moderate < dangerous. Unknown modes rank as moderate. */
const tierRank = (mode: ProviderPermissionMode | undefined): number =>
  !mode ? 1 : mode.colorTier === "dangerous" ? 2 : mode.colorTier === "moderate" ? 1 : mode.colorTier === "safe" || mode.colorTier === "planning" ? 0 : 1;

export type ResolveDeps = {
  paseo: Paseo;
  roles: readonly AgentRoleDefinition[];
  roleId: string;
  /** Working directory for live provider discovery. */
  cwd: string;
  /** The permission mode the launch would use without a candidate. Candidates may not exceed it. */
  baselineModeId: string;
  /** The existing launch validator (backend agentConfiguration). One engine; no copy of its rules here. */
  configure: (override?: ConfigureOverride) => Promise<LaunchConfiguration>;
  /** The unchanged work prompt. It is never altered by role guidance. */
  workPrompt?: string;
  /** Skill roots to search, in precedence order. Defaults to this workspace and the user's ~/.agents/skills. */
  skillRoots?: readonly SkillRoot[];
  /** Caller-supplied creation systemPrompt, preserved and composed with (never replaced by) role guidance. */
  systemPrompt?: string;
  /** Explicit user-selected options. They always win over candidates; the role still contributes guidance. */
  agentConfig?: ConfigureOverride;
  /** Per-launch approval for metered candidates. Never persisted. */
  approveMetered?: boolean;
  now?: () => number;
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
    role: { id: role.id, name: role.name, revision: role.revision },
    source, selectedIndex, config: withPrompt(config), prompt, composition, attempts, quota: role.quota,
  });

  if (deps.agentConfig) return finish("manual", await deps.configure(deps.agentConfig), null, []);
  if (!role.candidates.length) return finish("defaults", await deps.configure(), null, []);

  const now = (deps.now ?? Date.now)();
  const snapshot = (await deps.paseo.providers.snapshot({ cwd: deps.cwd })).entries;
  const reports = new Map<string, UsageReportLike>();
  let fallbackFetchedAt: string | null = null;
  let usageFailure: string | undefined;
  try {
    const result = await deps.paseo.providers.listUsage();
    fallbackFetchedAt = result.fetchedAt ?? null;
    for (const report of result.providers) reports.set(report.providerId, report);
  } catch (error) {
    usageFailure = text(error);
  }

  const attempts: RoleAttempt[] = [];
  for (const [index, candidate] of role.candidates.entries()) {
    const skip = (code: RoleAttempt["code"], message: string, usage: RoleUsageEvidence | null = null) => {
      attempts.push({ index, agent: candidate.agent, code, message, usage });
    };
    const slash = candidate.agent.indexOf("/");
    const providerId = candidate.agent.slice(0, slash);
    const modelId = candidate.agent.slice(slash + 1);
    const entry = snapshot.find((item) => item.provider === providerId);
    if (!entry || entry.status !== "ready" || entry.enabled === false) {
      skip("provider_unavailable", `Provider ${providerId} is not ready on this host.`); continue;
    }
    const model = entry.models?.find((item) => item.id === modelId && item.isSelectable !== false);
    if (!model) { skip("model_unavailable", `Model ${modelId} is not in the live ${providerId} catalog.`); continue; }
    if (candidate.metered && !deps.approveMetered) {
      skip("metered_not_approved", "Metered route needs approval for this launch."); continue;
    }
    let config: LaunchConfiguration;
    try {
      config = await deps.configure({
        provider: candidate.agent,
        ...(candidate.thinkingOptionId ? { thinkingOptionId: candidate.thinkingOptionId } : {}),
        ...(candidate.modeId ? { modeId: candidate.modeId } : {}),
        featureValues: candidate.featureValues ?? {},
      });
    } catch (error) {
      skip("configuration_invalid", text(error)); continue;
    }
    if (candidate.modeId && escalates(await candidateModes(deps, providerId), candidate.modeId, deps.baselineModeId)) {
      skip("permission_escalation", `Mode ${candidate.modeId} is more permissive than the launch baseline ${deps.baselineModeId}.`); continue;
    }
    const usage = usageEvidence(providerId, reports.get(providerId), {
      maxAgeMinutes: role.quota.maxAgeMinutes, now, fallbackFetchedAt, failure: usageFailure,
    });
    if (usage.state === "known" && usage.maxUsedPct! >= Math.min(role.quota.maxUsagePct, MAX_QUOTA_PCT)) {
      skip("quota_exhausted", `${usage.window} is at ${usage.maxUsedPct}% (limit ${role.quota.maxUsagePct}%).`, usage); continue;
    }
    if (usage.state === "unknown" && role.quota.whenUnknown === "skip") {
      skip("quota_unknown_skipped", `Quota unknown (${usage.reason}); this role skips unknown quota.`, usage); continue;
    }
    attempts.push({
      index, agent: candidate.agent, code: "selected", usage,
      message: usage.state === "known"
        ? `${usage.window} at ${usage.maxUsedPct}%.`
        : `Quota unknown (${usage.reason}); allowed by role policy.`,
    });
    return finish("candidate", config, index, attempts);
  }
  throw new AgentRoleResolutionError(role.id, attempts);
}

async function candidateModes(deps: ResolveDeps, providerId: string): Promise<readonly ProviderPermissionMode[]> {
  try {
    const result = await deps.paseo.providers.listModes(providerId, { cwd: deps.cwd });
    return (result.modes ?? []) as readonly ProviderPermissionMode[];
  } catch {
    return [];
  }
}

/** True only when both the candidate and the baseline resolve and the candidate is strictly more permissive. */
export function escalates(modes: readonly ProviderPermissionMode[], requested: string, baseline: string): boolean {
  const wanted = resolvePermissionMode(requested, modes, null);
  const floor = resolvePermissionMode(baseline, modes, null);
  return Boolean(wanted && floor && tierRank(wanted) > tierRank(floor));
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
