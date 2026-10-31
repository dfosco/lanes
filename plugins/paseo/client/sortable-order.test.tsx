// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SortableOrderEditor, moveOrderedItem } from "./sortable-order";

const gestures = vi.hoisted(() => ({ configs: [] as any[] }));
vi.mock("react-native", async () => {
  const { createElement: h } = await import("react");
  return {
    View: ({ children, accessibilityLabel, accessibilityRole, style }: any) => h("div", {
      "aria-label": accessibilityLabel, role: accessibilityRole, style,
    }, children),
    Text: ({ children, ...props }: any) => h("span", props, children),
    Pressable: ({ children, accessibilityLabel, accessibilityRole, disabled, onPress, style }: any) => h("button", {
      "aria-label": accessibilityLabel, role: accessibilityRole, disabled, onClick: onPress, style,
    }, children),
    PanResponder: { create: (config: any) => { gestures.configs.push(config); return { panHandlers: config }; } },
  };
});
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const { createElement: h } = await import("react");
  return {
    TextInput: ({ accessibilityLabel, placeholder, value, onChangeText }: any) => h("input", {
      "aria-label": accessibilityLabel, placeholder, value,
      onInput: (event: any) => onChangeText(event.currentTarget.value),
    }),
    ScrollView: ({ children, style }: any) => h("div", { "data-list": "", style }, children),
    Modal: Object.assign(({ title, open, children }: any) => open ? h("div", { role: "dialog", "aria-label": title }, children) : null,
      { Content: ({ children }: any) => h("div", {}, children) }),
  };
});
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { createElement: h } = await import("react");
  return { SettingsSelect: ({ label, value, options, disabled, onValueChange }: any) => h("select", {
    "aria-label": label, value, disabled, onChange: (event: any) => onValueChange(event.target.value),
  }, options.map((option: any) => h("option", { key: option.value, value: option.value }, option.label))) };
});

const theme = { colors: { foreground: "#fff", foregroundMuted: "#aaa", border: "#444" } } as any;
let container: HTMLDivElement;
let root: Root;
function Harness() {
  const [value, setValue] = useState("codex, opencode, claude");
  return <SortableOrderEditor label="Provider order" hint="Highest priority first." placeholder="Add provider ID"
    value={value} onChange={setValue} theme={theme} />;
}
const providerOptions = [
  { value: "codex", label: "Codex" }, { value: "claude", label: "Claude" },
  { value: "opencode", label: "OpenCode" }, { value: "antigravity", label: "Antigravity" },
];
function DropdownHarness({ options = providerOptions }: { options?: typeof providerOptions }) {
  const [value, setValue] = useState("codex, opencode, claude");
  return <SortableOrderEditor label="Provider order" hint="Highest priority first." placeholder="Add provider ID"
    value={value} onChange={setValue} theme={theme} options={options} selectLabel="Add provider" />;
}
beforeEach(() => {
  gestures.configs = [];
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = () => act(async () => root.render(createElement(Harness)));

it("moves an item according to the drag distance and keeps stable order semantics", async () => {
  await render();
  expect(container.querySelector('[aria-label="Reorder opencode"]')).toBeTruthy();
  const drag = gestures.configs[1];
  act(() => {
    drag.onPanResponderGrant({}, {});
    drag.onPanResponderMove({}, { dy: 88 });
  });
  const rowValues = Array.from(container.querySelectorAll<HTMLDivElement>("[aria-label^='Reorder ']"));
  expect(rowValues.map((handle) => handle.parentElement?.querySelectorAll("span")[1]?.textContent))
    .toEqual(["codex", "claude", "opencode"]);
  act(() => { drag.onPanResponderMove({}, { dy: -49 }); });
  expect(Array.from(container.querySelectorAll('[aria-label^="Reorder "]')).map((handle) => handle.getAttribute("aria-label")))
    .toEqual(["Reorder opencode", "Reorder codex", "Reorder claude"]);
  act(() => { drag.onPanResponderMove({}, { dy: 0 }); drag.onPanResponderRelease({}, {}); });
  expect(Array.from(container.querySelectorAll('[aria-label^="Reorder "]')).map((handle) => handle.getAttribute("aria-label")))
    .toEqual(["Reorder codex", "Reorder opencode", "Reorder claude"]);
  expect(moveOrderedItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
});

it("supports button reordering and removing every row back to the default empty order", async () => {
  await render();
  expect(container.querySelector<HTMLButtonElement>('[aria-label="Move codex up"]')!.disabled).toBe(true);
  expect(container.querySelector<HTMLButtonElement>('[aria-label="Move claude down"]')!.disabled).toBe(true);
  await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Move codex down"]')!.click(); });
  expect(Array.from(container.querySelectorAll('[aria-label^="Reorder "]')).map((handle) => handle.getAttribute("aria-label")))
    .toEqual(["Reorder opencode", "Reorder codex", "Reorder claude"]);
  for (const item of ["codex", "opencode", "claude"]) {
    await act(async () => { container.querySelector<HTMLButtonElement>(`[aria-label="Remove ${item}"]`)!.click(); });
  }
  expect(container.textContent).toContain("No order set.");
  expect(container.querySelector('[aria-label^="Reorder "]')).toBeNull();
});

it("adds unique entries and removes rows", async () => {
  await render();
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Add to Provider order"]')!;
    input.value = "claude, gemini, gemini";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => (container.querySelector<HTMLButtonElement>('button[aria-label="Add Provider order"]')!).click());
  expect(container.textContent).toContain("gemini");
  expect(container.querySelectorAll('[aria-label="Reorder gemini"]')).toHaveLength(1);
  await act(async () => (container.querySelector<HTMLButtonElement>('button[aria-label="Remove opencode"]')!).click());
  expect(container.querySelector('[aria-label="Reorder opencode"]')).toBeNull();
});

const dialogLabels = () => Array.from(container.querySelectorAll('[role="dialog"] button')).map((option) => option.getAttribute("aria-label"));

it("offers only unranked catalog entries in a picker and appends the chosen one", async () => {
  await act(async () => root.render(createElement(DropdownHarness)));
  expect(container.querySelector('input[aria-label="Add to Provider order"]')).toBeNull();
  await press(trigger("Add provider:"));
  expect(dialogLabels()).toEqual(["Antigravity"]);
  await pickFromDialog("Antigravity");
  expect(Array.from(container.querySelectorAll('[aria-label^="Reorder "]')).map((handle) => handle.getAttribute("aria-label")))
    .toEqual(["Reorder codex", "Reorder opencode", "Reorder claude", "Reorder antigravity"]);
  expect(trigger("Add provider:").disabled).toBe(true);
  expect(trigger("Add provider:").textContent).toContain("Everything available is already ranked");
});

it("returns a removed entry to the picker and keeps saved IDs the catalog no longer offers", async () => {
  await act(async () => root.render(createElement(DropdownHarness, { options: providerOptions.filter((option) => option.value !== "claude") })));
  expect(container.querySelector('[aria-label="Reorder claude"]')).toBeTruthy();
  await press(container.querySelector('button[aria-label="Remove codex"]')!);
  await press(trigger("Add provider:"));
  expect(dialogLabels()).toEqual(["Codex", "Antigravity"]);
});

const manyModels = Array.from({ length: 12 }, (_, index) => ({ value: `codex/m${index}`, label: index === 3 ? "Codex · Astra" : `Codex · Model ${index}` }));
function ManyHarness() {
  const [value, setValue] = useState("");
  return <SortableOrderEditor label="Lane Dev model order" hint="Rank models." placeholder="Add provider/model ID"
    value={value} onChange={setValue} theme={theme} options={manyModels} selectLabel="Add model" />;
}
const typeSearch = (text: string) => act(async () => {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Search Add model"]')!;
  input.value = text; input.dispatchEvent(new Event("input", { bubbles: true }));
});

it("caps the list height and filters long lists by name from a search box", async () => {
  await act(async () => root.render(createElement(ManyHarness)));
  await press(trigger("Add model:"));
  expect(container.querySelector<HTMLElement>("[data-list]")!.style.maxHeight).toBe("320px");
  expect(dialogLabels()).toHaveLength(12);
  await typeSearch("astra");
  expect(dialogLabels()).toEqual(["Codex · Astra"]);
  await typeSearch("model 1");
  expect(dialogLabels()).toEqual(["Codex · Model 1", "Codex · Model 10", "Codex · Model 11"]);
  await typeSearch("zzz");
  expect(dialogLabels()).toEqual([]);
  expect(container.textContent).toContain("No matches");
  await typeSearch("astra");
  await pickFromDialog("Codex · Astra");
  expect(container.querySelector('[aria-label="Reorder codex/m3"]')).toBeTruthy();
});

it("shows no search box for short lists", async () => {
  await act(async () => root.render(createElement(DropdownHarness)));
  await press(trigger("Add provider:"));
  expect(container.querySelector('input[aria-label^="Search"]')).toBeNull();
});

const modelChoices = [
  { value: "codex/a", label: "Codex · A" }, { value: "claude/b", label: "Claude · B" },
  { value: "codex/c", label: "Codex · C" }, { value: "claude/d", label: "Claude · D" },
];
const codexEfforts = [{ value: "low", label: "Low" }, { value: "high", label: "High" }];
const seen = { value: "", efforts: {} as Record<string, string> };
function PairHarness({ initialEfforts = {} }: { initialEfforts?: Record<string, string> }) {
  const [value, setValue] = useState("codex/a, claude/b");
  const [efforts, setEfforts] = useState<Record<string, string>>(initialEfforts);
  seen.value = value; seen.efforts = efforts;
  return <SortableOrderEditor label="Lane Dev model order" hint="Rank models." placeholder="Add provider/model ID"
    value={value} onChange={setValue} theme={theme} options={modelChoices} selectLabel="Add model"
    efforts={efforts} onEffortsChange={setEfforts} effortOptions={(item) => item.startsWith("codex/") ? codexEfforts : []} />;
}
const renderPairs = (initialEfforts?: Record<string, string>) => act(async () => root.render(createElement(PairHarness, { initialEfforts })));
const trigger = (prefix: string) => container.querySelector<HTMLButtonElement>(`button[aria-label^="${prefix}"]`)!;
const press = (element: Element) => act(async () => (element as HTMLButtonElement).click());
const pickFromDialog = (name: string) => press(container.querySelector(`[role="dialog"] button[aria-label="${name}"]`)!);

it("shows [model] [reasoning effort] dropdowns side by side on every ranked row", async () => {
  await renderPairs();
  for (const item of ["codex/a", "claude/b"]) {
    const model = trigger(`Model for ${item}:`);
    const effort = trigger(`Reasoning effort for ${item}:`);
    expect(model.parentElement!.parentElement).toBe(effort.parentElement!.parentElement);
    expect(model.compareDocumentPosition(effort) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
  expect(trigger("Model for codex/a:").textContent).toContain("Codex · A");
  expect(trigger("Reasoning effort for codex/a:").textContent).toContain("Default effort");
  expect(trigger("Reasoning effort for codex/a:").disabled).toBe(false);
  expect(trigger("Reasoning effort for claude/b:").disabled).toBe(true);
});

it("records the chosen effort for that model and can return it to the default", async () => {
  await renderPairs();
  await press(trigger("Reasoning effort for codex/a:"));
  expect(Array.from(container.querySelectorAll('[role="dialog"] button')).map((option) => option.getAttribute("aria-label")))
    .toEqual(["Default effort", "Low", "High"]);
  await pickFromDialog("High");
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(seen.efforts).toEqual({ "codex/a": "high" });
  expect(trigger("Reasoning effort for codex/a:").textContent).toContain("High");
  await press(trigger("Reasoning effort for codex/a:"));
  await pickFromDialog("Default effort");
  expect(seen.efforts).toEqual({});
});

it("swaps the model in place, keeping the effort only if the new model offers it", async () => {
  await renderPairs({ "codex/a": "high" });
  await press(trigger("Model for codex/a:"));
  expect(Array.from(container.querySelectorAll('[role="dialog"] button')).map((option) => option.getAttribute("aria-label")))
    .toEqual(["Codex · A", "Codex · C", "Claude · D"]);
  await pickFromDialog("Codex · C");
  expect(seen.value).toBe("codex/c, claude/b");
  expect(seen.efforts).toEqual({ "codex/c": "high" });
  await press(trigger("Model for codex/c:"));
  await pickFromDialog("Claude · D");
  expect(seen.value).toBe("claude/d, claude/b");
  expect(seen.efforts).toEqual({});
});

it("drops a removed row's effort and keeps a saved effort the model no longer offers visible", async () => {
  await renderPairs({ "codex/a": "high", "claude/b": "max" });
  expect(trigger("Reasoning effort for claude/b:").textContent).toContain("max (unavailable)");
  expect(trigger("Reasoning effort for claude/b:").disabled).toBe(false);
  await press(container.querySelector('button[aria-label="Remove claude/b"]')!);
  expect(seen.efforts).toEqual({ "codex/a": "high" });
  expect(seen.value).toBe("codex/a");
});
