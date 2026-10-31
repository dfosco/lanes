// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultLaneEnvironmentSettings } from "../shared/lane-environment";
import { LaneWorkspaceControls } from "./lane-environment";

const state = vi.hoisted(() => ({
  settings: undefined as any, workspace: undefined as any, agents: [] as any[],
  fetchStatus: vi.fn(), assign: vi.fn(), continuation: vi.fn(), saveSettings: vi.fn(), reloadSettings: vi.fn(),
  queryKeys: [] as unknown[][], cacheWrites: [] as unknown[][],
}));
vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: (contract: { name: string }) => contract.name === "clips.lane-environment.status" ? state.fetchStatus
    : contract.name === "clips.lane-environment.assign-manager" ? state.assign : state.continuation,
  useSettings: () => state.settings,
}));
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { createElement: h } = await import("react");
  return {
    SettingsSection: ({ title, children }: any) => h("section", { "aria-label": title }, children),
    SettingsCard: ({ children }: any) => h("div", {}, children),
    SettingsAction: ({ label, actionLabel, disabled, onPress }: any) => h("div", {}, h("span", {}, label),
      h("button", { "aria-label": actionLabel, disabled, onClick: onPress }, actionLabel)),
    SettingsSelect: ({ label, value, options, onValueChange }: any) => h("label", {}, label,
      h("select", { "aria-label": label, value, onChange: (event: any) => onValueChange(event.target.value) },
        options.map((option: any) => h("option", { key: option.value, value: option.value }, option.label)))),
  };
});
vi.mock("@tanstack/react-query", async () => {
  const { useState } = await import("react");
  return {
    useQuery: ({ queryKey }: any) => { state.queryKeys.push(queryKey); return { data: state.workspace, isLoading: false, isError: false, refetch: vi.fn() }; },
    useQueryClient: () => ({
      setQueryData: (...args: unknown[]) => state.cacheWrites.push(args),
      invalidateQueries: vi.fn(),
    }),
    useMutation: (options: any) => {
      const [snapshot, setSnapshot] = useState<any>({ isPending: false, data: undefined });
      return { ...snapshot, mutate: (variables: unknown) => {
        setSnapshot((current: any) => ({ ...current, isPending: true }));
        void Promise.resolve(options.mutationFn(variables)).then(async (data) => {
          setSnapshot({ isPending: false, data }); await options.onSuccess?.(data, variables);
        }).catch((error) => { setSnapshot({ isPending: false, error }); options.onError?.(error); });
      } };
    },
  };
});
vi.mock("./runtime", () => ({ useRuntime: (hostId: string) => ({ data: { agents: state.agents }, isError: false,
  error: null, isLoading: false, refetch: vi.fn(), hostId }) }));
vi.mock("react-native", async () => {
  const { createElement: h } = await import("react");
  return {
    ActivityIndicator: () => h("span", {}, "Loading"),
    View: ({ children, accessibilityLabel, style }: any) => h("div", { "aria-label": accessibilityLabel, style }, children),
    Text: ({ children, accessibilityLabel, accessibilityRole, style }: any) => h("span", { "aria-label": accessibilityLabel, role: accessibilityRole, style }, children),
    Pressable: ({ children, accessibilityRole, accessibilityLabel, disabled, onPress }: any) =>
      h("button", { role: accessibilityRole, "aria-label": accessibilityLabel, disabled, onClick: onPress }, children),
    Switch: ({ value, onValueChange, disabled }: any) => h("input", { type: "checkbox", checked: value, disabled,
      onChange: (event: any) => onValueChange(event.currentTarget.checked) }),
    ScrollView: ({ children, style }: any) => h("div", { style }, children),
    TextInput: ({ accessibilityLabel, value, onChangeText, placeholder }: any) => h("textarea", {
      "aria-label": accessibilityLabel, value, placeholder, onInput: (event: any) => onChangeText(event.currentTarget.value),
    }),
  };
});

const theme = { colors: { foreground: "#111", foregroundMuted: "#666", border: "#aaa", accent: "#44f",
  accentForeground: "#fff", surface0: "#fff", statusSuccess: "#080", statusWarning: "#a60", statusDanger: "#b00" } } as any;
const workspace = (enabled: boolean, managerId: string | null) => ({ storeRevision: 7, workspace: {
  workspaceId: "ws-exact", enabled, enabledSource: enabled ? "explicit" : "none", managerId,
  pendingManager: null, continuation: null, demoted: [],
} });
const render = (agentId?: string) => act(async () => root.render(createElement(LaneWorkspaceControls, {
  theme, hostId: "host-selected", workspaceId: "ws-exact", agentId,
})));
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks(); state.queryKeys = []; state.cacheWrites = [];
  state.settings = { status: "ready", values: defaultLaneEnvironmentSettings(), revision: "host-settings-5", saving: false,
    saveError: null, save: state.saveSettings, reload: state.reloadSettings };
  state.workspace = workspace(false, null); state.agents = [];
  state.fetchStatus.mockResolvedValue(state.workspace);
  state.assign.mockResolvedValue({ storeRevision: 8, workspace: workspace(true, "agent-next").workspace,
    assignmentApplied: true, assignmentError: null, titleApplied: true, titleError: null,
    advisoryTitle: "🧭 Topic", formerManagerTitleApplied: false, formerManagerTitleError: "rename unavailable",
    formerManagerAdvisoryTitle: "[former Lane Manager] Topic" });
  state.continuation.mockResolvedValue({}); state.saveSettings.mockResolvedValue(true); state.reloadSettings.mockResolvedValue(undefined);
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const button = (label: string) => {
  const result = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((item) => item.getAttribute("aria-label") === label || item.textContent === label);
  expect(result, label).toBeTruthy(); return result!;
};
const select = async (label: string, value: string) => act(async () => {
  const element = Array.from(container.querySelectorAll<HTMLSelectElement>("select")).find((item) => item.getAttribute("aria-label") === label);
  expect(element, label).toBeTruthy();
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(element, value);
  element!.dispatchEvent(new Event("change", { bubbles: true }));
});

describe("workspace Lanes controls", () => {
  it("activates an empty workspace through exact selected-host settings without requiring an agent", async () => {
    await render();
    expect(container.textContent).toContain("No agents in this workspace");
    expect(button("Make selected agent Lane Manager").disabled).toBe(true);
    const activation = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => { activation.click(); });
    expect(state.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      workspaces: { "ws-exact": { enabled: true } },
    }), "host-settings-5");
    expect(state.queryKeys).toContainEqual(["clips.lane-environment.status", "host-selected", "ws-exact"]);
  });

  it("assigns the selected workspace agent and surfaces verified and failed title results", async () => {
    state.workspace = workspace(true, "agent-old");
    state.fetchStatus.mockResolvedValue(state.workspace);
    state.agents = [
      { id: "agent-old", workspaceId: "ws-exact", title: "Former manager topic", status: "idle" },
      { id: "agent-next", workspaceId: "ws-exact", title: "Topic", status: "idle" },
      { id: "agent-other-host", workspaceId: "elsewhere", title: "Do not show", status: "idle" },
    ];
    await render();
    expect(container.textContent).not.toContain("Do not show");
    await select("Agent in this workspace", "agent-next");
    await act(async () => { button("Make selected agent Lane Manager").click(); await Promise.resolve(); await Promise.resolve(); });
    expect(state.assign).toHaveBeenCalledWith({ workspaceId: "ws-exact", agentId: "agent-next", expectedRevision: 7 });
    expect(container.textContent).toContain("Manager assignment saved.");
    expect(container.textContent).toContain("applied and verified");
    expect(container.textContent).toContain("Former manager title: not applied or confirmed");
    expect(container.textContent).toContain("[former Lane Manager] Topic");
    expect(container.textContent).toContain("rename unavailable");
  });
});
