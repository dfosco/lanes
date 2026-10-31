// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentRoleDefinition, agentRolesSettings, roleCatalogRpc } from "../shared/agent-roles";
import { AgentRolesSettings } from "./agent-roles";

const state = vi.hoisted(() => ({ settings: undefined as any, catalog: undefined as any, catalogError: null as Error | null,
  catalogLoading: false, fetchCatalog: vi.fn(), save: vi.fn(), reload: vi.fn() }));
vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: (contract: { name: string }) => contract.name === "clips.agent-roles.catalog" ? state.fetchCatalog : vi.fn(),
  useSettings: (definition: { id: string }) => definition.id === "agent-roles" ? state.settings : null,
}));
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { createElement: h } = await import("react");
  return { SettingsSelect: ({ label, value, options, onValueChange }: any) => h("label", {}, label,
    h("select", { "aria-label": label, value, onChange: (event: any) => onValueChange(event.target.value) },
      options.map((option: any) => h("option", { key: option.value, value: option.value }, option.label)))) };
});
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: state.catalog, isLoading: state.catalogLoading, isError: Boolean(state.catalogError), error: state.catalogError }),
}));
vi.mock("react-native", async () => {
  const { createElement: h } = await import("react");
  return {
    ActivityIndicator: () => h("span", {}, "Loading"),
    View: ({ children, accessibilityLabel, style }: any) => h("div", { "aria-label": accessibilityLabel, style }, children),
    Text: ({ children, accessibilityLabel, accessibilityRole, style }: any) => h("span", { "aria-label": accessibilityLabel, role: accessibilityRole, style }, children),
    Pressable: ({ children, accessibilityRole, accessibilityLabel, disabled, onPress }: any) =>
      h("button", { role: accessibilityRole, "aria-label": accessibilityLabel, disabled, onClick: onPress }, children),
    Switch: ({ value, onValueChange }: any) => h("input", { type: "checkbox", checked: value,
      onChange: (event: any) => onValueChange(event.currentTarget.checked) }),
    TextInput: ({ accessibilityLabel, value, onChangeText, placeholder, multiline }: any) => h(multiline ? "textarea" : "input", {
      "aria-label": accessibilityLabel, value, placeholder, onInput: (event: any) => onChangeText(event.currentTarget.value),
    }),
    ScrollView: ({ children }: any) => h("div", {}, children),
  };
});

const first = agentRoleDefinition.parse({ id: "qa-reviewer", name: "QA Reviewer", description: "Testing role", instructions: "",
  skills: [], candidates: [
    { agent: "openai/retired-model", modeId: "default" },
    { agent: "openai/model-one", modeId: "default" },
  ] });
const theme = { colors: { foreground: "#111", foregroundMuted: "#666", border: "#aaa", accent: "#44f",
  accentForeground: "#fff", surface0: "#fff", statusWarning: "#a60", statusDanger: "#b00" } } as any;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  state.settings = { status: "ready", values: { ...agentRolesSettings.schema.parse({}), untouched: "kept", roles: [first] },
    revision: "roles-r4", saving: false, saveError: null, save: state.save, reload: state.reload };
  state.catalog = { providers: [{ provider: "openai", label: "openai", modes: [{ id: "default", label: "Standard" }],
    defaultModeId: "default", models: [
      { agent: "openai/model-one", id: "model-one", label: "Reasoning Model", thinkingOptions: [{ id: "medium", label: "Medium" }], defaultThinkingOptionId: "medium" },
      { agent: "openai/model-two", id: "model-two", label: "Fast Model", thinkingOptions: [], defaultThinkingOptionId: null },
      { agent: "openai/gpt-6-luna", id: "gpt-6-luna", label: "gpt-6-luna", thinkingOptions: [], defaultThinkingOptionId: null },
    ] }] };
  state.catalogError = null;
  state.catalogLoading = false;
  state.save.mockResolvedValue(true); state.reload.mockResolvedValue(undefined);
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = (width: number) => act(async () => {
  root.render(createElement("div", { style: { width }, "data-layout": width < 480 ? "compact" : "desktop" },
    createElement(AgentRolesSettings, { theme, host: { id: "selected-host", label: "Selected host" } })));
});
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

describe("catalog-driven role settings", () => {
  it.each([[360, "compact"], [900, "desktop"]] as const)("shows friendly choices and preserves ordered stale entries at %s px", async (width, layout) => {
    await render(width);
    expect(container.querySelector(`[data-layout="${layout}"]`)).not.toBeNull();
    expect(container.textContent).toContain("OpenAI · Reasoning Model");
    expect(container.textContent).toContain("OpenAI · GPT 6 Luna");
    expect(container.textContent).toContain("Unavailable saved model 1");
    expect(container.textContent).not.toContain("openai/model-one");
    expect(container.textContent).not.toContain("Add provider/model ID");

    await select("Available model", "openai/model-two");
    await act(async () => { button("Add launch choice").click(); });
    await act(async () => { button("Move choice 3 up").click(); });
    await act(async () => { button("Save roles").click(); });
    expect(state.save).toHaveBeenCalledWith(expect.objectContaining({
      untouched: "kept",
      roles: [expect.objectContaining({ candidates: [
        expect.objectContaining({ agent: "openai/retired-model" }),
        expect.objectContaining({ agent: "openai/model-two", modeId: "default" }),
        expect.objectContaining({ agent: "openai/model-one", modeId: "default" }),
      ], revision: 2 })],
    }), "roles-r4");
  });

  it("keeps saved choices visible and unchanged when the live host catalog fails", async () => {
    state.catalog = undefined; state.catalogError = new Error("host offline");
    await render(360);
    expect(container.textContent).toContain("Provider catalog unavailable: host offline");
    expect(container.textContent).toContain("Saved launch choice 1");
    expect(container.textContent).toContain("Saved launch choice 2");
    expect(container.textContent).not.toContain("no longer offered by this host");
    expect(state.save).not.toHaveBeenCalled();
  });

  it("distinguishes catalog loading from an empty ready catalog", async () => {
    state.catalog = undefined; state.catalogLoading = true;
    await render(900);
    expect(container.textContent).toContain("Loading this host’s available models");
    expect(container.textContent).toContain("Saved launch choice 1");
    expect(container.textContent).not.toContain("no longer offered by this host");
    await act(async () => root.unmount());
    root = createRoot(container);
    state.catalogLoading = false; state.catalog = { providers: [] };
    await render(360);
    expect(container.textContent).toContain("No providers are currently ready on this host");
    expect(container.textContent).toContain("Unavailable saved model 1 · no longer offered by this host");
  });
});
