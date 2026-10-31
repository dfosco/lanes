// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RepositoryCollaboration } from "./repository-collaboration";

const state = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: () => state.update }));
vi.mock("react-native", async () => {
  const { createElement: h } = await import("react");
  return {
    View: ({ children }: any) => h("div", {}, children),
    Text: ({ children }: any) => h("span", {}, children),
    Pressable: ({ children, accessibilityLabel, accessibilityState, disabled, onPress }: any) =>
      h("button", { "aria-label": accessibilityLabel, "aria-expanded": accessibilityState?.expanded, disabled, onClick: onPress }, children),
  };
});

const theme = { colors: { foreground: "#fff", foregroundMuted: "#aaa", border: "#444", accent: "#58f", surface1: "#333", statusDanger: "#f44" } } as any;
const disabled = { enabled: false, state: "disabled", scope: "project" };
const enabled = { enabled: true, state: "enabled", scope: "project" };
let container: HTMLDivElement;
let root: Root;
let cache: QueryClient;
beforeEach(() => {
  state.update.mockReset();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  cache = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); cache.clear(); container.remove(); });
async function render(projectId = "p1", capability = disabled) {
  await act(async () => { root.render(createElement(QueryClientProvider, { client: cache },
    createElement(RepositoryCollaboration, { key: projectId, hostId: "host", projectId, projectLabel: `Repository ${projectId}`, capability, theme }))); });
}
async function click(label: string) {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(button, label).not.toBeNull();
  await act(async () => { button!.click(); });
}

describe("repository collaboration", () => {
  it("uses the workspace repository and keeps an in-flight result scoped to its original cache", async () => {
    let resolve!: (value: any) => void;
    state.update.mockReturnValue(new Promise((done) => { resolve = done; }));
    await render(); await click("Repository collaboration");
    expect(container.textContent).toContain("GitHub collaboration · Repository p1");
    expect(container.textContent).toContain("later Lanes changes may sync automatically");
    await click("Enable GitHub collaboration");
    expect(state.update).toHaveBeenCalledWith({ projectId: "p1", enabled: true });
    await render("p2"); await click("Repository collaboration");
    expect(container.textContent).toContain("Repository p2");
    expect(container.textContent).not.toContain("Saving…");
    const board = { collaboration: enabled, lanes: [], goals: [], warnings: [] };
    await act(async () => { resolve(board); await Promise.resolve(); });
    expect(cache.getQueryData(["clips.board", "host", "p1"])).toEqual(board);
    expect(cache.getQueryData(["clips.board", "host", "p2"])).toBeUndefined();
  });

  it("disables an enabled repository and refuses invalid settings", async () => {
    state.update.mockResolvedValue({ collaboration: disabled });
    await render("p2", enabled); await click("Repository collaboration");
    await click("Disable GitHub collaboration");
    expect(state.update).toHaveBeenCalledWith({ projectId: "p2", enabled: false });
    await render("p3", { enabled: null, state: "invalid", scope: "project", error: "Corrupt config" } as any);
    await click("Repository collaboration");
    expect(container.textContent).toContain("Corrupt config");
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Collaboration unavailable"]')?.disabled).toBe(true);
    expect(state.update).toHaveBeenCalledTimes(1);
  });
});
