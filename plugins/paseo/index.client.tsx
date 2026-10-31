
import type { PluginClientContext, PluginSidebarItemProps, PluginScreenProps, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { WorkScreen } from "./client/work-screen";
import { SettingsScreen } from "./client/settings";
import { WorkspaceWorkScreen } from "./client/workspace-panel";

const TITLE = "Lanes";

function SidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="ListTodo"
      active={currentScreen?.screenId === "work"}
      onPress={() => openScreen({ screenId: "work" })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  const onOpenLanePanel = (workspaceId: string) => client.openPanel("work", { workspaceId, location: "explorer" });
  const Screen = (props: PluginScreenProps) => (
    <WorkScreen {...props} onOpenSettings={() => client.openSettings("preferences")} onOpenLanePanel={onOpenLanePanel} />
  );
  const Panel = (props: PluginWorkspacePanelProps) => (
    <WorkspaceWorkScreen key={props.workspaceId} {...props} onOpenSettings={() => client.openSettings("preferences")} onOpenLanePanel={onOpenLanePanel} />
  );
  client.addScreen({ id: "work", title: TITLE, Component: Screen });
  client.addSidebarHeaderItem({ id: "clips", title: TITLE, Component: SidebarItem });
  client.addWorkspacePanel({
    id: "work",
    title: TITLE,
    icon: "ListTodo",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: Panel,
  });
  client.addSettingsScreen({
    id: "preferences",
    title: "Settings",
    icon: "Settings",
    Component: SettingsScreen,
  });
  client.addCommandCenterItem({
    id: "open-clips",
    title: "Open Lanes",
    icon: "ListTodo",
    context: "global",
    onSelect: ({ openScreen }) => openScreen({ screenId: "work" }),
  });
  client.addCommandCenterItem({
    id: "open-clips-workspace",
    title: "Open Lanes as workspace tab",
    icon: "ListTodo",
    keywords: ["clips", "lanes", "goals", "tasks", "workspace", "tab"],
    context: "workspace",
    onSelect: ({ openPanel }) => openPanel("work", { location: "workspace" }),
  });
  return () => {};
}
