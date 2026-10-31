import { randomUUID } from "node:crypto";
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

const isQuiescent = (agent: EnvironmentAgent): boolean =>
  agent.status !== "running" && agent.activeTurn == null && (agent.pendingPermissions?.length ?? 0) === 0;

const isFresh = (startedAt: number, now: number, ttl: number): boolean => now - startedAt < ttl;

export function createLaneEnvironment(dependencies: LaneEnvironmentDependencies) {
  const { store, settings } = dependencies;
  const now = dependencies.now ?? Date.now;
  const randomId = dependencies.randomId ?? randomUUID;
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
    async beforeAgentCreate<Request extends { config: { cwd: string; title?: string | null; internal?: boolean } }>(
      request: Request,
      paseo: PaseoApi,
    ): Promise<Request | undefined> {
      if (request.config.internal) return undefined;
      try {
        const current = await settings();
        if (!current.firstAgentManager) return undefined;
        const workspaceId = await workspaceIdForDirectory(paseo, request.config.cwd);
        if (!workspaceId) return undefined;
        const claimed = await store.mutate(undefined, (state) => {
          const record = state.workspaces[workspaceId];
          if (!effectiveActivation(current, workspaceId, record).enabled) return null;
          if (record?.managerId) return null;
          if (record?.continuation?.status === "creating" && isFresh(record.continuation.startedAt, now(), CONTINUATION_TTL_MS)) return null;
          if (record?.pendingManager && isFresh(record.pendingManager.startedAt, now(), PENDING_MANAGER_TTL_MS)) return null;
          const title = composeRoleTitle("lane-manager", topicOf(request.config.title, current) || "Lane", current);
          const next = state.workspaces[workspaceId] ?? blankRecord();
          next.pendingManager = { requestId: randomId(), title, startedAt: now(), agentId: null };
          state.workspaces[workspaceId] = next;
          return { title };
        });
        if (!claimed.result) return undefined;
        return { ...request, config: { ...request.config, title: claimed.result.title } };
      } catch (error) {
        warn(`[paseo] Lanes manager election skipped: ${String(error)}`);
        return undefined;
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
        return viewOf(input.workspaceId, state, current);
      });
      return {
        storeRevision,
        workspace: result,
        titleApplied: false as const,
        advisoryTitle: composeRoleTitle("lane-manager", topic, current),
      };
    },

    /**
     * Explicit continuation. Creates a new session in the same workspace with the
     * checkpoint as its initial prompt. The previous session keeps its transcript
     * and title. Nothing is forked, cloned or moved to another provider.
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
          `The previous manager keeps its existing title because Paseo's public SDK cannot rename an existing agent. Advisory title: ${formerManagerTitle(topic)}.`,
        ],
      };
    },
  };
}

export type LaneEnvironmentService = ReturnType<typeof createLaneEnvironment>;
