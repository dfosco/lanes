import type { PluginServerContext } from "@getpaseo/plugin/server";
import { describe, expect, it, vi } from "vitest";
import { resourceManagerPreferences, resourceManagerStatusRpc } from "../shared/resource-manager";
import contribute from "../index.server";

const mocked = vi.hoisted(() => ({
  bind: vi.fn(), dispose: vi.fn(), settingsChanged: vi.fn(), status: vi.fn(() => ({ state: "monitoring" })),
  create: vi.fn(),
}));
vi.mock("./resource-manager", () => ({ createResourceManager: (input: unknown) => {
  mocked.create(input);
  return { bind: mocked.bind, dispose: mocked.dispose, settingsChanged: mocked.settingsChanged, status: mocked.status };
} }));

describe("resource monitor plugin lifecycle", () => {
  it("creates one host monitor, binds from public hooks/RPCs, and releases its own resources", async () => {
    vi.clearAllMocks();
    const handlers = new Map<string, Function>(), hooks = new Map<string, Function>();
    const releases: ReturnType<typeof vi.fn>[] = [];
    let changed!: () => void;
    const unsubscribe = vi.fn();
    const server = {
      registerSettings: vi.fn((definition) => ({
        read: async () => ({ status: "ready", values: definition.schema.parse({}), revision: "1" }),
        subscribe: (listener: () => void) => { changed = listener; return unsubscribe; },
      })),
      handle: (definition: { name: string }, handler: Function) => handlers.set(definition.name, handler),
      on: (name: string, hook: Function) => { hooks.set(name, hook); const release = vi.fn(); releases.push(release); return release; },
      before: (name: string, hook: Function) => { hooks.set(name, hook); const release = vi.fn(); releases.push(release); return release; },
    } as unknown as PluginServerContext;
    const cleanup = contribute(server);
    expect(mocked.create).toHaveBeenCalledTimes(1);
    expect(server.registerSettings).toHaveBeenCalledWith(resourceManagerPreferences);
    const paseo = { agents: {} };
    expect(await hooks.get("agent.session_open")!({ request: {} }, { paseo, signal: new AbortController().signal })).toBeUndefined();
    hooks.get("agent.turn_ended")!({}, { paseo });
    expect(handlers.get(resourceManagerStatusRpc.name)!({}, { paseo })).toEqual({ state: "monitoring" });
    expect(mocked.bind).toHaveBeenCalledTimes(3);
    changed(); expect(mocked.settingsChanged).toHaveBeenCalledTimes(1);
    cleanup();
    expect(mocked.dispose).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(releases).toHaveLength(10);
    for (const release of releases) expect(release).toHaveBeenCalledTimes(1);
  });
});
