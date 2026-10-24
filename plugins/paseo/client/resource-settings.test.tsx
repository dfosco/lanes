// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { preferences } from "../shared/contracts";
import { resourceManagerSettings, type ResourceManagerStatus } from "../shared/resource-manager";
import { ResourceSettings } from "./resource-settings";
import { SettingsScreen } from "./settings";

const state = vi.hoisted(() => ({
  settings: {} as any,
  launchSettings: undefined as any,
  settingsSave: vi.fn(), settingsReload: vi.fn(), statusRpc: vi.fn(), projectsRpc: vi.fn(),
}));
vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: (rpc: { name: string }) => rpc.name === "clips.resource-manager.status" ? state.statusRpc : state.projectsRpc,
  useSettings: (definition: { id: string }) => definition.id === "resource-manager" ? state.settings
    : state.launchSettings ?? { status: "ready", values: preferences.schema.parse({}), revision: "p1", save: vi.fn() },
}));
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { createElement: h } = await import("react");
  return {
    SettingsSection: ({ title, children }: any) => h("section", { "aria-label": title }, children),
    SettingsCard: ({ children }: any) => h("div", {}, children),
    SettingsAction: ({ label, hint, actionLabel, disabled, onPress }: any) => h("div", {},
      h("span", {}, label), h("span", {}, hint), h("button", { "aria-label": actionLabel, disabled, onClick: onPress }, actionLabel)),
    SettingsSwitch: ({ label, value, disabled, onValueChange }: any) => h("label", {}, label,
      h("input", { type: "checkbox", "aria-label": label, checked: value, disabled, onChange: (event: any) => onValueChange(event.target.checked) })),
    SettingsInput: ({ label, initialValue, disabled, onChangeText, error }: any) => h("label", {}, label,
      h("input", { "aria-label": label, defaultValue: initialValue, disabled,
        onInput: (event: any) => onChangeText(event.target.value) }), h("span", {}, error)),
    SettingsSelect: () => null,
  };
});
vi.mock("react-native", async () => {
  const { createElement: h } = await import("react");
  return {
    View: ({ children }: any) => h("div", {}, children),
    Text: ({ children }: any) => h("span", {}, children),
    Pressable: ({ children, onPress }: any) => h("button", { onClick: onPress }, children),
    ActivityIndicator: () => h("span", {}, "Loading"),
  };
});
vi.mock("./agent-configuration", () => ({ AgentConfigFields: () => null }));

const theme = { colors: { foreground: "#fff", foregroundMuted: "#aaa", border: "#444", accent: "#58f",
  accentForeground: "#fff", statusDanger: "#f44" } } as any;
const defaultStatus: ResourceManagerStatus = {
  enabled: true, state: "monitoring", pressure: "warning", reasons: ["memory"],
  snapshot: { sampledAt: 1_800_000_000_000, totalMemoryBytes: 16 * 1024 ** 3,
    availableMemoryBytes: 2 * 1024 ** 3, memoryUsedRatio: 0.875, cpuUsedRatio: null, memorySource: "linux-meminfo" },
  lastNoticeAt: null, notifiedManagers: 2, deferredManagers: 1, lastError: null,
};
let container: HTMLDivElement;
let root: Root;
let cache: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  state.launchSettings = undefined;
  state.settings = {
    status: "ready", values: resourceManagerSettings.parse({}), revision: "r1", saving: false, saveError: null,
    save: state.settingsSave, reload: state.settingsReload,
  };
  state.settingsSave.mockImplementation(async (values, revision) => {
    if (revision !== state.settings.revision) return false;
    state.settings = { ...state.settings, values, revision: "r2" };
    return true;
  });
  state.settingsReload.mockResolvedValue(undefined);
  state.statusRpc.mockResolvedValue(defaultStatus);
  state.projectsRpc.mockResolvedValue({ projects: [] });
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); cache.clear(); container.remove(); });
const render = async (hostId = "host-1", screen = false) => {
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: cache }, screen
      ? createElement(SettingsScreen, { theme, host: { id: hostId } } as any)
      : createElement(ResourceSettings, { theme, hostId, key: hostId })));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};
const button = (label: string) => {
  const found = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((item) => item.getAttribute("aria-label") === label || item.textContent === label);
  expect(found, label).toBeTruthy(); return found!;
};
const input = (label: string) => {
  const found = Array.from(container.querySelectorAll<HTMLInputElement>("input"))
    .find((item) => item.getAttribute("aria-label") === label);
  expect(found, label).toBeTruthy(); return found!;
};
const edit = async (label: string, value: string) => act(async () => {
  const element = input(label);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
});
const click = async (label: string) => act(async () => { button(label).click(); });

describe("Resource settings", () => {
  it("remains reachable when unrelated agent launch settings are invalid", async () => {
    state.launchSettings = { status: "invalid", error: "Invalid launch preferences" };
    await render("host-1", true);
    expect(container.textContent).toContain("Invalid launch preferences");
    await click("Resources"); await render("host-1", true);
    expect(container.textContent).not.toContain("Invalid launch preferences");
    expect(input("Manage resource pressure").checked).toBe(true);
    expect(state.statusRpc).toHaveBeenCalledWith({});
  });

  it("loads status only while Resources is mounted and scopes the cache to the host", async () => {
    await render("host-1", true);
    expect(state.statusRpc).not.toHaveBeenCalled();
    await click("Resources"); await render("host-1", true);
    expect(state.statusRpc).toHaveBeenCalledWith({});
    expect(cache.getQueryData(["clips.resource-manager.status", "host-1"])).toEqual(defaultStatus);
    await render("host-2", true);
    expect(cache.getQueryData(["clips.resource-manager.status", "host-2"])).toEqual(defaultStatus);
    await click("Collaboration");
    expect(cache.getQueryCache().find({ queryKey: ["clips.resource-manager.status", "host-2"] })?.getObserversCount() ?? 0).toBe(0);
  });

  it("shows measured resources, unknown CPU, pressure, and manager delivery status", async () => {
    await render(); await render();
    expect(container.textContent).toContain("Monitoring host");
    expect(container.textContent).toContain("Pressure: warning · Memory");
    expect(container.textContent).toContain("Memory used: 88% · 2.0 GiB available of 16.0 GiB");
    expect(container.textContent).toContain("CPU used: Unknown");
    expect(container.textContent).toContain("Managers notified this episode: 2 · Busy managers deferred: 1");
    expect(container.textContent).toContain("Last notice: None");
    expect(button("Save resource settings").disabled).toBe(true);
  });

  it("saves edited thresholds and disabled state against the original revision, preserving all untouched settings", async () => {
    await render();
    await edit("Memory warning (%)", "87");
    await act(async () => { input("Manage resource pressure").click(); });
    await click("Save resource settings");
    expect(state.settingsSave).toHaveBeenCalledExactlyOnceWith({ ...resourceManagerSettings.parse({}), enabled: false, memoryWarningPercent: 87 }, "r1");
    expect(button("Save resource settings").disabled).toBe(true);
    expect(input("Memory warning (%)").value).toBe("87");
    expect(input("Manage resource pressure").checked).toBe(false);
  });

  it("rejects invalid threshold order, empty numbers, and out-of-range timing", async () => {
    await render();
    await edit("Memory recovery (%)", "90");
    expect(container.textContent).toContain("Memory thresholds must be recovery < warning < critical.");
    expect(button("Save resource settings").disabled).toBe(true);
    await edit("Memory recovery (%)", "80");
    await edit("CPU warning (%)", "");
    expect(button("Save resource settings").disabled).toBe(true);
    await edit("CPU warning (%)", "90");
    await click("Show timing");
    await edit("Consecutive samples", "1");
    expect(button("Save resource settings").disabled).toBe(true);
    await edit("Consecutive samples", "4");
    await edit("Sample interval (seconds)", "30");
    await edit("Notice cooldown (seconds)", "180");
    await edit("Old idle age (seconds)", "600");
    await click("Save resource settings");
    expect(state.settingsSave).toHaveBeenCalledExactlyOnceWith({ ...resourceManagerSettings.parse({}),
      consecutiveSamples: 4, sampleIntervalSeconds: 30, notificationCooldownSeconds: 180, idleAgeSeconds: 600 }, "r1");
  });

  it("does not overwrite a concurrent update and preserves edits until explicitly discarded", async () => {
    await render();
    await edit("Memory warning (%)", "88");
    state.settings = { ...state.settings, revision: "r-new", values: { ...state.settings.values, cpuWarningPercent: 93 } };
    await render();
    expect(container.textContent).toContain("Host settings changed while you were editing");
    expect(input("Memory warning (%)").value).toBe("88");
    expect(button("Save resource settings").disabled).toBe(true);
    await click("Save resource settings");
    expect(state.settingsSave).not.toHaveBeenCalled();
    await click("Discard edits and reload");
    expect(state.settingsReload).toHaveBeenCalledOnce();
    expect(input("Memory warning (%)").value).toBe("85");
    expect(input("CPU warning (%)").value).toBe("93");
    await edit("Memory warning (%)", "89");
    await click("Save resource settings");
    expect(state.settingsSave).toHaveBeenCalledWith(expect.objectContaining({ memoryWarningPercent: 89, cpuWarningPercent: 93 }), "r-new");
  });

  it("retains edits when save fails or races with another writer", async () => {
    state.settingsSave.mockResolvedValue(false);
    await render();
    await edit("CPU critical (%)", "99");
    await click("Save resource settings");
    expect(container.textContent).toContain("Your edits are preserved");
    expect(input("CPU critical (%)").value).toBe("99");
    expect(button("Save resource settings").disabled).toBe(false);
  });

  it("reports resource settings and reload errors without offering to overwrite invalid values", async () => {
    state.settings = { ...state.settings, status: "invalid", error: "Stored policy is invalid" };
    state.settingsReload.mockRejectedValue(new Error("Host disconnected"));
    await render();
    expect(container.textContent).toContain("Stored policy is invalid");
    expect(container.textContent).not.toContain("Save resource settings");
    await click("Reload settings");
    expect(container.textContent).toContain("Could not reload resource settings: Host disconnected");
    expect(state.settingsSave).not.toHaveBeenCalled();
  });

  it("displays waiting and disabled states without implying that missing samples are healthy", async () => {
    state.statusRpc.mockResolvedValue({ ...defaultStatus, state: "awaiting_runtime", pressure: "normal", reasons: [], snapshot: null });
    await render(); await render();
    expect(container.textContent).toContain("Waiting for Paseo connection");
    expect(container.textContent).toContain("Memory used: Unknown");
    expect(container.textContent).toContain("Waiting for the first resource sample");
    await act(async () => { cache.setQueryData(["clips.resource-manager.status", "host-1"], {
      ...defaultStatus, state: "disabled", enabled: false, lastError: "Runtime connection closed",
    }); });
    await render();
    expect(container.textContent).toContain("Disabled");
    expect(container.textContent).toContain("Runtime connection closed");
  });
});
