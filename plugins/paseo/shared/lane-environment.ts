import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** Plugin-owned role identifiers used for workspace titles and manager succession. */
export const LANE_ROLES = ["lane-manager", "lane-dev", "design-engineer"] as const;
export type LaneRole = (typeof LANE_ROLES)[number];

export const ROLE_NAMES: Record<LaneRole, string> = {
  "lane-manager": "Lane Manager",
  "lane-dev": "Lane Dev",
  "design-engineer": "Design Engineer",
};
export const DEFAULT_ROLE_EMOJIS: Record<LaneRole, string> = {
  "lane-manager": "🧭",
  "lane-dev": "⚡",
  "design-engineer": "👾",
};
export const FORMER_MANAGER_PREFIX = "[former Lane Manager]";
/** Paseo accepts explicit titles up to this many characters; longer titles are trimmed by us. */
export const MAX_AGENT_TITLE_CHARS = 200;

const emoji = z.string().trim().min(1).max(8);

/**
 * Host-scoped preferences. Per-workspace activation, manager and continuation
 * state is not stored here: plugin server settings are read-only, so that state
 * lives in the server-owned environment store.
 */
export const laneEnvironmentSettings = z.object({
  activateNewWorkspaces: z.boolean().default(true),
  firstAgentManager: z.boolean().default(true),
  /** Explicit per-workspace overrides, saved by the client through host settings. Absent means use the default. */
  workspaces: z.record(z.string().trim().min(1).max(256), z.object({ enabled: z.boolean() })).default({}),
  titleMode: z.enum(["emoji-topic", "role-name"]).default("emoji-topic"),
  roleEmojis: z.object({
    "lane-manager": emoji.default(DEFAULT_ROLE_EMOJIS["lane-manager"]),
    "lane-dev": emoji.default(DEFAULT_ROLE_EMOJIS["lane-dev"]),
    "design-engineer": emoji.default(DEFAULT_ROLE_EMOJIS["design-engineer"]),
  }).default({ ...DEFAULT_ROLE_EMOJIS }),
});
export type LaneEnvironmentSettings = z.infer<typeof laneEnvironmentSettings>;

export const laneEnvironmentPreferences = defineSettings({
  id: "lane-environment",
  scope: "host",
  version: 1,
  schema: laneEnvironmentSettings,
});

export function defaultLaneEnvironmentSettings(): LaneEnvironmentSettings {
  return laneEnvironmentSettings.parse({});
}

/** Stored prefix before the topic, e.g. `🧭 ` or `Lane Manager: `. */
export function roleTitlePrefix(role: LaneRole, settings: LaneEnvironmentSettings): string {
  return settings.titleMode === "role-name" ? `${ROLE_NAMES[role]}: ` : `${settings.roleEmojis[role]} `;
}

export function clampTitle(title: string): string {
  return title.length <= MAX_AGENT_TITLE_CHARS ? title : title.slice(0, MAX_AGENT_TITLE_CHARS).trimEnd();
}

/** Remove known role or former-manager prefixes so titles stay idempotent across renames. */
export function topicOf(title: string | null | undefined, settings?: LaneEnvironmentSettings): string {
  const emojis = LANE_ROLES.flatMap((role) => [DEFAULT_ROLE_EMOJIS[role], settings?.roleEmojis[role]])
    .filter((value): value is string => Boolean(value));
  const prefixes = [FORMER_MANAGER_PREFIX, ...LANE_ROLES.map((role) => `${ROLE_NAMES[role]}:`), ...emojis];
  let text = (title ?? "").trim();
  for (let changed = true; changed;) {
    changed = false;
    for (const prefix of prefixes) {
      if (text.startsWith(prefix)) {
        text = text.slice(prefix.length).trimStart();
        changed = true;
      }
    }
  }
  return text.trim();
}

/** Deterministic role title; applying it to its own output changes nothing. */
export function composeRoleTitle(role: LaneRole, topic: string, settings: LaneEnvironmentSettings): string {
  return clampTitle(`${roleTitlePrefix(role, settings)}${topic.trim() || "Lane"}`);
}

/** Title a demoted manager should carry. Paseo's public SDK cannot rename an existing agent, so this is advisory. */
export function formerManagerTitle(topic: string): string {
  return clampTitle(`${FORMER_MANAGER_PREFIX} ${topic.trim() || "Lane"}`);
}

/** Idempotent title enforcement: returns the desired title and whether it differs from the current one. */
export function enforceRoleTitle(
  current: string | null | undefined,
  role: LaneRole,
  settings: LaneEnvironmentSettings,
  fallbackTopic: string,
): { title: string; changed: boolean } {
  const title = composeRoleTitle(role, topicOf(current, settings) || fallbackTopic, settings);
  return { title, changed: title !== (current ?? null) };
}

const identity = z.string().trim().min(1).max(256);
const expectedRevision = z.number().int().nonnegative().optional();

export const laneEnvironmentWorkspaceView = z.object({
  workspaceId: z.string(),
  enabled: z.boolean(),
  /** `default` came from new-workspace activation, `explicit` from a user/manager action, `none` means never activated. */
  enabledSource: z.enum(["default", "explicit", "none"]),
  managerId: z.string().nullable(),
  pendingManager: z.object({ requestId: z.string(), title: z.string(), startedAt: z.number(), agentId: z.string().nullable() }).nullable(),
  continuation: z.object({
    requestId: z.string(), fromAgentId: z.string(), status: z.enum(["creating", "failed"]),
    startedAt: z.number(), error: z.string().nullable(), toAgentId: z.string().nullable(),
  }).nullable(),
  demoted: z.array(z.object({ agentId: z.string(), demotedAt: z.number() })),
});
export type LaneEnvironmentWorkspaceView = z.infer<typeof laneEnvironmentWorkspaceView>;

export const laneEnvironmentStatusRpc = defineRpc({
  name: "clips.lane-environment.status",
  input: z.object({ workspaceId: identity }).strict(),
  output: z.object({ storeRevision: z.number().int().nonnegative(), workspace: laneEnvironmentWorkspaceView }),
});

export const laneEnvironmentAssignManagerInput = z.object({
  workspaceId: identity, agentId: identity, expectedRevision,
}).strict();
export const laneEnvironmentAssignManagerRpc = defineRpc({
  name: "clips.lane-environment.assign-manager",
  input: laneEnvironmentAssignManagerInput,
  output: z.object({
    storeRevision: z.number().int().nonnegative(),
    workspace: laneEnvironmentWorkspaceView,
    /** The live title could not be changed; the advisory title is what a person may apply manually. */
    titleApplied: z.literal(false),
    advisoryTitle: z.string(),
  }),
});

export const laneEnvironmentContinueInput = z.object({
  workspaceId: identity,
  fromAgentId: identity,
  expectedRevision,
  checkpoint: z.string().trim().min(1).max(64 * 1024),
}).strict();
export const laneEnvironmentContinueRpc = defineRpc({
  name: "clips.lane-environment.continue",
  input: laneEnvironmentContinueInput,
  output: z.object({
    storeRevision: z.number().int().nonnegative(),
    workspace: laneEnvironmentWorkspaceView,
    newAgentId: z.string(),
    /** Native limits: the new session is not a fork, transcript clone or provider switch. */
    limitations: z.array(z.string()),
    demotionNotice: z.enum(["sent", "failed"]),
  }),
});
