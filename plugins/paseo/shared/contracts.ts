
import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { FULL_ACCESS_MODE } from "./permission-modes";

const featureValue = z.union([z.boolean(), z.string()]);
const providerFeature = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("toggle"),
    id: z.string(),
    label: z.string(),
    description: z.string().optional(),
    value: z.boolean(),
  }),
  z.object({
    type: z.literal("select"),
    id: z.string(),
    label: z.string(),
    description: z.string().optional(),
    value: z.string().nullable(),
    options: z.array(z.object({
      id: z.string(),
      label: z.string(),
      description: z.string().optional(),
      isDefault: z.boolean().optional(),
    })),
  }),
]);

export const preferences = defineSettings({
  id: "preferences",
  scope: "host",
  version: 4,
  migrate: (values, fromVersion) => {
    const current = typeof values === "object" && values !== null ? values as Record<string, any> : {};
    return {
      ...current,
      ...(fromVersion < 2 ? { thinkingOptionId: "", featureValues: {} } : {}),
      ...(fromVersion < 3 ? { modeId: FULL_ACCESS_MODE } : {}),
      ...(fromVersion < 4 ? {
        roles: {
          manager: { provider: "", featureValues: current.featureValues ?? {}, modeId: current.modeId ?? FULL_ACCESS_MODE },
          dev: { provider: "", featureValues: current.featureValues ?? {}, modeId: current.modeId ?? FULL_ACCESS_MODE },
        },
      } : {}),
    };
  },
  schema: z.object({
    agent: z.string().default(""),
    thinkingOptionId: z.string().default(""),
    featureValues: z.record(z.string(), featureValue).default({}),
    modeId: z.string().default(FULL_ACCESS_MODE),
    roles: z.object({
      manager: z.object({
        provider: z.string().default(""),
        legacyModelMigrated: z.boolean().default(false),
        featureValues: z.record(z.string(), featureValue).default({}),
        modeId: z.string().default(FULL_ACCESS_MODE),
      }).default({ provider: "", legacyModelMigrated: false, featureValues: {}, modeId: FULL_ACCESS_MODE }),
      dev: z.object({
        provider: z.string().default(""),
        legacyModelMigrated: z.boolean().default(false),
        featureValues: z.record(z.string(), featureValue).default({}),
        modeId: z.string().default(FULL_ACCESS_MODE),
      }).default({ provider: "", legacyModelMigrated: false, featureValues: {}, modeId: FULL_ACCESS_MODE }),
    }).default({ manager: { provider: "", legacyModelMigrated: false, featureValues: {}, modeId: FULL_ACCESS_MODE },
      dev: { provider: "", legacyModelMigrated: false, featureValues: {}, modeId: FULL_ACCESS_MODE } }),
  }),
});
export type Preferences = z.infer<typeof preferences.schema>;
export const agentConfiguration = z.object({
  provider: z.string(),
  thinkingOptionId: z.string().optional(),
  featureValues: z.record(z.string(), featureValue).default({}),
  modeId: z.string().optional(),
});
export type AgentConfiguration = z.infer<typeof agentConfiguration>;

export const agentRole = z.enum(["manager", "dev"]);
export type AgentRole = z.infer<typeof agentRole>;
export const roleModelDefaults = z.object({
  role: agentRole,
  model: z.string(),
  reasoningEffort: z.string(),
  agent: z.string().optional(),
  source: z.enum(["project", "user", "legacy", "built_in"]),
});
export type RoleModelDefaults = z.infer<typeof roleModelDefaults>;
export const roleModelDefaultsRpc = defineRpc({
  name: "clips.role-model-defaults",
  input: z.object({ role: agentRole, provider: z.string().optional(), projectId: z.string().optional(), legacyDisabled: z.boolean().optional() }).strict(),
  output: roleModelDefaults,
});
export const saveRoleModelDefaultsRpc = defineRpc({
  name: "clips.role-model-defaults.save",
  input: z.object({ role: agentRole, provider: z.string(), model: z.string(), reasoningEffort: z.string() }).strict(),
  output: roleModelDefaults,
});

export const modelRoutingPolicy = z.object({
  version: z.literal(1),
  providerOrder: z.array(z.string()),
  modelOrder: z.object({ manager: z.array(z.string()), dev: z.array(z.string()) }).strict(),
  /** Optional reasoning effort per ranked `provider/model` entry; an entry without one uses the role default. */
  modelEffort: z.object({ manager: z.record(z.string(), z.string()), dev: z.record(z.string(), z.string()) }).strict().optional(),
  reasoningEffortOrder: z.array(z.string()),
  warningThresholds: z.array(z.number().int().min(1).max(99)),
  handoffThreshold: z.number().int().min(1).max(100),
}).passthrough();
export type ModelRoutingPolicy = z.infer<typeof modelRoutingPolicy>;
export const modelRoutingPolicyRpc = defineRpc({
  name: "clips.model-routing-policy",
  input: z.object({}).strict(),
  output: modelRoutingPolicy,
});
export const saveModelRoutingPolicyRpc = defineRpc({
  name: "clips.model-routing-policy.save",
  input: modelRoutingPolicy,
  output: modelRoutingPolicy,
});

const permissionMode = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  colorTier: z.string().optional(),
});

const criterion = z.object({ id: z.string(), description: z.string() });
export const attachment = z.object({
  id: z.string(),
  type: z.enum(["markdown", "url", "github_issue", "github_pr"]),
  title: z.string(),
  url: z.string().optional(),
  host: z.string().nullable().optional(),
  repository: z.string().nullable().optional(),
  number: z.number().int().positive().nullable().optional(),
  source: z.string().optional(),
  status: z.enum(["available", "missing", "unreadable", "remote", "invalid"]).optional(),
  content: z.string().nullable().optional(),
  content_semantics: z.string().optional(),
  error: z.string().nullable().optional(),
  identity_error: z.string().optional(),
}).passthrough();
export type Attachment = z.infer<typeof attachment>;
export const collaborationCapability = z.object({
  enabled: z.boolean().nullable(),
  state: z.string(),
  scope: z.string(),
  automatic_mutation_sync: z.boolean().nullable().optional(),
  error: z.string().optional(),
}).passthrough();
export type CollaborationCapability = z.infer<typeof collaborationCapability>;
export const attachmentReadData = z.object({
  ref: z.string(),
  revision: z.number().int().nonnegative(),
  attachment,
});
export type AttachmentReadData = z.infer<typeof attachmentReadData>;
export const label = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/),
  name: z.string().trim().min(1).max(80).regex(/^[^\x00-\x1f\x7f]+$/),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
});
export type Label = z.infer<typeof label>;
export const workItem = z.object({
  ref: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.string(),
  plan: z.string(),
  decisions: z.string(),
  scope: z.string(),
  acceptanceCriteria: z.array(criterion),
  attachments: z.array(attachment).default([]),
  labels: z.array(label).default([]),
});
export const task = workItem.extend({ kind: z.literal("task") });
export const goal = workItem.extend({
  kind: z.literal("goal"),
  type: z.string(),
  laneId: z.string().nullable(),
  tasks: z.array(task),
});
export const managerOwner = z.object({
  host: z.string(), runtime: z.string(), session_id: z.string(),
  workspace_id: z.string().optional(), contact: z.string().optional(), claimed_at: z.string().optional(),
});
export const managerClaim = z.object({ revision: z.number(), owners: z.array(managerOwner) });
export const lane = workItem.extend({
  kind: z.literal("lane"),
  goalRefs: z.array(z.string()),
  productGoals: z.array(z.string()),
  managerClaim: managerClaim.nullable().optional(),
  managerClaimError: z.string().nullable().optional(),
});
export type Task = z.infer<typeof task>;
export type Goal = z.infer<typeof goal>;
export type Lane = z.infer<typeof lane>;
export type Work = Task | Goal | Lane;
export const project = z.object({
  projectId: z.string(),
  label: z.string(),
  projectIds: z.array(z.string()),
});
export type Project = z.infer<typeof project>;

export const projectsRpc = defineRpc({
  name: "clips.projects",
  input: z.object({}),
  output: z.object({ projects: z.array(project) }),
});
export const boardData = z.object({
  lanes: z.array(lane),
  goals: z.array(goal),
  warnings: z.array(z.string()),
  labels: z.array(label).default([]),
  collaboration: collaborationCapability.nullable().optional(),
  generatedAt: z.string().nullable().optional(),
});
export const boardRpc = defineRpc({
  name: "clips.board",
  input: z.object({ projectId: z.string() }),
  output: boardData,
});
export const attachmentReadRpc = defineRpc({
  name: "clips.attachment.read",
  input: z.object({ projectId: z.string(), ref: z.string(), attachmentId: z.string() }).strict(),
  output: attachmentReadData,
});
export const collaborationRpc = defineRpc({
  name: "clips.collaboration.set",
  input: z.object({ projectId: z.string(), enabled: z.boolean() }).strict(),
  output: boardData,
});
export const reviewCandidate = z.object({ base: z.string(), head: z.string() }).passthrough();
export type ReviewCandidate = z.infer<typeof reviewCandidate>;
export const reviewStatus = z.enum([
  "awaiting_review", "changes_requested", "approved", "deferred", "superseded", "delivered",
]);
export const reviewSummary = z.object({
  id: z.string(),
  ref: z.string(),
  title: z.string(),
  status: reviewStatus,
  attachment_id: z.string(),
  reviewer: z.string(),
  candidate: reviewCandidate,
  covers: z.array(z.string()),
  covered_refs: z.array(z.string()).default([]),
  summary: z.string(),
  validation: z.unknown(),
}).passthrough();
export const reviewDetail = reviewSummary.extend({
  revision: z.number().int().nonnegative(),
  attachment: z.object({
    id: z.string(),
    purpose: z.string().optional(),
    title: z.string().optional(),
    content: z.string().nullable().optional(),
    current_content: z.string().nullable().optional(),
    read_identity: z.unknown().optional(),
    content_identity: z.unknown().optional(),
  }).passthrough(),
  content_identity: z.unknown().optional(),
  stale: z.boolean(),
  stale_reasons: z.array(z.string()),
}).passthrough();
export type ReviewSummary = z.infer<typeof reviewSummary>;
export type ReviewDetail = z.infer<typeof reviewDetail>;
export const reviewListData = z.object({ reviews: z.array(reviewSummary) });
export const reviewListRpc = defineRpc({
  name: "clips.review.list",
  input: z.object({ projectId: z.string() }).strict(),
  output: reviewListData,
});
export const reviewOpenResult = z.object({
  review: reviewSummary.extend({ stale: z.boolean(), stale_reasons: z.array(z.string()) }),
  requested_ref: z.string().nullable(),
  path: z.string(),
  content_identity: z.object({ sha256: z.string() }).passthrough(),
});
export const reviewOpenData = reviewOpenResult.extend({ markdown: z.string() });
export type ReviewOpenData = z.infer<typeof reviewOpenData>;
export const reviewOpenRpc = defineRpc({
  name: "clips.review.open",
  input: z.object({ projectId: z.string(), ref: z.string() }).strict(),
  output: reviewOpenData,
});
export const reviewShowRpc = defineRpc({
  name: "clips.review.show",
  input: z.object({ projectId: z.string(), id: z.string() }).strict(),
  output: reviewDetail,
});
export const reviewDecision = z.enum(["approved", "changes_requested", "deferred"]);
export type ReviewDecision = z.infer<typeof reviewDecision>;
export const reviewDecideRpc = defineRpc({
  name: "clips.review.decide",
  input: z.object({
    projectId: z.string(),
    id: z.string(),
    decision: reviewDecision,
    actor: z.string().trim().min(1),
    candidate: reviewCandidate,
    comment: z.string(),
    expectedRevision: z.number().int().nonnegative(),
  }).strict(),
  output: reviewDetail,
});
export const reviewImportRpc = defineRpc({
  name: "clips.review.import",
  input: z.object({ projectId: z.string(), id: z.string(), eventId: z.string().trim().min(1) }).strict(),
  output: reviewDetail,
});
export const labelChange = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name: label.shape.name, color: label.shape.color }),
  z.object({ action: z.literal("edit"), id: label.shape.id, name: label.shape.name, color: label.shape.color }),
  z.object({ action: z.literal("delete"), id: label.shape.id, replacement: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("label"), id: label.shape.id }).strict(),
    z.object({ kind: z.literal("none") }).strict(),
  ]).optional() }),
  z.object({ action: z.literal("add"), ref: z.string().min(1), id: label.shape.id }),
  z.object({ action: z.literal("remove"), ref: z.string().min(1), id: label.shape.id }),
]);
export type LabelChange = z.infer<typeof labelChange>;
export const labelsRpc = defineRpc({
  name: "clips.labels.change",
  input: z.object({ projectId: z.string(), change: labelChange }),
  output: boardData,
});
export const labelUsesData = z.object({
  id: label.shape.id,
  uses: z.array(z.object({ ref: z.string(), kind: z.enum(["lane", "goal", "task"]), status: z.string() })),
  count: z.number().int().nonnegative(),
});
export const labelUsesRpc = defineRpc({
  name: "clips.labels.uses",
  input: z.object({ projectId: z.string(), id: label.shape.id }),
  output: labelUsesData,
});
export const START_MODES = ["workspace", "agent"] as const;
export type StartMode = (typeof START_MODES)[number];

export const startRpc = defineRpc({
  name: "clips.start",
  input: z.object({
    projectId: z.string(),
    ref: z.string(),
    mode: z.enum(START_MODES),
    workspaceId: z.string().optional(),
    agentConfig: agentConfiguration.optional(),
    hostId: z.string().optional(),
  }),
  output: z.object({
    workspaceId: z.string(),
    branch: z.string(),
    agentId: z.string().nullable(),
    agent: z.string().nullable(),
    reused: z.boolean(),
    alreadyRunning: z.boolean(),
  }),
});

export const agentOptionsRpc = defineRpc({
  name: "clips.agent-options",
  input: z.object({ projectId: z.string().optional(), provider: z.string(), thinkingOptionId: z.string().optional() }),
  output: z.object({
    thinkingOptions: z.array(z.object({ id: z.string(), label: z.string(), description: z.string().optional() })),
    defaultThinkingOptionId: z.string().nullable(),
    speedFeature: providerFeature.nullable(),
    featureError: z.string().nullable(),
    permissionModes: z.array(permissionMode),
    defaultModeId: z.string().nullable(),
    modeError: z.string().nullable(),
  }),
});

export const laneClosureData = z.object({
  summary: z.string(),
  decision_log: z.string(),
  system_overview: z.string(),
  product_goals_achieved: z.array(z.string()),
});
export type LaneClosureData = z.infer<typeof laneClosureData>;

export const closeRpc = defineRpc({
  name: "clips.close",
  input: z.object({
    projectId: z.string(),
    ref: z.string(),
    laneClosure: laneClosureData.optional(),
    autoCompleteClosure: z.boolean().default(false),
  }),
  output: z.object({
    ref: z.string(),
    status: z.literal("closed"),
    autoCompleteStatus: z.enum(["not_requested", "not_needed", "started", "failed"]),
    autoCompleteError: z.string().nullable(),
  }),
});
