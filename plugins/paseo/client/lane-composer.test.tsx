import { describe, expect, it, vi } from "vitest";
vi.mock("./lane-environment", () => ({ LaneComposerPopover: () => null }));
import { registerLaneComposerPills } from "./lane-composer";

const agent = (id: string, workspaceId: string | null, status = "idle") => ({ agent: {
  id, workspaceId, status, title: id, provider: "openai", cwd: "/workspace", labels: {},
} });
const page = (entries: any[]) => ({ entries, pageInfo: { hasMore: false, nextCursor: null } });

describe("Lanes composer pill registrations", () => {
  it("registers exact current-host agent/workspace context, removes closed agents, and cleans up", async () => {
    let listed = [agent("agent-1", "workspace-1")];
    let update: (() => void) | undefined;
    const remove = vi.fn();
    const addComposerPill = vi.fn((contribution: any) => ({ update: vi.fn(), remove }));
    const subscription = { subscribe: vi.fn((callbacks: any) => { update = callbacks.update; }), release: vi.fn() };
    const paseo = { agents: { list: vi.fn(async (input: any) => input.subscribe
      ? { ...page(listed), subscription }
      : page(listed)) } };
    const cleanup = registerLaneComposerPills({ paseo, addComposerPill } as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(addComposerPill).toHaveBeenCalledWith(expect.objectContaining({
      id: "lanes-workspace", workspaceId: "workspace-1", agentId: "agent-1",
      button: expect.objectContaining({ label: "Lanes", behavior: expect.objectContaining({ kind: "popover" }) }),
    }));

    listed = [agent("agent-1", "workspace-1", "closed")];
    update?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(remove).toHaveBeenCalledOnce();
    cleanup();
    expect(subscription.release).toHaveBeenCalledOnce();
  });

  it("keeps a current pill during a temporary same-host listing error", async () => {
    let fail = false;
    const remove = vi.fn();
    const addComposerPill = vi.fn(() => ({ update: vi.fn(), remove }));
    const subscription = { subscribe: vi.fn((callbacks: any) => { subscription.update = callbacks.update; }),
      update: undefined as undefined | (() => void), release: vi.fn() };
    const paseo = { agents: { list: vi.fn(async (input: any) => {
      if (fail && !input.subscribe) throw new Error("offline");
      return { ...page([agent("agent-1", "workspace-1")]), subscription };
    }) } };
    const cleanup = registerLaneComposerPills({ paseo, addComposerPill } as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
    fail = true; subscription.update?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(remove).not.toHaveBeenCalled();
    cleanup();
  });
});
