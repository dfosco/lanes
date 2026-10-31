// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentConfigFields } from "./agent-configuration";

const state = vi.hoisted(() => ({ fetchOptions: vi.fn(), optionQueries: [] as any[] }));
const entries = [{ provider: "claude", label: "Claude", status: "ready", enabled: true,
  models: [{ id: "sonnet", label: "Sonnet", isSelectable: true, thinkingOptions: [{ id: "high", label: "High" }] }] }];
vi.mock("@getpaseo/plugin/client", () => ({
  usePaseo: () => ({ providers: { snapshot: async () => ({ entries }) } }),
  useRpc: () => state.fetchOptions,
}));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Modal: {}, ScrollView: {} }));
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { createElement: h } = await import("react");
  return { SettingsSelect: ({ label, options }: any) => h("div", { "data-label": label }, options.map((option: any) => option.label).join(", ")) };
});
vi.mock("@tanstack/react-query", () => ({
  useQuery: (query: any) => {
    if (query.queryKey[0] === "clips-agent-catalog") return { data: entries, isLoading: false, isError: false };
    state.optionQueries.push(query);
    return { data: query.enabled ? {
      thinkingOptions: [{ id: "high", label: "High" }], defaultThinkingOptionId: "high",
      speedFeature: null, permissionModes: [{ id: "default", label: "Default" }], defaultModeId: "default",
      modeError: null, featureError: null,
    } : undefined, isFetching: false, isError: false };
  },
}));
vi.mock("react-native", async () => {
  const { createElement: h } = await import("react");
  return {
    ActivityIndicator: () => h("span", {}, "Loading"),
    Pressable: ({ children }: any) => h("button", {}, children),
    Switch: () => h("input", { type: "checkbox" }),
    Text: ({ children }: any) => h("span", {}, children),
    View: ({ children }: any) => h("div", {}, children),
  };
});

const theme = { colors: { foreground: "#fff", foregroundMuted: "#aaa", border: "#444", accent: "#0a7",
  accentForeground: "#fff", statusDanger: "#f44" } } as any;
const fields = (agent: string) => createElement(AgentConfigFields, {
  theme, hostId: "host", providerId: "claude", agent, thinkingOptionId: "", featureValues: {}, modeId: "full-access",
  onAgentChange: vi.fn(), onThinkingChange: vi.fn(), onFeatureValuesChange: vi.fn(), onModeChange: vi.fn(), allowAutomatic: true,
} as any);
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks(); state.optionQueries = [];
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe("provider-scoped agent options", () => {
  it("does not query or show a loading/error state for Automatic", async () => {
    await act(async () => root.render(fields("")));
    expect(state.optionQueries).toHaveLength(1);
    expect(state.optionQueries[0].enabled).toBe(false);
    expect(container.textContent).toContain("Select a default model");
    expect(container.textContent).not.toContain("Loading");
    expect(container.textContent).not.toContain("Cannot read options");
    expect(state.fetchOptions).not.toHaveBeenCalled();
  });

  it("loads options using the exact selected provider/model", async () => {
    await act(async () => root.render(fields("claude/sonnet")));
    expect(state.optionQueries[0].enabled).toBe(true);
    await act(async () => { await state.optionQueries[0].queryFn(); });
    expect(state.fetchOptions).toHaveBeenCalledWith({ projectId: undefined, provider: "claude/sonnet", thinkingOptionId: undefined });
    expect(container.textContent).not.toContain("Cannot read options");
  });
});
