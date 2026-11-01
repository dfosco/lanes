// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsScreen } from "./settings";

const state = vi.hoisted(() => ({
  projectRpc: vi.fn(), boardRpc: vi.fn(), collaborationRpc: vi.fn(), roleDefaultsRpc: vi.fn(), saveRoleDefaultsRpc: vi.fn(),
  routingPolicyRpc: vi.fn(), saveRoutingPolicyRpc: vi.fn(),
  settingsSave: vi.fn(),
  panConfigs: [] as any[],
  agentConfigContexts: [] as { agent: string; thinkingOptionId: string; showModel?: boolean; showThinking?: boolean }[],
  roleSettings: [] as { id: string; name: string; type?: "planner" | "worker" }[],
  routingPolicy: { version: 1, providerOrder: ["codex", "opencode", "claude"],
    modelOrder: { manager: ["codex/manager", "opencode/manager"], dev: ["codex/dev", "claude/dev"] },
    reasoningEffortOrder: ["low", "medium", "high"], warningThresholds: [80, 90], handoffThreshold: 95 },
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
  useSettings: (definition: { id?: string }) => definition?.id === "agent-roles"
    ? ({ status: "ready", values: { roles: state.roleSettings }, revision: "r3", saving: false, saveError: null, save: state.settingsSave })
    : ({ status: "ready", values, revision: "r3", saving: false, saveError: null, save: state.settingsSave }),
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
     Pressable: ({ children, accessibilityRole, accessibilityLabel, disabled, onPress }: any) => h("button", {
       role: accessibilityRole, "aria-label": accessibilityLabel, disabled, onClick: onPress,
     }, children),
     ActivityIndicator: () => h("span", {}, "Loading"),
     PanResponder: { create: (config: any) => { state.panConfigs.push(config); return { panHandlers: config }; } },
   };
});
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const { createElement: h } = await import("react");
  return {
    TextInput: ({ accessibilityLabel, placeholder, value, onChangeText }: any) => h("input", {
      "aria-label": accessibilityLabel, placeholder, value, onInput: (event: any) => onChangeText(event.currentTarget.value),
    }),
    ScrollView: ({ children }: any) => h("div", {}, children),
    Modal: Object.assign(({ title, open, children }: any) => open ? h("div", { role: "dialog", "aria-label": title }, children) : null,
      { Content: ({ children }: any) => h("div", {}, children) }),
  };
});
vi.mock("./agent-configuration", async () => {
  const { createElement: h } = await import("react");
  return { AgentConfigFields: (props: any) => {
    state.agentConfigContexts.push({ agent: props.agent, thinkingOptionId: props.thinkingOptionId,
      showModel: props.showModel, showThinking: props.showThinking });
    return h("div", {},
    props.showModel === false ? null :
    h("label", {}, "Paseo agent", h("select", { "aria-label": "Paseo agent", value: props.agent,
      onChange: (event: any) => props.onAgentChange(event.target.value) },
      h("option", { value: "" }, "Automatic"), h("option", { value: "codex/model" }, "codex/model"))),
    props.showThinking === false ? null :
    h("label", {}, "Thinking", h("select", { "aria-label": "Thinking", value: props.thinkingOptionId,
      onChange: (event: any) => props.onThinkingChange(event.target.value) },
      h("option", { value: "" }, "Paseo default"), h("option", { value: "high" }, "High"), h("option", { value: "medium" }, "Medium"))),
    h("label", {}, "Permission mode", h("select", { "aria-label": "Permission mode", value: props.modeId,
      onChange: (event: any) => props.onModeChange(event.target.value) },
      h("option", { value: "full-access" }, "Full access"), h("option", { value: "restricted" }, "Restricted"))),
    h("button", { "aria-label": "Clear provider features", onClick: () => props.onFeatureValuesChange({}) }, "Clear features"),
  ); } };
});
vi.mock("@tanstack/react-query", async () => {
  return {
    useQuery: ({ queryKey }: any) => {
      if (queryKey[0] === "clips.role-defaults") return { data: { role: queryKey[1], model: "model", agent: "codex/model",
        reasoningEffort: "high", source: "user" }, refetch: vi.fn() };
      if (queryKey[0] === "clips.routing.providers") return { data: [
        { provider: "codex", label: "Codex", status: "ready", enabled: true, models: [{ id: "model",
          thinkingOptions: [{ id: "low", label: "Low" }, { id: "high", label: "High" }] }] },
        { provider: "antigravity", label: "Antigravity", status: "ready", enabled: true, models: [
          { id: "gemini-4-argon-high", label: "Gemini 4 Argon (High)", isSelectable: true },
          { id: "hidden", isSelectable: false },
        ] },
        { provider: "claude", label: "Claude", status: "offline", enabled: true, models: [{ id: "not-ready" }] },
      ] };
      if (queryKey[0] === "clips.role-defaults.providers") return { data: [
        { provider: "codex", label: "Codex", status: "ready", enabled: true, models: [{ id: "model" }] },
      ] };
       if (queryKey[0] === "clips.model-routing-policy") return { data: state.routingPolicy, refetch: vi.fn() };
      return { isLoading: false };
    },
  };
});

const theme = { colors: { foreground: "#fff", foregroundMuted: "#aaa", border: "#444", accent: "#58f",
  accentForeground: "#fff", statusDanger: "#f44" } } as any;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  state.panConfigs = [];
  state.agentConfigContexts = [];
  state.roleSettings = [];
  state.routingPolicy = { version: 1, providerOrder: ["codex", "opencode", "claude"],
    modelOrder: { manager: ["codex/manager", "opencode/manager"], dev: ["codex/dev", "claude/dev"] },
    reasoningEffortOrder: ["low", "medium", "high"], warningThresholds: [80, 90], handoffThreshold: 95 };
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
const addFrom = async (trigger: string, optionLabel: string, which = 0) => {
  await act(async () => { container.querySelectorAll<HTMLButtonElement>(`button[aria-label^="${trigger}:"]`)[which]!.click(); });
  await act(async () => { container.querySelector<HTMLButtonElement>(`[role="dialog"] button[aria-label="${optionLabel}"]`)!.click(); });
};
const select = async (label: string, value: string) => act(async () => {
  const found = Array.from(container.querySelectorAll<HTMLSelectElement>("select")).find((item) => item.getAttribute("aria-label") === label);
  expect(found, label).toBeTruthy();
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(found, value);
  found!.dispatchEvent(new Event("change", { bubbles: true }));
});

describe("Settings subviews", () => {
  it("renders padded settings content and exposes the ordered routing policy editor", async () => {
    for (const width of [390, 1440]) {
      await act(async () => { Object.defineProperty(window, "innerWidth", { configurable: true, value: width }); });
      await render();
      if (!container.querySelector('input[aria-label="Usage warning thresholds (%)"]')) {
        await act(async () => { button("Model Routing").click(); }); await render();
      }
      expect(container.textContent).toContain("Each role has one ranked model order");
      expect(container.textContent).toContain("Model Routing");
      expect(container.textContent).not.toContain("Save provider defaults");
      expect(Array.from(container.querySelectorAll("button")).map((item) => item.textContent)).not.toContain("Lane Manager");
      expect(Array.from(container.querySelectorAll("button")).map((item) => item.textContent)).not.toContain("Lane Dev");
      expect(container.querySelector<HTMLInputElement>('input[aria-label="Usage warning thresholds (%)"]')?.placeholder).toBe("80, 90");
      const padded = Array.from(container.querySelectorAll("div")).find((item) => item.style.padding === "8px" || item.style.padding === "16px");
      expect(padded, `settings card padding at ${width}px`).toBeTruthy();
    }
  });

  it("keeps one model and effort editor per Lane role while retaining inline permission controls", async () => {
    await render();
    expect(container.textContent).toContain("Model Routing");
    expect(container.textContent.match(/Lane Manager model order/g)).toHaveLength(1);
    expect(container.textContent.match(/Lane Dev model order/g)).toHaveLength(1);
    expect(container.querySelector('button[aria-label="Lane Manager"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Lane Dev"]')).toBeNull();
    expect(container.querySelector('select[aria-label="Paseo agent"]')).toBeNull();
    expect(container.querySelector('select[aria-label="Thinking"]')).toBeNull();
    expect(container.querySelectorAll('select[aria-label="Permission mode"]')).toHaveLength(2);
  });

  it("loads inline provider options with each role's ranked model and saved effort context", async () => {
    state.routingPolicy = { ...state.routingPolicy, modelEffort: {
      manager: { "codex/manager": "high" }, dev: { "codex/dev": "low" },
    } };
    await render();
    expect(state.agentConfigContexts).toContainEqual({ agent: "codex/manager", thinkingOptionId: "high", showModel: false, showThinking: false });
    expect(state.agentConfigContexts).toContainEqual({ agent: "codex/dev", thinkingOptionId: "low", showModel: false, showThinking: false });
  });

  it("does not offer repository selection or collaboration in global settings", async () => {
    await render();
    expect(container.textContent).not.toContain("Lanes settings");
    expect(container.textContent).not.toContain("Collaboration");
    expect(container.querySelector('select[aria-label="Project"]')).toBeNull();
    expect(state.projectRpc).not.toHaveBeenCalled();
  });

  it("saves the dragged order of all four lists without changing thresholds", async () => {
    await render();
    await act(async () => { button("Model Routing").click(); });
    expect(button("Save routing policy").disabled).toBe(true);
    const drags = [state.panConfigs[0], state.panConfigs[3], state.panConfigs[5], state.panConfigs[7]];
    for (const drag of drags) {
      await act(async () => {
        drag.onPanResponderGrant({}, {});
        drag.onPanResponderMove({}, { dy: 49 });
        drag.onPanResponderRelease({}, {});
      });
    }
    expect(button("Save routing policy").disabled).toBe(false);
    await act(async () => { button("Save routing policy").click(); });
    expect(state.saveRoutingPolicyRpc).toHaveBeenCalledWith({
      version: 1, providerOrder: ["opencode", "codex", "claude"],
      modelOrder: { manager: ["opencode/manager", "codex/manager"], dev: ["claude/dev", "codex/dev"] },
      reasoningEffortOrder: ["medium", "low", "high"], warningThresholds: [80, 90], handoffThreshold: 95,
    });
  });

  it("renders custom role routing rows and preserves unknown routing-policy metadata on save", async () => {
    state.roleSettings = [{ id: "reviewer", name: "Reviewer" }];
    state.routingPolicy = { ...state.routingPolicy, extension: { owner: "external" } };
    await render();
    await act(async () => { button("Model Routing").click(); });
    expect(container.textContent).toContain("Reviewer model order");
    await act(async () => { button("Move codex down").click(); });
    await act(async () => { button("Save routing policy").click(); });
    expect(state.saveRoutingPolicyRpc).toHaveBeenCalledWith(expect.objectContaining({
      extension: { owner: "external" }, modelOrder: expect.objectContaining({ reviewer: [] }),
    }));
  });

  it("offers ready providers, their selectable models and reasoning levels from the live catalog in pickers", async () => {
    await render();
    await act(async () => { button("Model Routing").click(); });
    expect(container.querySelector('input[aria-label="Add to Provider order"]')).toBeNull();
    expect(container.textContent).toContain("Ready providers: codex, antigravity");
    const open = async (trigger: string) => {
      await act(async () => { container.querySelector<HTMLButtonElement>(`button[aria-label^="${trigger}:"]`)!.click(); });
      return Array.from(container.querySelectorAll('[role="dialog"] button')).map((option) => option.getAttribute("aria-label"));
    };
    const pick = (label: string) => act(async () => { container.querySelector<HTMLButtonElement>(`[role="dialog"] button[aria-label="${label}"]`)!.click(); });
    expect(await open("Add provider")).toEqual(["Antigravity"]);
    await pick("Antigravity");
    expect(await open("Add model")).toEqual(["Codex · model", "Antigravity · Gemini 4 Argon (High)"]);
    await pick("Antigravity · Gemini 4 Argon (High)");
    expect(await open("Add effort")).toEqual(["none", "off", "xhigh", "max", "ultra", "ultracode"]);
    await pick("ultra");
    await act(async () => { button("Save routing policy").click(); });
    expect(state.saveRoutingPolicyRpc).toHaveBeenCalledWith(expect.objectContaining({
      providerOrder: ["codex", "opencode", "claude", "antigravity"],
      modelOrder: { manager: ["codex/manager", "opencode/manager", "antigravity/gemini-4-argon-high"], dev: ["codex/dev", "claude/dev"] },
      reasoningEffortOrder: ["low", "medium", "high", "ultra"],
    }));
  });

  it("saves a reasoning effort chosen next to a ranked model, only for models that offer one", async () => {
    await render();
    await act(async () => { button("Model Routing").click(); });
    await addFrom("Add model", "Codex · model");
    await addFrom("Add model", "Antigravity · Gemini 4 Argon (High)");
    const trigger = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label^="${label}"]`)!;
    expect(trigger("Reasoning effort for antigravity/gemini-4-argon-high:").disabled).toBe(true);
    await act(async () => { trigger("Reasoning effort for codex/model:").click(); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="High"]')!.click(); });
    expect(trigger("Reasoning effort for codex/model:").textContent).toContain("High");
    await act(async () => { button("Save routing policy").click(); });
    expect(state.saveRoutingPolicyRpc).toHaveBeenCalledWith(expect.objectContaining({
      modelOrder: { manager: ["codex/manager", "opencode/manager", "codex/model", "antigravity/gemini-4-argon-high"], dev: ["codex/dev", "claude/dev"] },
      modelEffort: { manager: { "codex/model": "high" }, dev: {} },
    }));
  });

  it("marks only an effort change as a pending routing change", async () => {
    await render();
    await act(async () => { button("Model Routing").click(); });
    expect(button("Save routing policy").disabled).toBe(true);
    await addFrom("Add model", "Codex · model");
    await act(async () => { button("Remove codex/model").click(); });
    expect(button("Save routing policy").disabled).toBe(true);
    await addFrom("Add model", "Codex · model");
    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label^="Reasoning effort for codex/model:"]')!.click(); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Low"]')!.click(); });
    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label^="Reasoning effort for codex/model:"]')!.click(); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Default effort"]')!.click(); });
    await act(async () => { button("Remove codex/model").click(); });
    expect(button("Save routing policy").disabled).toBe(true);
  });

  it("retains reordered rows and reports a failed save", async () => {
    state.saveRoutingPolicyRpc.mockRejectedValueOnce(new Error("Cannot save policy"));
    await render();
    await act(async () => { button("Model Routing").click(); });
    await act(async () => { button("Move codex down").click(); });
    await act(async () => { button("Save routing policy").click(); });
    expect(container.textContent).toContain("Cannot save policy");
    expect(Array.from(container.querySelectorAll('[aria-label^="Reorder "]')).slice(0, 3)
      .map((item) => item.getAttribute("aria-label"))).toEqual(["Reorder opencode", "Reorder codex", "Reorder claude"]);
  });
});
