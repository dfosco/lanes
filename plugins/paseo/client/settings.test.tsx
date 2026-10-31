// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collaborationRpc, projectsRpc, roleModelDefaultsRpc, saveRoleModelDefaultsRpc } from "../shared/contracts";
import { SettingsScreen } from "./settings";

const state = vi.hoisted(() => ({
  projectRpc: vi.fn(), boardRpc: vi.fn(), collaborationRpc: vi.fn(), roleDefaultsRpc: vi.fn(), saveRoleDefaultsRpc: vi.fn(),
  routingPolicyRpc: vi.fn(), saveRoutingPolicyRpc: vi.fn(),
  settingsSave: vi.fn(), cache: [] as any[], collaborationPromise: undefined as undefined | { resolve: (value: any) => void; reject: (error: Error) => void },
}));
const values = {
  agent: "codex/legacy", thinkingOptionId: "high", featureValues: { old: true }, modeId: "restricted",
  roles: {
    manager: { provider: "", legacyModelMigrated: false, featureValues: { fast: true }, modeId: "restricted" },
    dev: { provider: "", legacyModelMigrated: false, featureValues: {}, modeId: "full-access" },
  },
};
vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: (rpc: { name: string }) => rpc.name === "clips.projects" ? state.projectRpc
    : rpc.name === "clips.board" ? state.boardRpc : rpc.name === "clips.collaboration.set" ? state.collaborationRpc
      : rpc.name === "clips.role-model-defaults" ? state.roleDefaultsRpc : rpc.name === "clips.role-model-defaults.save" ? state.saveRoleDefaultsRpc
        : rpc.name === "clips.model-routing-policy" ? state.routingPolicyRpc : state.saveRoutingPolicyRpc,
  usePaseo: () => ({ providers: { snapshot: async () => ({ entries: [{ provider: "codex", label: "Codex", status: "ready", enabled: true,
    models: [{ id: "model", isSelectable: true, thinkingOptions: [{ id: "high" }] }] }] }) } }),
  useSettings: () => ({ status: "ready", values, revision: "r3", saving: false, saveError: null, save: state.settingsSave }),
}));
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { createElement: h } = await import("react");
  return {
    SettingsSection: ({ title, children }: any) => h("section", { "aria-label": title }, children),
     SettingsCard: ({ children }: any) => h("div", {}, children),
     SettingsInput: ({ label, initialValue, placeholder, onChangeText }: any) => h("label", {}, label,
       h("input", { "aria-label": label, defaultValue: initialValue, placeholder, onInput: (event: any) => onChangeText(event.currentTarget.value) })),
    SettingsAction: ({ label, hint, actionLabel, disabled, onPress }: any) => h("div", {},
      h("span", {}, label), h("span", {}, hint), h("button", { "aria-label": actionLabel, disabled, onClick: onPress }, actionLabel)),
    SettingsSelect: ({ label, value, options, onValueChange }: any) => h("label", {}, label,
      h("select", { "aria-label": label, value, onChange: (event: any) => onValueChange(event.target.value) },
        options.map((option: any) => h("option", { key: option.value, value: option.value }, option.label)))),
  };
});
vi.mock("react-native", async () => {
  const { createElement: h } = await import("react");
  return {
     View: ({ children, accessibilityLabel, style }: any) => h("div", { "aria-label": accessibilityLabel, style }, children),
    Text: ({ children }: any) => h("span", {}, children),
    Pressable: ({ children, accessibilityRole, onPress }: any) => h("button", { role: accessibilityRole, onClick: onPress }, children),
    ActivityIndicator: () => h("span", {}, "Loading"),
  };
});
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const { createElement: h } = await import("react");
  return { TextInput: ({ accessibilityLabel, placeholder, value, onChangeText }: any) => h("input", {
    "aria-label": accessibilityLabel, placeholder, value, onInput: (event: any) => onChangeText(event.currentTarget.value),
  }) };
});
vi.mock("./agent-configuration", async () => {
  const { createElement: h } = await import("react");
  return { AgentConfigFields: (props: any) => h("div", {},
    h("label", {}, "Paseo agent", h("select", { "aria-label": "Paseo agent", value: props.agent,
      onChange: (event: any) => props.onAgentChange(event.target.value) },
      h("option", { value: "" }, "Automatic"), h("option", { value: "codex/model" }, "codex/model"))),
    h("label", {}, "Thinking", h("select", { "aria-label": "Thinking", value: props.thinkingOptionId,
      onChange: (event: any) => props.onThinkingChange(event.target.value) },
      h("option", { value: "" }, "Paseo default"), h("option", { value: "high" }, "High"), h("option", { value: "medium" }, "Medium"))),
    h("label", {}, "Permission mode", h("select", { "aria-label": "Permission mode", value: props.modeId,
      onChange: (event: any) => props.onModeChange(event.target.value) },
      h("option", { value: "full-access" }, "Full access"), h("option", { value: "restricted" }, "Restricted"))),
    h("button", { "aria-label": "Clear provider features", onClick: () => props.onFeatureValuesChange({}) }, "Clear features"),
  ) };
});
vi.mock("@tanstack/react-query", async () => {
  const { useState } = await import("react");
  return {
    useQuery: ({ queryKey }: any) => {
      if (queryKey[0] === "clips.settings.projects") return { data: { projects: [
        { projectId: "p1", projectIds: ["p1"], label: "Project one" }, { projectId: "p2", projectIds: ["p2"], label: "Project two" },
      ] } };
      if (queryKey[0] === "clips.settings.collaboration") return { data: { collaboration: {
        enabled: queryKey[1] === "p1", state: "enabled", scope: "project",
      } } };
      if (queryKey[0] === "clips.role-defaults") return { data: { role: queryKey[1], model: "model", agent: "codex/model",
        reasoningEffort: "high", source: "user" }, refetch: vi.fn() };
      if (queryKey[0] === "clips.role-defaults.providers" || queryKey[0] === "clips.routing.providers") return { data: [
        { provider: "codex", label: "Codex", status: "ready", enabled: true, models: [{ id: "model" }] },
      ] };
      if (queryKey[0] === "clips.model-routing-policy") return { data: { version: 1, providerOrder: [], modelOrder: { manager: [], dev: [] },
        reasoningEffortOrder: ["low", "medium", "high"], warningThresholds: [80, 90], handoffThreshold: 95 }, refetch: vi.fn() };
      return { isLoading: false };
    },
    useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: (...args: any[]) => state.cache.push(args) }),
    useMutation: (options: any) => {
      const [snapshot, setSnapshot] = useState<any>({ isPending: false, isError: false, variables: undefined });
      return { ...snapshot, mutate: (variables: any) => {
        setSnapshot({ isPending: true, isError: false, variables });
        if (variables?.projectId) {
          state.collaborationPromise = undefined;
          const pending = new Promise((resolve, reject) => { state.collaborationPromise = { resolve, reject }; });
          void pending.then((result) => options.onSuccess(result, variables)).catch((error) => options.onError?.(error, variables)).finally(() => setSnapshot({ isPending: false, isError: false, variables }));
        } else {
          void options.mutationFn(variables).then((result: any) => options.onSuccess?.(result, variables))
            .catch((error: any) => setSnapshot({ isPending: false, isError: true, error, variables }));
        }
      } };
    },
  };
});

const theme = { colors: { foreground: "#fff", foregroundMuted: "#aaa", border: "#444", accent: "#58f",
  accentForeground: "#fff", statusDanger: "#f44" } } as any;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks(); state.cache = []; state.collaborationPromise = undefined;
  state.projectRpc.mockResolvedValue({ projects: [] });
  state.boardRpc.mockResolvedValue({ collaboration: { enabled: false, state: "disabled", scope: "project" } });
  state.collaborationRpc.mockResolvedValue({});
  state.roleDefaultsRpc.mockResolvedValue({});
  state.saveRoleDefaultsRpc.mockResolvedValue({});
  state.routingPolicyRpc.mockResolvedValue({});
  state.saveRoutingPolicyRpc.mockResolvedValue({});
  state.settingsSave.mockResolvedValue(true);
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = async () => act(async () => root.render(createElement(SettingsScreen, { theme, host: { id: "host" } } as any)));
const button = (label: string) => {
  const found = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.getAttribute("aria-label") === label || item.textContent === label);
  expect(found, label).toBeTruthy(); return found!;
};
const select = async (label: string, value: string) => act(async () => {
  const found = Array.from(container.querySelectorAll<HTMLSelectElement>("select")).find((item) => item.getAttribute("aria-label") === label);
  expect(found, label).toBeTruthy();
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(found, value);
  found!.dispatchEvent(new Event("change", { bubbles: true }));
});

describe("Settings subviews", () => {
  it("allows copying a legacy/global role value into the selected provider slot", async () => {
    await render(); await act(async () => { button("Lane Manager").click(); }); await render();
    expect(button("Save provider defaults").disabled).toBe(false);
    await act(async () => { button("Save provider defaults").click(); });
    expect(state.saveRoleDefaultsRpc).toHaveBeenCalledWith({ role: "manager", provider: "codex", model: "model", reasoningEffort: "high" });
  });

  it("saves explicit Automatic, empty feature values, and full access instead of falling back to untouched values", async () => {
    await render(); await act(async () => { button("Lane Manager").click(); }); await render();
    await select("Paseo agent", ""); await select("Thinking", ""); await select("Permission mode", "full-access");
    await act(async () => { button("Clear features").click(); });
    await act(async () => { button("Save provider defaults").click(); });
    expect(state.settingsSave).toHaveBeenCalledWith(expect.objectContaining({ roles: expect.objectContaining({
      manager: expect.objectContaining({ legacyModelMigrated: true, featureValues: {}, modeId: "full-access" }),
    }) }), "r3");
    expect(state.saveRoleDefaultsRpc).toHaveBeenCalledWith({ role: "manager", provider: "codex", model: "", reasoningEffort: "" });
  });

  it("renders padded settings content and exposes the ordered routing policy editor", async () => {
    for (const width of [390, 1440]) {
      await act(async () => { Object.defineProperty(window, "innerWidth", { configurable: true, value: width }); });
      await render();
      if (!container.querySelector('input[aria-label="Usage warning thresholds (%)"]')) {
        await act(async () => { button("Routing").click(); }); await render();
      }
      expect(container.textContent).toContain("Provider-specific role defaults are configured");
      expect(container.querySelector<HTMLInputElement>('input[aria-label="Usage warning thresholds (%)"]')?.placeholder).toBe("80, 90");
      const padded = Array.from(container.querySelectorAll("div")).find((item) => item.style.padding === "16px");
      expect(padded, `settings card padding at ${width}px`).toBeTruthy();
    }
  });

  it("keeps an in-flight collaboration result scoped to the project that initiated it", async () => {
    await render();
    await act(async () => { button("Disable").click(); });
    expect(state.collaborationPromise).toBeTruthy();
    await select("Project", "p2"); await render();
    expect(container.textContent).not.toContain("Saving…");
    expect(container.textContent).not.toContain("Could not update project collaboration");
    await act(async () => { state.collaborationPromise!.resolve({ collaboration: { enabled: true } }); await Promise.resolve(); });
    expect(state.cache).toContainEqual([["clips.settings.collaboration", "p1"], { collaboration: { enabled: true } }]);
    expect(state.cache).not.toContainEqual(expect.arrayContaining([["clips.settings.collaboration", "p2"]]));
  });
});
