import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Runtime state only. Explicit enable/disable is a host setting saved by the
 * client; `defaultActivated` records that this daemon saw the workspace created
 * while new-workspace activation was on.
 */
export type WorkspaceRecord = {
  defaultActivated: boolean;
  managerId: string | null;
  /** Manager claim made by the create hook; confirmed when a matching agent is created. */
  pendingManager: { requestId: string; title: string; startedAt: number; agentId: string | null } | null;
  continuation: {
    requestId: string; fromAgentId: string; status: "creating" | "failed"; startedAt: number;
    error: string | null; toAgentId: string | null;
  } | null;
  demoted: { agentId: string; demotedAt: number }[];
};

export type EnvironmentState = {
  version: 1;
  revision: number;
  workspaces: Record<string, WorkspaceRecord>;
};

export type MutationResult<T> = { result: T; storeRevision: number };

export class StaleRevisionError extends Error {
  constructor(expected: number, actual: number) {
    super(`Lanes environment state changed (expected revision ${expected}, current ${actual}). Reload the workspace state and retry.`);
  }
}

export function emptyEnvironmentState(): EnvironmentState {
  return { version: 1, revision: 0, workspaces: {} };
}

/** Plugin-owned runtime state, separate from Lanes records and project files. */
export function laneEnvironmentStateFile(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.LANES_HOME?.trim() || env.CLIPS_HOME?.trim() || path.join(os.homedir(), ".lanes");
  return path.join(home, "paseo", "lane-environment.json");
}

/**
 * Serialised read-modify-write over one JSON file. Mutations run one at a time
 * inside this daemon process and are persisted atomically before they return.
 * This does not add cross-process locking or a host-wide compare-and-set.
 */
export function createLaneEnvironmentStore(file: string) {
  let queue: Promise<unknown> = Promise.resolve();

  async function load(): Promise<EnvironmentState> {
    let text: string;
    try {
      text = await fs.readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyEnvironmentState();
      throw error;
    }
    const parsed = JSON.parse(text) as Partial<EnvironmentState>;
    if (parsed.version !== 1 || typeof parsed.revision !== "number" || typeof parsed.workspaces !== "object" || parsed.workspaces === null) {
      throw new Error(`Lanes environment state at ${file} is not a version 1 store; refusing to overwrite it.`);
    }
    return parsed as EnvironmentState;
  }

  async function save(state: EnvironmentState): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporary, file);
  }

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = queue.then(task, task);
    queue = next.catch(() => undefined);
    return next;
  }

  return {
    file,
    read: () => enqueue(load),
    /**
     * Applies `change` to a copy of the state. The state is persisted only when
     * `change` returns without throwing and the copy differs from the stored one.
     */
    mutate<T>(
      expectedRevision: number | undefined,
      change: (state: EnvironmentState) => T | Promise<T>,
    ): Promise<MutationResult<T>> {
      return enqueue(async () => {
        const stored = await load();
        if (expectedRevision !== undefined && expectedRevision !== stored.revision) {
          throw new StaleRevisionError(expectedRevision, stored.revision);
        }
        const draft = structuredClone(stored);
        const result = await change(draft);
        const changed = JSON.stringify(draft.workspaces) !== JSON.stringify(stored.workspaces);
        if (changed) {
          draft.revision = stored.revision + 1;
          await save(draft);
          return { result, storeRevision: draft.revision };
        }
        return { result, storeRevision: stored.revision };
      });
    },
  };
}

export type LaneEnvironmentStore = ReturnType<typeof createLaneEnvironmentStore>;
