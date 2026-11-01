// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentLaunchDialog } from "./agent-configuration";

const state = vi.hoisted(() => ({ roles: [] as any[], roleError: null as Error | null }));
vi.mock("@getpaseo/plugin/client", () => ({ usePaseo: () => ({ providers: { snapshot: vi.fn(async () => ({ entries: [] })) } }),
  useRpc: (contract: { name: string }) => contract.name === "clips.agent-roles.list" ? vi.fn(async () => ({ roles: state.roles })) : vi.fn() }));
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { createElement: h } = await import("react");
  return { SettingsSelect: ({ label, value, options, onValueChange }: any) => h("label", {}, label,
    h("select", { "aria-label": label, value, onChange: (event: any) => onValueChange(event.target.value) },
      options.map((option: any) => h("option", { key: option.value, value: option.value }, option.label)))) };
});
vi.mock("@tanstack/react-query", () => ({ useQuery: ({ queryKey }: any) => queryKey[0] === "clips.agent-roles.list"
  ? { data: state.roleError ? undefined : { roles: state.roles }, isLoading: false, isError: Boolean(state.roleError), error: state.roleError }
  : { data: [], isLoading: false, isError: false } }));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const { createElement: h } = await import("react");
  const Modal = Object.assign(({ children, open, title }: any) => open ? h("div", { "aria-label": title }, children) : null,
    { Content: ({ children }: any) => h("div", {}, children) });
  return { Modal, ScrollView: ({ children }: any) => h("section", {}, children) };
});
vi.mock("react-native", async () => {
  const { createElement: h } = await import("react");
  return {
    ActivityIndicator: () => h("span", {}, "Loading"),
    View: ({ children }: any) => h("div", {}, children),
    Text: ({ children }: any) => h("span", {}, children),
    Pressable: ({ children, accessibilityRole, accessibilityLabel, disabled, onPress }: any) =>
      h("button", { role: accessibilityRole, "aria-label": accessibilityLabel, disabled, onClick: onPress }, children),
    Switch: ({ value, onValueChange }: any) => h("input", { type: "checkbox", checked: value,
      onChange: (event: any) => onValueChange(event.currentTarget.checked) }),
  };
});
const theme = { colors: { foreground: "#111", foregroundMuted: "#666", border: "#aaa", accent: "#44f",
  accentForeground: "#fff", statusDanger: "#b00" } } as any;
const defaults = { agent: "openai/manual", thinkingOptionId: "medium", featureValues: {}, modeId: "full-access" };
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const onSubmit = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); state.roleError = null; state.roles = [{ id: "qa", name: "QA Reviewer", description: "Review changes" }];
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = async (defaultRoleId = "qa") => act(async () => root.render(createElement(AgentLaunchDialog, {
  open: true, workTitle: "#g009#t03", defaults, theme, hostId: "host-1", projectId: "project-1", busy: false,
  defaultRoleId, onOpenChange: vi.fn(), onSubmit,
})));
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

describe("role-aware agent launch", () => {
  it("uses the selected role’s ordered resolver while keeping the work prompt separate", async () => {
    await render();
    expect(container.textContent).toContain("Review changes worker role defaults apply. Model order comes from Model Routing.");
    expect(container.textContent).not.toContain("Manual provider fields");
    await act(async () => { button("Start agent").click(); });
    expect(onSubmit).toHaveBeenCalledWith(undefined, "qa");
  });

  it("retains exact manual provider/model and permission options as an explicit role override", async () => {
    await render();
    const override = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => { override.click(); });
    expect(container.textContent).toContain("Paseo agent");
    expect(container.textContent).toContain("Previously saved model (currently unavailable)");
    expect(container.textContent).not.toContain("openai/manual");
    await act(async () => { button("Start agent").click(); });
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ provider: "openai/manual", modeId: "full-access" }), "qa");
  });

  it("allows selecting manual launch without a role", async () => {
    await render();
    await select("Launch as", "");
    expect(container.textContent).toContain("Paseo agent");
    await act(async () => { button("Start agent").click(); });
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ provider: "openai/manual", modeId: "full-access" }), undefined);
  });
});
