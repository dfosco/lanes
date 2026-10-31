import { describe, expect, it, vi } from "vitest";
import contribute from "./index.client";

const state = vi.hoisted(() => ({ registerPills: vi.fn(() => vi.fn()) }));
vi.mock("@getpaseo/plugin/client/ui", () => ({ SidebarRow: () => null }));
vi.mock("./client/work-screen", () => ({ WorkScreen: () => null }));
vi.mock("./client/settings", () => ({ SettingsScreen: () => null }));
vi.mock("./client/workspace-panel", () => ({ WorkspaceWorkScreen: () => null }));
vi.mock("./client/lane-composer", () => ({ registerLaneComposerPills: state.registerPills }));

describe("Lanes client entry", () => {
  it("provides an empty-workspace Command Center route and cleans up agent pills", async () => {
    const commands: any[] = [];
    const panel = vi.fn();
    const client = {
      openPanel: vi.fn(), openSettings: vi.fn(),
      addScreen: vi.fn(), addSidebarHeaderItem: vi.fn(), addWorkspacePanel: vi.fn(), addSettingsScreen: vi.fn(),
      addCommandCenterItem: (item: unknown) => { commands.push(item); return () => undefined; },
      addComposerPill: vi.fn(), paseo: {},
    };
    const cleanup = contribute(client as any);
    const workspaceAction = commands.find((item) => item.id === "open-clips-workspace");
    expect(workspaceAction.title).toContain("workspace");
    expect(workspaceAction.context).toBe("workspace");
    await workspaceAction.onSelect({ openPanel: panel });
    expect(panel).toHaveBeenCalledWith("work", { location: "workspace" });
    cleanup();
    expect(state.registerPills).toHaveBeenCalledWith(client);
    expect(state.registerPills.mock.results.at(-1)?.value).toHaveBeenCalledOnce();
  });
});
