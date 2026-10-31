import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import {
  composeRoleTitle, formerManagerTitle, topicOf, type LaneEnvironmentSettings,
  type LaneEnvironmentWorkspaceView,
} from "../shared/lane-environment";
import {
  type EnvironmentState, type LaneEnvironmentStore, type WorkspaceRecord,
} from "./lane-environment-store";

export const PENDING_MANAGER_TTL_MS = 60_000;
export const CONTINUATION_TTL_MS = 5 * 60_000;

/** Minimal agent fields used by the environment service; the SDK snapshot carries more. */
export type EnvironmentAgent = {
  id: string;
  workspaceId: string | null;
  cwd: string | null;
  title: string | null;
  archivedAt: string | null;
  status: string | null;
  activeTurn: unknown | null;
  pendingPermissions: readonly unknown[] | null;
  runtimeInfo: { provider: string; model?: string | null } | null;
};

export type LaneEnvironmentDependencies = {
  store: LaneEnvironmentStore;
  settings: () => Promise<LaneEnvironmentSettings>;
  /** Compose the elected manager role into the create-time system prompt. */
  managerSystemPrompt: (config: { cwd: string; systemPrompt?: string }) => Promise<string | undefined>;
  /** Public Paseo CLI runner. Injectable so host targeting and rename recovery are testable. */
  runPaseoCli?: (args: readonly string[]) => Promise<string>;
  now?: () => number;
  randomId?: () => string;
  warn?: (message: string) => void;
};

export class EnvironmentError extends Error {}

const blankRecord = (): WorkspaceRecord => ({
  defaultActivated: false, managerId: null, pendingManager: null, continuation: null, demoted: [],
});

/** Explicit host setting wins; otherwise a workspace this daemon saw created while defaults were on. */
export function effectiveActivation(
  settings: LaneEnvironmentSettings,
  workspaceId: string,
  record: WorkspaceRecord | undefined,
): { enabled: boolean; source: LaneEnvironmentWorkspaceView["enabledSource"] } {
  const explicit = settings.workspaces[workspaceId];
  if (explicit) return { enabled: explicit.enabled, source: "explicit" };
  if (record?.defaultActivated) return { enabled: true, source: "default" };
  return { enabled: false, source: "none" };
}

function viewOf(workspaceId: string, state: EnvironmentState, settings: LaneEnvironmentSettings): LaneEnvironmentWorkspaceView {
  const record = state.workspaces[workspaceId];
  const activation = effectiveActivation(settings, workspaceId, record);
  return {
    workspaceId,
    enabled: activation.enabled,
    enabledSource: activation.source,
    managerId: record?.managerId ?? null,
    pendingManager: record?.pendingManager ? {
      requestId: record.pendingManager.requestId, title: record.pendingManager.title,
      startedAt: record.pendingManager.startedAt, agentId: record.pendingManager.agentId,
    } : null,
    continuation: record?.continuation ? {
      requestId: record.continuation.requestId, fromAgentId: record.continuation.fromAgentId,
      status: record.continuation.status, startedAt: record.continuation.startedAt,
      error: record.continuation.error, toAgentId: record.continuation.toAgentId,
    } : null,
    demoted: record?.demoted ?? [],
  };
}

/** Maps a workspace directory to its id via the public workspace listing. */
export async function workspaceIdForDirectory(paseo: PaseoApi, directory: string): Promise<string | null> {
  let cursor: string | undefined;
  for (let pages = 0; pages < 100; pages += 1) {
    const page = await paseo.workspaces.list({ page: { limit: 200, cursor } });
    const match = page.entries.find((entry) => entry.workspaceDirectory === directory);
    if (match) return match.id;
    if (!page.pageInfo.hasMore) return null;
    cursor = page.pageInfo.nextCursor ?? undefined;
    if (!cursor) throw new EnvironmentError("Paseo workspace listing did not return a continuation cursor.");
  }
  throw new EnvironmentError("Paseo workspace listing exceeded 100 pages.");
}

async function readAgent(paseo: PaseoApi, agentId: string): Promise<EnvironmentAgent> {
  const refreshed = await paseo.agents.ref(agentId).refresh();
  if (!refreshed) throw new EnvironmentError(`Agent ${agentId} was not found on this host.`);
  return refreshed.agent as unknown as EnvironmentAgent;
}

const runPaseoCli = (args: readonly string[]): Promise<string> => new Promise((resolve, reject) => {
  execFile("paseo", [...args], { encoding: "utf8", timeout: 10_000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
    if (error) reject(error);
    else resolve(stdout);
  });
});

const cliField = (record: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const key of keys) if (Object.hasOwn(record, key)) return record[key];
  return undefined;
};

function normalizedDirectory(directory: string): string {
  const expanded = directory === "~" ? os.homedir()
    : directory.startsWith("~/") ? path.join(os.homedir(), directory.slice(2))
      : directory;
  return path.normalize(path.resolve(expanded));
}

function parseCliJson(output: string, command: string): unknown {
  try { return JSON.parse(output); }
  catch (error) { throw new EnvironmentError(`Paseo CLI ${command} returned invalid JSON: ${String(error)}`); }
}

type RenameObservation = {
  agent: EnvironmentAgent;
  cliListName: string | null;
  cliInspectName: string | null;
};

async function observeRenameTarget(
  paseo: PaseoApi,
  runCli: (args: readonly string[]) => Promise<string>,
  input: { agentId: string; workspaceId: string; expectedCwd: string },
): Promise<RenameObservation> {
  const agent = await readAgent(paseo, input.agentId);
  if (agent.id !== input.agentId) throw new EnvironmentError(`Paseo SDK readback returned agent ${agent.id}, not ${input.agentId}.`);
  if (agent.workspaceId !== input.workspaceId) {
    throw new EnvironmentError(`Agent ${input.agentId} is in workspace ${agent.workspaceId ?? "unknown"}, not ${input.workspaceId}.`);
  }
  if (!agent.cwd || normalizedDirectory(agent.cwd) !== normalizedDirectory(input.expectedCwd)) {
    throw new EnvironmentError(`Agent ${input.agentId} cwd does not match its observed workspace directory.`);
  }

  const [listOutput, inspectOutput] = await Promise.all([
    runCli(["ls", "--global", "--json"]),
    runCli(["inspect", input.agentId, "--json"]),
  ]);
  const listed = parseCliJson(listOutput, "ls --global --json");
  if (!Array.isArray(listed)) throw new EnvironmentError("Paseo CLI global agent list was not an array.");
  const matches = listed.filter((entry): entry is Record<string, unknown> =>
    Boolean(entry && typeof entry === "object" && cliField(entry as Record<string, unknown>, "id", "Id") === input.agentId));
  if (matches.length !== 1) throw new EnvironmentError(`Paseo CLI global list did not contain exactly one agent ${input.agentId}.`);
  const listedCwd = cliField(matches[0], "cwd", "Cwd");
  const listedName = cliField(matches[0], "name", "Name", "title", "Title");
  if (typeof listedCwd !== "string" || normalizedDirectory(listedCwd) !== normalizedDirectory(agent.cwd)) {
    throw new EnvironmentError(`Paseo CLI global list cwd does not match agent ${input.agentId} in workspace ${input.workspaceId}.`);
  }
  if (listedName !== null && typeof listedName !== "string") throw new EnvironmentError("Paseo CLI global list returned an invalid agent name.");

  const inspected = parseCliJson(inspectOutput, `inspect ${input.agentId} --json`);
  if (!inspected || typeof inspected !== "object") throw new EnvironmentError(`Paseo CLI inspect returned no agent ${input.agentId}.`);
  const detail = inspected as Record<string, unknown>;
  const inspectedId = cliField(detail, "id", "Id");
  const inspectedCwd = cliField(detail, "cwd", "Cwd");
  const inspectedName = cliField(detail, "name", "Name", "title", "Title");
  if (inspectedId !== input.agentId) throw new EnvironmentError(`Paseo CLI inspect returned agent ${String(inspectedId)}, not ${input.agentId}.`);
  if (typeof inspectedCwd !== "string" || normalizedDirectory(inspectedCwd) !== normalizedDirectory(agent.cwd)) {
    throw new EnvironmentError(`Paseo CLI inspect cwd does not match agent ${input.agentId} in workspace ${input.workspaceId}.`);
  }
  if (inspectedName !== null && typeof inspectedName !== "string") throw new EnvironmentError("Paseo CLI inspect returned an invalid agent name.");
  if (listedName === undefined || inspectedName === undefined) throw new EnvironmentError("Paseo CLI did not expose the agent name needed for safe rename verification.");
  return { agent, cliListName: listedName as string | null, cliInspectName: inspectedName as string | null };
}

const titleMatches = (observation: RenameObservation, title: string | null): boolean =>
  observation.agent.title === title && observation.cliListName === title && observation.cliInspectName === title;

type FormerTitleResult = { applied: boolean; error: string | null };

/** Rename only after the public CLI and this hook's SDK context agree on exact agent/workspace identity. */
async function applyFormerManagerTitle(
  paseo: PaseoApi,
  runCli: (args: readonly string[]) => Promise<string>,
  input: {
    agentId: string; workspaceId: string; expectedCwd: string; previousTitle: string | null;
    formerTitle: string; isStillFormerManager: () => Promise<boolean>;
  },
): Promise<FormerTitleResult> {
  const identity = { agentId: input.agentId, workspaceId: input.workspaceId, expectedCwd: input.expectedCwd };
  try {
    if (!await input.isStillFormerManager()) throw new EnvironmentError("The manager changed before the former-manager title could be applied.");
    const before = await observeRenameTarget(paseo, runCli, identity);
    if (!titleMatches(before, input.previousTitle)) {
      throw new EnvironmentError(`The old manager title did not match native and CLI readback; refusing to rename ${input.agentId}.`);
    }
    if (!await input.isStillFormerManager()) throw new EnvironmentError("The manager changed before the former-manager title could be applied.");
  } catch (error) {
    return { applied: false, error: `Former-manager title was not changed: ${String(error)}` };
  }

  let updateError: unknown;
  try {
    await runCli(["agent", "update", input.agentId, "--name", input.formerTitle, "--json"]);
  } catch (error) {
    updateError = error;
  }

  const observe = async () => observeRenameTarget(paseo, runCli, identity);
  let after: RenameObservation | null = null;
  let readbackError: unknown;
  try { after = await observe(); } catch (error) { readbackError = error; }
  if (after && titleMatches(after, input.formerTitle)) return { applied: true, error: null };

  // A failed command may have mutated before exiting. Retry readback once; rollback only if all
  // three public/native views now agree on the exact new title and manager state is still current.
  if (!after || !titleMatches(after, input.previousTitle)) {
    try { after = await observe(); } catch (error) { readbackError = error; }
    if (after && titleMatches(after, input.formerTitle)) {
      try {
        if (!await input.isStillFormerManager()) throw new EnvironmentError("The manager changed during title readback; refusing rollback.");
        if (input.previousTitle === null) throw new EnvironmentError("The prior title was empty and cannot be restored with the public CLI.");
        await runCli(["agent", "update", input.agentId, "--name", input.previousTitle, "--json"]);
        const restored = await observe();
        if (!titleMatches(restored, input.previousTitle)) throw new EnvironmentError("The previous title did not match after rollback.");
      } catch (rollbackError) {
        const cause = updateError ? ` CLI update error: ${String(updateError)}.` : "";
        return { applied: false, error: `Former-manager title readback failed and rollback was not confirmed: ${String(rollbackError)}.${cause}` };
      }
      const cause = updateError ? ` CLI update error: ${String(updateError)}.` : "";
      return { applied: false, error: `Former-manager title readback mismatched; the original title was restored.${cause}` };
    }
  }

  const details = readbackError ? String(readbackError)
    : `expected ${JSON.stringify(input.formerTitle)}, observed ${JSON.stringify(after?.agent.title)}`;
  const updateDetails = updateError ? ` CLI update error: ${String(updateError)}.` : "";
  return { applied: false, error: `Former-manager title was not confirmed: ${details}.${updateDetails}` };
}

const isQuiescent = (agent: EnvironmentAgent): boolean =>
  agent.status !== "running" && agent.activeTurn == null && (agent.pendingPermissions?.length ?? 0) === 0;

const isFresh = (startedAt: number, now: number, ttl: number): boolean => now - startedAt < ttl;

export function createLaneEnvironment(dependencies: LaneEnvironmentDependencies) {
  const { store, settings } = dependencies;
  const now = dependencies.now ?? Date.now;
  const randomId = dependencies.randomId ?? randomUUID;
  const runCli = dependencies.runPaseoCli ?? runPaseoCli;
  const warn = dependencies.warn ?? ((message: string) => console.warn(message));

  return {
    /** Only workspaces created while this daemon observes them get the default; existing ones are not adopted. */
    async onWorkspaceCreated(workspace: { id: string }): Promise<void> {
      const current = await settings();
      if (!current.activateNewWorkspaces) return;
      await store.mutate(undefined, (state) => {
        if (state.workspaces[workspace.id]) return;
        state.workspaces[workspace.id] = { ...blankRecord(), defaultActivated: true };
      });
    },

    /**
     * Before-create hook. The claim is persisted under the store's in-process
     * queue, so simultaneous creates inside one daemon elect one pending manager.
     * This is not a host-wide compare-and-set: a second daemon process sharing
     * the store file is not excluded. Paseo's create hook has no workspace id,
     * so the workspace is matched by exact directory. Failures fail open to "no
     * claim", which never creates a second manager.
     */
    async beforeAgentCreate<Request extends { config: { cwd: string; title?: string | null; internal?: boolean; systemPrompt?: string } }>(
      request: Request,
      paseo: PaseoApi,
    ): Promise<Request | undefined> {
      if (request.config.internal) return undefined;
      const explicitRoles = [...(request.config.systemPrompt ?? "").matchAll(/\[Lanes role: ([a-z0-9-]+) r\d+\]/g)]
        .map((match) => match[1]);
      // An explicitly selected non-manager role is authoritative. A pre-composed manager role may
      // still win the workspace's first-manager claim, but the shared composer leaves it intact.
      if (explicitRoles.some((role) => role !== "lane-manager")) return undefined;
      let claimed: { result: { title: string; requestId: string } | null };
      try {
        const current = await settings();
        if (!current.firstAgentManager) return undefined;
        const workspaceId = await workspaceIdForDirectory(paseo, request.config.cwd);
        if (!workspaceId) return undefined;
        claimed = await store.mutate(undefined, (state) => {
          const record = state.workspaces[workspaceId];
          if (!effectiveActivation(current, workspaceId, record).enabled) return null;
          if (record?.managerId) return null;
          if (record?.continuation?.status === "creating" && isFresh(record.continuation.startedAt, now(), CONTINUATION_TTL_MS)) return null;
          if (record?.pendingManager && isFresh(record.pendingManager.startedAt, now(), PENDING_MANAGER_TTL_MS)) return null;
          const title = composeRoleTitle("lane-manager", topicOf(request.config.title, current) || "Lane", current);
          const next = state.workspaces[workspaceId] ?? blankRecord();
          const requestId = randomId();
          next.pendingManager = { requestId, title, startedAt: now(), agentId: null };
          state.workspaces[workspaceId] = next;
          return { title, requestId };
        });
      } catch (error) {
        warn(`[paseo] Lanes manager election skipped: ${String(error)}`);
        return undefined;
      }
      if (!claimed.result) return undefined;

      try {
        const systemPrompt = await dependencies.managerSystemPrompt(request.config);
        return {
          ...request,
          config: {
            ...request.config,
            title: claimed.result.title,
            ...(systemPrompt !== undefined ? { systemPrompt } : {}),
          },
        };
      } catch (error) {
        try {
          await store.mutate(undefined, (state) => {
            const record = Object.values(state.workspaces).find((item) => item.pendingManager?.requestId === claimed.result!.requestId);
            if (record) record.pendingManager = null;
          });
        } catch (rollbackError) {
          warn(`[paseo] Lanes manager claim rollback failed: ${String(rollbackError)}`);
        }
        // Required role configuration/skills are not optional: fail the create visibly instead of
        // silently producing a manager session with incomplete instructions.
        throw error;
      }
    },

    /**
     * After-create notification. Paseo gives no correlation id here, so a pending
     * claim is confirmed only when the created agent carries the exact title the
     * create hook assigned. Other agents never take the claim.
     */
    async onAgentCreated(agent: { id: string; workspaceId: string | null; title: string | null }): Promise<void> {
      if (!agent.workspaceId) return;
      try {
        await store.mutate(undefined, (state) => {
          const record = state.workspaces[agent.workspaceId!];
          if (!record?.pendingManager || record.managerId) return;
          if (agent.title !== record.pendingManager.title) return;
          record.managerId = agent.id;
          record.pendingManager = null;
        });
      } catch (error) {
        warn(`[paseo] Lanes manager confirmation failed for ${agent.id}: ${String(error)}`);
      }
    },

    async status(workspaceId: string) {
      const current = await settings();
      const { storeRevision, result } = await store.mutate(undefined, (state) => viewOf(workspaceId, state, current));
      return { storeRevision, workspace: result };
    },

    /**
     * Explicit promotion of an existing agent in the same workspace. Paseo's
     * public SDK cannot rename an existing agent, so its title is left as is and
     * an advisory title is returned for a person to apply manually.
     */
    async assignManager(paseo: PaseoApi, input: { workspaceId: string; agentId: string; expectedRevision?: number }) {
      const agent = await readAgent(paseo, input.agentId);
      if (agent.workspaceId !== input.workspaceId) throw new EnvironmentError(`Agent ${input.agentId} is not in workspace ${input.workspaceId}.`);
      if (agent.archivedAt) throw new EnvironmentError(`Agent ${input.agentId} is archived and cannot be assigned as manager.`);
      const current = await settings();
      const topic = topicOf(agent.title, current) || "Lane";
      const { storeRevision, result } = await store.mutate(input.expectedRevision, (state) => {
        const record = state.workspaces[input.workspaceId] ?? blankRecord();
        const previous = record.managerId;
        if (previous && previous !== agent.id) {
          record.demoted = [...record.demoted, { agentId: previous, demotedAt: now() }];
        }
        record.managerId = agent.id;
        record.pendingManager = null;
        state.workspaces[input.workspaceId] = record;
        return { workspace: viewOf(input.workspaceId, state, current), previousManagerId: previous };
      });

      let formerManagerTitleApplied: boolean | null = null;
      let formerManagerTitleError: string | null = null;
      let formerManagerAdvisoryTitle: string | null = null;
      if (result.previousManagerId && result.previousManagerId !== agent.id) {
        formerManagerAdvisoryTitle = formerManagerTitle("Lane");
        try {
          const previous = await readAgent(paseo, result.previousManagerId);
          const topic = topicOf(previous.title, current) || "Lane";
          formerManagerAdvisoryTitle = formerManagerTitle(topic);
          const titleResult = await applyFormerManagerTitle(paseo, runCli, {
            agentId: previous.id, workspaceId: input.workspaceId, expectedCwd: previous.cwd ?? "",
            previousTitle: previous.title, formerTitle: formerManagerTitle(topic),
            isStillFormerManager: async () => (await store.read()).workspaces[input.workspaceId]?.managerId === agent.id,
          });
          formerManagerTitleApplied = titleResult.applied;
          formerManagerTitleError = titleResult.error;
        } catch (error) {
          formerManagerTitleApplied = false;
          formerManagerTitleError = `Former-manager title was not changed: ${String(error)}`;
        }
      }
      return {
        storeRevision,
        workspace: result.workspace,
        titleApplied: false as const,
        advisoryTitle: composeRoleTitle("lane-manager", topic, current),
        formerManagerTitleApplied,
        formerManagerTitleError,
        formerManagerAdvisoryTitle,
      };
    },

    /**
     * Explicit continuation. Creates a new session in the same workspace with the
     * checkpoint as its initial prompt. The previous session keeps its transcript;
     * after promotion, a verified public CLI call attempts to mark its title as former.
     * Nothing is forked, cloned or moved to another provider.
     */
    async continueManager(paseo: PaseoApi, input: { workspaceId: string; fromAgentId: string; expectedRevision?: number; checkpoint: string }) {
      const current = await settings();
      const from = await readAgent(paseo, input.fromAgentId);
      if (from.workspaceId !== input.workspaceId) throw new EnvironmentError(`Agent ${input.fromAgentId} is not in workspace ${input.workspaceId}.`);
      if (from.archivedAt) throw new EnvironmentError(`Agent ${input.fromAgentId} is archived; continue from a live manager.`);
      if (!from.runtimeInfo?.provider) throw new EnvironmentError("The current manager's provider is unknown; continuation needs a known provider and will not switch providers.");
      if (!isQuiescent(from)) throw new EnvironmentError(`Manager ${input.fromAgentId} is still running or waiting; wait for it to become idle before continuing so only one writer is active.`);

      const started = await store.mutate(input.expectedRevision, (state) => {
        const record = state.workspaces[input.workspaceId];
        if (!record || record.managerId !== input.fromAgentId) {
          throw new EnvironmentError(`Agent ${input.fromAgentId} is not the current manager of ${input.workspaceId}.`);
        }
        const existing = record.continuation;
        if (existing?.status === "creating" && isFresh(existing.startedAt, now(), CONTINUATION_TTL_MS)) {
          throw new EnvironmentError(`A continuation for ${input.workspaceId} is already creating session ${existing.requestId}. Check status before retrying.`);
        }
        // A stale creating record keeps its request id so the SDK idempotency key can return an agent already created.
        const requestId = existing?.status === "creating" ? existing.requestId : randomId();
        record.continuation = { requestId, fromAgentId: input.fromAgentId, status: "creating", startedAt: now(), error: null, toAgentId: null };
        return { requestId };
      });

      const topic = topicOf(from.title, current) || "Lane";
      const title = composeRoleTitle("lane-manager", topic, current);
      const provider = from.runtimeInfo.model ? `${from.runtimeInfo.provider}/${from.runtimeInfo.model}` : from.runtimeInfo.provider;
      const prompt = [
        `You are continuing Lanes manager coordination for workspace ${input.workspaceId} from session ${input.fromAgentId}.`,
        "This is a new session started from an explicit checkpoint. It is not a native fork or transcript clone, and the previous transcript is not loaded here.",
        "Checkpoint from the previous manager:",
        input.checkpoint,
        "Verify each reference against the Lanes records before acting. Do not assume decisions that are not in the checkpoint.",
      ].join("\n\n");

      let created: { id: string };
      try {
        created = await paseo.workspaces.ref(input.workspaceId).agents.create({
          idempotencyKey: started.result.requestId,
          config: { provider },
          title,
          prompt,
        });
      } catch (error) {
        await store.mutate(undefined, (state) => {
          const record = state.workspaces[input.workspaceId];
          if (record?.continuation?.requestId === started.result.requestId) {
            record.continuation = { ...record.continuation, status: "failed", error: String(error) };
          }
        });
        throw error;
      }

      const finished = await store.mutate(undefined, (state) => {
        const record = state.workspaces[input.workspaceId];
        if (!record || record.managerId !== input.fromAgentId) {
          throw new EnvironmentError(`Manager changed while ${created.id} was created; the new session was not promoted.`);
        }
        record.demoted = [...record.demoted, { agentId: input.fromAgentId, demotedAt: now() }];
        record.managerId = created.id;
        record.continuation = null;
        return viewOf(input.workspaceId, state, current);
      }).catch((error) => {
        throw new EnvironmentError(`Created session ${created.id}, but recording it failed: ${String(error)}. Retry continuation with the same checkpoint to reconcile.`);
      });

      const titleResult = await applyFormerManagerTitle(paseo, runCli, {
        agentId: from.id, workspaceId: input.workspaceId, expectedCwd: from.cwd ?? "",
        previousTitle: from.title, formerTitle: formerManagerTitle(topic),
        isStillFormerManager: async () => (await store.read()).workspaces[input.workspaceId]?.managerId === created.id,
      });

      let demotionNotice: "sent" | "failed" = "sent";
      try {
        await paseo.agents.ref(input.fromAgentId).send(
          `Lanes manager coordination for this workspace moved to ${created.id}. You are no longer the manager. Stop issuing manager writes and hand off through the Lanes procedure.`,
        );
      } catch (error) {
        demotionNotice = "failed";
        warn(`[paseo] Could not notify previous manager ${input.fromAgentId}: ${String(error)}`);
      }

      return {
        storeRevision: finished.storeRevision,
        workspace: finished.result,
        newAgentId: created.id,
        demotionNotice,
        limitations: [
          "The new session is not a native fork or transcript clone; history is available only through the checkpoint.",
          "No provider switch was performed; the new session uses the previous manager's provider and model.",
          ...(titleResult.applied ? [] : [`The previous manager title was not changed: ${titleResult.error}.`]),
        ],
        titleApplied: titleResult.applied,
        titleError: titleResult.error,
        advisoryTitle: formerManagerTitle(topic),
      };
    },
  };
}

export type LaneEnvironmentService = ReturnType<typeof createLaneEnvironment>;
