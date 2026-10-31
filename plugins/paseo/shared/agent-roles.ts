/**
 * Plugin-owned agent roles. Pure, shared by server, CLI and UI: no Node or React imports.
 *
 * A role is optional short instructions, optional skill references and an ordered list of
 * launch candidates. Presets are simply roles with neither instructions nor skills. Roles are
 * host-scoped plugin settings; they are NOT native Paseo profiles and never read them.
 */
import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const ROLE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;
/** Skill references name a skill directory only: lowercase kebab-case, so no path traversal is possible. */
export const SKILL_REF_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const MAX_QUOTA_PCT = 95;
export const MAX_ROLE_CANDIDATES = 12;
export const MAX_ROLE_SKILLS = 12;
export const MAX_ROLE_INSTRUCTIONS = 4000;

const featureValue = z.union([z.boolean(), z.string()]);

/** A subset of the existing AgentConfiguration: an exact, fully qualified `provider/model`. */
export const roleCandidate = z.object({
  agent: z.string().trim().regex(/^[^/\s]+\/\S+$/, "Use a fully qualified provider/model ID such as claude/claude-sonnet-5-5."),
  thinkingOptionId: z.string().trim().min(1).optional(),
  modeId: z.string().trim().min(1).optional(),
  featureValues: z.record(z.string(), featureValue).optional(),
  /** Metered/paid routes are never used as an automatic fallback without per-launch approval. */
  metered: z.boolean().optional(),
}).strict();
export type RoleCandidate = z.infer<typeof roleCandidate>;

export const roleQuotaPolicy = z.object({
  /** Ordered candidates stop being eligible at or above this maximum used window percentage. */
  maxUsagePct: z.number().int().min(1).max(MAX_QUOTA_PCT).default(MAX_QUOTA_PCT),
  /** Provider readings older than this are treated as unknown, never as zero. */
  maxAgeMinutes: z.number().int().min(1).max(1440).default(30),
  /** Explicit policy for unknown/stale/missing readings. */
  whenUnknown: z.enum(["allow", "skip"]).default("allow"),
}).strict();
export type RoleQuotaPolicy = z.infer<typeof roleQuotaPolicy>;

const skillRefs = z.array(z.string().trim().regex(SKILL_REF_PATTERN, "Invalid skill reference."))
  .max(MAX_ROLE_SKILLS)
  .transform((values) => [...new Set(values)]);

export const agentRoleDefinition = z.object({
  id: z.string().regex(ROLE_ID_PATTERN, "Role IDs use lowercase letters, digits and hyphens (max 48)."),
  name: z.string().trim().min(1).max(80).regex(/^[^\x00-\x1f\x7f]+$/, "Names cannot contain control characters."),
  description: z.string().max(300).default(""),
  /** Increments whenever a saved change alters the role; consumers deliver instructions once per revision. */
  revision: z.number().int().min(1).default(1),
  instructions: z.string().max(MAX_ROLE_INSTRUCTIONS).default(""),
  skills: skillRefs.default([]),
  candidates: z.array(roleCandidate).max(MAX_ROLE_CANDIDATES).default([]),
  quota: roleQuotaPolicy.prefault({}),
}).strict().superRefine((role, ctx) => {
  const seen = new Set<string>();
  role.candidates.forEach((candidate, index) => {
    const key = candidateKey(candidate);
    if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["candidates", index], message: "Duplicate launch candidate." });
    seen.add(key);
  });
});
export type AgentRoleDefinition = z.infer<typeof agentRoleDefinition>;
export type AgentRoleInput = z.input<typeof agentRoleDefinition>;

export function candidateKey(candidate: RoleCandidate): string {
  const features = Object.entries(candidate.featureValues ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([candidate.agent, candidate.thinkingOptionId ?? "", candidate.modeId ?? "", features]);
}

/**
 * Built-in definitions. Model IDs are only preferences: they are launched only when the live host
 * catalog reports them, and candidates can be reordered or replaced. Lane roles keep no
 * candidates so they continue to use the existing Lanes role-model defaults.
 */
export const BUILT_IN_ROLES: readonly AgentRoleInput[] = [
  {
    id: "lane-manager", name: "Lane Manager", revision: 1,
    description: "Plans and coordinates delivery through the Lanes manager workflow.",
    instructions: "Act as the Lane Manager for this work. Delegate bounded implementation to top-level dev agents and review their evidence.",
    skills: ["lane-manager"],
  },
  {
    id: "lane-dev", name: "Lane Dev", revision: 1,
    description: "Implements and verifies a bounded Lanes assignment.",
    instructions: "Act as the Lane Dev for this assignment. Stay within its scope and return evidence to the manager.",
    skills: ["lane-dev"],
  },
  {
    id: "design-engineer", name: "Design Engineer", revision: 1,
    description: "Builds polished, accessible product UI.",
    instructions: "Act as a design engineer: build accessible, theme-aware interfaces, verify them in rendered form and keep visual detail consistent with the existing system.",
    candidates: [
      { agent: "claude/claude-sonnet-5-5", thinkingOptionId: "high" },
      { agent: "claude/claude-opus-5-5", thinkingOptionId: "high" },
    ],
  },
  {
    id: "deep-reasoning", name: "Deep Reasoning", revision: 1,
    description: "Preset: prefer the strongest reasoning configuration. No role instructions.",
    candidates: [
      { agent: "claude/claude-opus-5-5", thinkingOptionId: "xhigh" },
      { agent: "claude/claude-sonnet-5-5", thinkingOptionId: "max" },
    ],
  },
  {
    id: "fast-implementation", name: "Fast Implementation", revision: 1,
    description: "Preset: prefer quick, low-latency implementation. No role instructions.",
    candidates: [
      { agent: "claude/claude-sonnet-5-5", thinkingOptionId: "medium" },
      { agent: "claude/claude-haiku-5-5", thinkingOptionId: "medium" },
    ],
  },
];
export const builtInRoleIds: readonly string[] = BUILT_IN_ROLES.map((role) => role.id!);
export const builtInRoles = (): AgentRoleDefinition[] => BUILT_IN_ROLES.map((role) => agentRoleDefinition.parse(role));

/** Roles must be unique by ID and by case-insensitive name. */
export function roleCollectionIssues(roles: readonly AgentRoleDefinition[]): string[] {
  const ids = new Set<string>();
  const names = new Set<string>();
  const issues: string[] = [];
  for (const role of roles) {
    if (ids.has(role.id)) issues.push(`Duplicate role ID ${role.id}.`);
    ids.add(role.id);
    const name = role.name.toLowerCase();
    if (names.has(name)) issues.push(`Duplicate role name ${role.name}.`);
    names.add(name);
  }
  return issues;
}

const rolesField = z.array(agentRoleDefinition).default(() => builtInRoles()).superRefine((roles, ctx) => {
  for (const message of roleCollectionIssues(roles)) ctx.addIssue({ code: "custom", message });
});

/** Host-scoped, versioned settings. The SDK supplies the revision used for stale-write protection. */
export const agentRolesSettings = defineSettings({
  id: "agent-roles",
  scope: "host",
  version: 1,
  schema: z.object({ roles: rolesField }).passthrough(),
});
export type AgentRolesValues = z.infer<typeof agentRolesSettings.schema>;

// ---------------------------------------------------------------------------------------------
// CRUD: pure transitions over the validated collection. Unrelated roles and settings keys survive.

export type RoleChange =
  | { action: "create"; role: AgentRoleInput }
  | { action: "update"; role: AgentRoleInput }
  | { action: "remove"; id: string }
  | { action: "reset"; id: string };

export class AgentRoleError extends Error {
  constructor(readonly code: "invalid" | "duplicate" | "not_found" | "stale" | "unavailable" | "readback" | "skill_missing", message: string) {
    super(message);
    this.name = "AgentRoleError";
  }
}

function parseRole(input: unknown): AgentRoleDefinition {
  const result = agentRoleDefinition.safeParse(input);
  if (!result.success) {
    throw new AgentRoleError("invalid", result.error.issues.map((issue) => `${issue.path.join(".") || "role"}: ${issue.message}`).join("; "));
  }
  return result.data;
}

/** Content identity excluding the revision counter. */
const contentOf = (role: AgentRoleDefinition) => JSON.stringify({ ...role, revision: 0 });

export function applyRoleChange(values: AgentRolesValues, change: RoleChange): AgentRolesValues {
  const roles = values.roles;
  const index = (id: string) => roles.findIndex((role) => role.id === id);
  let next: AgentRoleDefinition[];
  if (change.action === "create") {
    const role = parseRole({ ...change.role, revision: 1 });
    if (index(role.id) >= 0) throw new AgentRoleError("duplicate", `A role with ID ${role.id} already exists.`);
    next = [...roles, role];
  } else if (change.action === "update") {
    const parsed = parseRole(change.role);
    const at = index(parsed.id);
    if (at < 0) throw new AgentRoleError("not_found", `Role ${parsed.id} does not exist.`);
    const current = roles[at];
    // The caller cannot choose revisions; changed content advances exactly one.
    const role = { ...parsed, revision: contentOf(parsed) === contentOf(current) ? current.revision : current.revision + 1 };
    next = roles.map((candidate, position) => position === at ? role : candidate);
  } else if (change.action === "remove") {
    if (index(change.id) < 0) throw new AgentRoleError("not_found", `Role ${change.id} does not exist.`);
    next = roles.filter((role) => role.id !== change.id);
  } else {
    const seed = builtInRoles().find((role) => role.id === change.id);
    if (!seed) throw new AgentRoleError("not_found", `${change.id} is not a built-in role.`);
    const at = index(change.id);
    if (at < 0) next = [...roles, seed];
    else {
      const current = roles[at];
      next = roles.map((role, position) => position === at
        ? { ...seed, revision: contentOf(seed) === contentOf(current) ? current.revision : current.revision + 1 } : role);
    }
  }
  const issues = roleCollectionIssues(next);
  if (issues.length) throw new AgentRoleError("duplicate", issues.join(" "));
  return { ...values, roles: next };
}

export type RolesStoreState =
  | { status: "ready"; revision: string; values: AgentRolesValues }
  | { status: "invalid"; revision: string; error: string };
export type RolesStoreWrite =
  | { status: "saved"; revision: string; values?: unknown }
  | { status: "conflict"; error: string }
  | { status: "invalid"; error: string };
/** Adapter over the SDK settings read/write contracts (client: settingsRpc(id); tests: in-memory). */
export interface RolesStore {
  read(): Promise<RolesStoreState>;
  write(values: AgentRolesValues, revision: string): Promise<RolesStoreWrite>;
}

/**
 * Revision-safe change: reads, applies, writes against the observed revision (stale writes fail),
 * then reads back and verifies the persisted role collection. Returns the persisted state.
 */
export async function saveRoleChange(
  store: RolesStore,
  change: RoleChange,
  options: { expectedRevision?: string } = {},
): Promise<{ revision: string; roles: AgentRoleDefinition[] }> {
  const state = await store.read();
  if (state.status !== "ready") throw new AgentRoleError("unavailable", `Role settings are invalid: ${state.error}`);
  if (options.expectedRevision !== undefined && options.expectedRevision !== state.revision) {
    throw new AgentRoleError("stale", "Roles changed since they were loaded. Reload them and retry.");
  }
  const next = applyRoleChange(state.values, change);
  const result = await store.write(next, state.revision);
  if (result.status === "conflict") throw new AgentRoleError("stale", result.error || "Roles changed since they were loaded. Reload them and retry.");
  if (result.status === "invalid") throw new AgentRoleError("invalid", result.error);
  const readback = await store.read();
  if (readback.status !== "ready") throw new AgentRoleError("readback", `Roles were saved but cannot be read back: ${readback.error}`);
  if (JSON.stringify(readback.values.roles) !== JSON.stringify(next.roles)) {
    throw new AgentRoleError("readback", "Saved roles do not match the persisted readback. Reload before retrying.");
  }
  return { revision: readback.revision, roles: readback.values.roles };
}

// ---------------------------------------------------------------------------------------------
// System prompt composition. Role instructions and resolved skill contents go into the creation-time
// AgentSessionConfig.systemPrompt. The concrete work prompt is sent separately and is never altered.

export function roleMarker(role: Pick<AgentRoleDefinition, "id" | "revision">): string {
  return `[Lanes role: ${role.id} r${role.revision}]`;
}
export const hasRoleMarker = (text: string, role: Pick<AgentRoleDefinition, "id">): boolean =>
  new RegExp(`\\[Lanes role: ${role.id} r\\d+\\]`).test(text);

export const roleHasGuidance = (role: Pick<AgentRoleDefinition, "instructions" | "skills">): boolean =>
  Boolean(role.instructions.trim()) || role.skills.length > 0;

/** A skill whose actual file content was resolved from a bounded root. */
export type ResolvedSkillContent = { id: string; scope: "workspace" | "user"; path: string; sha256: string; bytes: number; content: string };

/**
 * Compose into the caller's existing systemPrompt without replacing it. Returns the caller's value unchanged for
 * instruction-free presets, and when this role's marker is already present (so composition is idempotent).
 */
export function composeRoleSystemPrompt(
  role: AgentRoleDefinition,
  skills: readonly ResolvedSkillContent[],
  existing?: string,
): string | undefined {
  if (!roleHasGuidance(role) || (existing !== undefined && hasRoleMarker(existing, role))) return existing;
  const parts = [`${roleMarker(role)} ${role.name}`];
  if (role.instructions.trim()) parts.push(role.instructions.trim());
  for (const skill of skills) {
    parts.push(`## Skill: ${skill.id} (${skill.path})\n\n${skill.content.trim()}`);
  }
  const block = parts.join("\n\n");
  return existing?.trim() ? `${existing.trimEnd()}\n\n---\n\n${block}` : block;
}

// ---------------------------------------------------------------------------------------------
// RPC contracts

export const roleResolveInput = z.object({
  roleId: z.string(),
  projectId: z.string().optional(),
  /** When set, the response includes this prompt with the role composed once. */
  workPrompt: z.string().optional(),
  /** Explicit user-selected manual options win over role candidates; the role still contributes guidance. */
  agentConfig: z.object({
    provider: z.string(),
    thinkingOptionId: z.string().optional(),
    featureValues: z.record(z.string(), featureValue).default({}),
    modeId: z.string().optional(),
  }).optional(),
  /** Approves metered fallbacks for this launch only. */
  approveMetered: z.boolean().optional(),
}).strict();
export type RoleResolveInput = z.infer<typeof roleResolveInput>;

export const roleUsageEvidence = z.object({
  provider: z.string(),
  state: z.enum(["known", "unknown"]),
  maxUsedPct: z.number().nullable(),
  window: z.string().nullable(),
  fetchedAt: z.string().nullable(),
  ageMinutes: z.number().nullable(),
  reason: z.string().nullable(),
});
export type RoleUsageEvidence = z.infer<typeof roleUsageEvidence>;

export const ROLE_ATTEMPT_CODES = [
  "selected", "invalid_candidate", "provider_unavailable", "model_unavailable", "configuration_invalid",
  "permission_escalation", "metered_not_approved", "quota_exhausted", "quota_unknown_skipped",
] as const;
export const roleAttempt = z.object({
  index: z.number().int().nonnegative(),
  agent: z.string(),
  code: z.enum(ROLE_ATTEMPT_CODES),
  message: z.string(),
  usage: roleUsageEvidence.nullable(),
});
export type RoleAttempt = z.infer<typeof roleAttempt>;

export const roleResolution = z.object({
  role: z.object({ id: z.string(), name: z.string(), revision: z.number() }),
  /** candidate: ordered live resolution; defaults: no candidates, existing role defaults; manual: user options. */
  source: z.enum(["candidate", "defaults", "manual"]),
  selectedIndex: z.number().int().nullable(),
  config: z.object({
    provider: z.string(), modeId: z.string(), thinkingOptionId: z.string().optional(),
    featureValues: z.record(z.string(), featureValue).optional(),
    /** Creation-time session configuration only; never applied to an already running session. */
    systemPrompt: z.string().optional(),
  }),
  /** The concrete work prompt, unchanged. Role guidance is never mixed into it. */
  prompt: z.string().nullable(),
  composition: z.object({
    instructions: z.boolean(), marker: z.string(),
    skills: z.array(z.object({
      id: z.string(), scope: z.enum(["workspace", "user"]), path: z.string(), sha256: z.string(), bytes: z.number().int().nonnegative(),
    })),
    delivery: z.literal("system_prompt"),
  }),
  attempts: z.array(roleAttempt),
  quota: roleQuotaPolicy,
});
export type RoleResolution = z.infer<typeof roleResolution>;

const rolesState = z.object({
  revision: z.string(),
  roles: z.array(agentRoleDefinition),
  builtInIds: z.array(z.string()),
});
export type RolesState = z.infer<typeof rolesState>;
export const rolesListRpc = defineRpc({ name: "clips.agent-roles.list", input: z.object({}).strict(), output: rolesState });
export const roleResolveRpc = defineRpc({ name: "clips.agent-roles.resolve", input: roleResolveInput, output: roleResolution });

export const roleCatalogEntry = z.object({
  provider: z.string(),
  label: z.string(),
  modes: z.array(z.object({ id: z.string(), label: z.string(), colorTier: z.string().optional() })),
  defaultModeId: z.string().nullable(),
  models: z.array(z.object({
    /** Fully qualified launch ID: provider/model. */
    agent: z.string(), id: z.string(), label: z.string(),
    thinkingOptions: z.array(z.object({ id: z.string(), label: z.string() })),
    defaultThinkingOptionId: z.string().nullable(),
  })),
});
export const roleCatalogRpc = defineRpc({
  name: "clips.agent-roles.catalog",
  input: z.object({ projectId: z.string().optional() }).strict(),
  output: z.object({ providers: z.array(roleCatalogEntry) }),
});
