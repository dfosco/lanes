import type { PluginClientContext, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import contribute from "../index.client";
import { WorkspaceWorkScreen } from "./workspace-panel";
import { WorkScreen } from "./work-screen";

const { useWorkspace } = vi.hoisted(() => ({ useWorkspace: vi.fn() }));
vi.mock("@getpaseo/plugin/client", () => ({ useWorkspace }));
vi.mock("@getpaseo/plugin/client/ui", () => ({ SidebarRow: () => null }));
vi.mock("./work-screen", () => ({ WorkScreen: () => null }));
vi.mock("./settings", () => ({ SettingsScreen: () => null }));
vi.mock("./lane-composer", () => ({ registerLaneComposerPills: () => () => undefined }));

function register() {
  const client = {
    addScreen: vi.fn(), addSidebarHeaderItem: vi.fn(), addWorkspacePanel: vi.fn(),
    addSettingsScreen: vi.fn(), addCommandCenterItem: vi.fn(), openSettings: vi.fn(), openPanel: vi.fn(),
  };
  contribute(client as unknown as PluginClientContext);
  return client;
}

describe("Lanes workspace contributions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("makes the same board available in workspace tabs and Explorer with settings intact", () => {
    const client = register();
    const panel = client.addWorkspacePanel.mock.calls[0][0];
    expect(panel).toMatchObject({
      id: "work", title: "Lanes", context: "workspace", locations: ["workspace", "explorer"],
    });
    const element = panel.Component({ workspaceId: "workspace-1" });
    expect(element.type).toBe(WorkspaceWorkScreen);
    expect(element.key).toBe("workspace-1");
    element.props.onOpenSettings();
    expect(client.openSettings).toHaveBeenCalledWith("preferences");
    element.props.onOpenLanePanel("workspace-2");
    expect(client.openPanel).toHaveBeenCalledWith("work", { workspaceId: "workspace-2", location: "explorer" });
    const screen = client.addScreen.mock.calls[0][0].Component({});
    screen.props.onOpenLanePanel("workspace-3");
    expect(client.openPanel).toHaveBeenCalledWith("work", { workspaceId: "workspace-3", location: "explorer" });

    const command = client.addCommandCenterItem.mock.calls.map(([item]) => item)
      .find((item) => item.context === "workspace");
    const openPanel = vi.fn();
    command.onSelect({ openPanel });
    expect(openPanel).toHaveBeenCalledWith("work", { location: "workspace" });
    expect(client.addScreen.mock.calls[0][0]).toMatchObject({ id: "work", title: "Lanes" });
    expect(client.addSidebarHeaderItem.mock.calls[0][0]).toMatchObject({ id: "clips", title: "Lanes" });
  });

  it("reads the panel's workspace project from cached state and passes host navigation through", () => {
    useWorkspace.mockImplementation((id, select) => {
      expect(id).toBe("workspace-1");
      return select({ projectId: "linked-project" });
    });
    const navigation = { openWorkspace: vi.fn(), openAgent: vi.fn() };
    const onOpenLanePanel = vi.fn();
    const props = { workspaceId: "workspace-1", navigation, onOpenLanePanel } as unknown as PluginWorkspacePanelProps;
    const element = WorkspaceWorkScreen(props);
    expect(element.type).toBe(WorkScreen);
    expect(element.props.preferredProjectId).toBe("linked-project");
    expect(element.props.currentWorkspaceId).toBe("workspace-1");
    expect(element.props.currentWorkspaceProjectId).toBe("linked-project");
    expect(element.props.workspaceMatchesProject).toBeUndefined();
    expect(element.props.navigation).toBe(navigation);
    expect(element.props.onOpenLanePanel).toBe(onOpenLanePanel);
  });

  it("leaves the board's project fallback available when workspace state is missing", () => {
    useWorkspace.mockReturnValue(null);
    const element = WorkspaceWorkScreen({ workspaceId: "missing" } as PluginWorkspacePanelProps);
    expect(element.props.preferredProjectId).toBeUndefined();
  });
});
