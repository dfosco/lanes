import type { PaseoAgent, PaseoApi } from "@getpaseo/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resourceManagerSettings } from "../shared/resource-manager";
import { canNotifyManager, createResourceManager, resourceNotice } from "./resource-manager";
import type { ResourceSnapshot } from "./resource-pressure";
import type { ResourceTarget } from "./resource-targets";

const labels = { "lanes.kind": "lane", "lanes.ref": "#l001", "lanes.projectId": "p1" };
const lane = { projectId: "p1", projectLabel: "Project", laneRef: "#l001", laneTitle: "Delivery" };
const target = (): ResourceTarget => ({
  managerId: "manager", managerWorkspaceId: "manager-workspace", managerLabels: labels, lanes: [lane],
  candidates: [{ ...lane, agentId: "dev", workspaceId: "dev-workspace", ref: "#g001#t01", status: "idle",
    disposition: "old_idle", updatedAt: "2026-10-24T10:00:00Z", needsInput: false }],
});
const idle = (): PaseoAgent => ({
  id: "manager", workspaceId: "manager-workspace", status: "idle", labels, archivedAt: null,
  providerUnavailable: false, activeTurn: null, pendingPermissions: [], requiresAttention: false, attentionReason: null,
} as unknown as PaseoAgent);
const snapshot = (memoryUsedRatio: number | null = 0.9, cpuUsedRatio: number | null = 0.2): ResourceSnapshot => ({
  sampledAt: Date.now(), totalMemoryBytes: 16 * 1024 ** 3,
  availableMemoryBytes: memoryUsedRatio === null ? null : 16 * 1024 ** 3 * (1 - memoryUsedRatio),
  memoryUsedRatio, cpuUsedRatio, memorySource: "linux-memavailable",
});
const controllers: ReturnType<typeof createResourceManager>[] = [];

function fixture() {
  const config = resourceManagerSettings.parse({});
  const readSettings = vi.fn(async () => config);
  let measured = snapshot();
  const sample = vi.fn(async () => ({ ...measured, sampledAt: Date.now() }));
  const discover = vi.fn(async () => ({ targets: [target()], warnings: [] as string[] }));
  const refresh = vi.fn(async () => ({ agent: idle(), project: null }));
  const send = vi.fn(async (_text: string, _options: unknown) => {});
  const archive = vi.fn();
  const ref = vi.fn(() => ({ refresh, send, archive }));
  const dispose = vi.fn();
  const api = { agents: { ref }, dispose } as unknown as PaseoApi;
  const warn = vi.fn();
  const monitor = createResourceManager({ readSettings, sample, discover, warn, autoStart: false });
  controllers.push(monitor);
  monitor.bind(api);
  const step = async (memory: number | null = 0.9, cpu: number | null = 0.2) => {
    measured = snapshot(memory, cpu);
    vi.setSystemTime(Date.now() + 15_000);
    await monitor.check();
  };
  const pressure = async () => { await step(); await step(); await step(); };
  return { monitor, config, readSettings, sample, discover, refresh, send, archive, ref, api, dispose, warn, step, pressure };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-24T12:00:00Z")); });
afterEach(() => { for (const controller of controllers.splice(0)) controller.dispose(); vi.useRealTimers(); });

describe("daemon resource coordination", () => {
  it("waits for sustained pressure, tells the existing manager, and never retires a session itself", async () => {
    const f = fixture();
    await f.step(); await f.step();
    expect(f.send).not.toHaveBeenCalled();
    await f.step();
    expect(f.ref).toHaveBeenCalledWith("manager");
    expect(f.send).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("WARNING host pressure (memory)"),
      { messageId: expect.any(String), activeTurnBehavior: "steer" });
    expect(f.send.mock.calls[0][0]).toContain("CURRENT dev agents");
    expect(f.send.mock.calls[0][0]).toContain("durable handoff");
    expect(f.archive).not.toHaveBeenCalled();
    expect(f.monitor.status()).toMatchObject({ state: "monitoring", pressure: "warning", notifiedManagers: 1 });
  });

  it("does not count repeated RPCs or lifecycle bindings as extra samples", async () => {
    const f = fixture();
    await f.step();
    for (let index = 0; index < 10; index += 1) { f.monitor.bind(f.api); await f.monitor.check(); }
    expect(f.sample).toHaveBeenCalledTimes(1);
    expect(f.discover).not.toHaveBeenCalled();
  });

  it("throttles reminders but escalates after sustained critical pressure", async () => {
    const f = fixture(); await f.pressure();
    await f.step(0.97); await f.step(0.97);
    expect(f.send).toHaveBeenCalledTimes(1);
    await f.step(0.97);
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(f.send.mock.calls[1][0]).toContain("CRITICAL host pressure");
    for (let index = 0; index < 7; index += 1) await f.step(0.97);
    expect(f.send).toHaveBeenCalledTimes(2);
    await f.step(0.97);
    expect(f.send).toHaveBeenCalledTimes(3);
  });

  it("defers a busy manager and sends once a fresh native read confirms it is idle", async () => {
    const f = fixture();
    f.refresh.mockResolvedValue({ agent: { ...idle(), status: "running" }, project: null });
    await f.pressure();
    expect(f.send).not.toHaveBeenCalled();
    expect(f.monitor.status().deferredManagers).toBe(1);
    f.refresh.mockResolvedValue({ agent: idle(), project: null });
    await f.step(); await f.step();
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it("rechecks identity and availability after discovery instead of sending from a stale listing", async () => {
    const f = fixture();
    f.refresh.mockResolvedValue({ agent: { ...idle(), archivedAt: "2026-10-24T12:00:00Z" }, project: null });
    await f.pressure();
    expect(f.send).not.toHaveBeenCalled();
    f.refresh.mockResolvedValue({ agent: { ...idle(), labels: { ...labels, "lanes.kind": "task" } }, project: null });
    await f.step(); await f.step();
    expect(f.send).not.toHaveBeenCalled();
  });

  it("recovers only previously notified managers, even after their devs have been retired", async () => {
    const f = fixture(); await f.pressure();
    f.discover.mockResolvedValue({ targets: [{ ...target(), candidates: [] }, { ...target(), managerId: "unnotified" }], warnings: [] });
    await f.step(0.7); await f.step(0.7);
    expect(f.send).toHaveBeenCalledTimes(1);
    await f.step(0.7);
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(f.send.mock.calls[1][0]).toContain("host pressure recovered");
    expect(f.send.mock.calls[1][0]).toContain("already-authorized unfinished work");
    expect(f.ref).not.toHaveBeenCalledWith("unnotified");
    expect(f.monitor.status()).toMatchObject({ pressure: "normal", notifiedManagers: 0 });
  });

  it("does not infer recovery or issue fresh cleanup instructions from unknown measurements", async () => {
    const f = fixture(); await f.pressure();
    for (let index = 0; index < 10; index += 1) await f.step(null, null);
    expect(f.monitor.status().pressure).toBe("warning");
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it("breaks a pending pressure streak when a sample fails", async () => {
    const f = fixture(); await f.step(); await f.step();
    f.sample.mockRejectedValueOnce(new Error("host metric unavailable"));
    await f.step();
    expect(f.monitor.status()).toMatchObject({ state: "error", lastError: "host metric unavailable" });
    await f.step(); await f.step();
    expect(f.send).not.toHaveBeenCalled();
    await f.step();
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it("reserves cooldown on an uncertain send failure and never retries with interrupt defaults", async () => {
    const f = fixture(); f.send.mockRejectedValueOnce(new Error("delivery timeout"));
    await f.pressure();
    for (let index = 0; index < 7; index += 1) await f.step();
    expect(f.send).toHaveBeenCalledTimes(1);
    await f.step();
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(f.send.mock.calls.every((call) => (call[1] as any).activeTurnBehavior === "steer")).toBe(true);
  });

  it("also applies cooldown when a recovery notice fails", async () => {
    const f = fixture(); await f.pressure();
    f.send.mockRejectedValueOnce(new Error("recovery timeout"));
    await f.step(0.7); await f.step(0.7); await f.step(0.7);
    expect(f.send).toHaveBeenCalledTimes(2);
    for (let index = 0; index < 7; index += 1) await f.step(0.7);
    expect(f.send).toHaveBeenCalledTimes(2);
    await f.step(0.7);
    expect(f.send).toHaveBeenCalledTimes(3);
  });

  it("escalates fresh critical pressure even after an uncertain recovery delivery", async () => {
    const f = fixture(); await f.pressure();
    f.send.mockRejectedValueOnce(new Error("recovery timeout"));
    await f.step(0.7); await f.step(0.7); await f.step(0.7);
    await f.step(0.97); await f.step(0.97); await f.step(0.97);
    expect(f.send).toHaveBeenCalledTimes(3);
    expect(f.send.mock.calls[2][0]).toContain("CRITICAL host pressure");
  });

  it("does not bridge missing observations when recovering after a policy change", async () => {
    const f = fixture(); await f.pressure();
    f.config.memoryWarningPercent = 86;
    await f.step(0.7); await f.step(0.7);
    f.sample.mockRejectedValueOnce(new Error("sample lost")); await f.step(0.7);
    await f.step(0.7);
    expect(f.send).toHaveBeenCalledTimes(1);
    await f.step(0.7); await f.step(0.7);
    expect(f.send).toHaveBeenCalledTimes(2);
  });

  it("clears fixed sampling/settings errors without needing pressure-triggered discovery", async () => {
    const f = fixture();
    f.sample.mockRejectedValueOnce(new Error("sample lost")); await f.step(0.7);
    expect(f.monitor.status().lastError).toBe("sample lost");
    await f.step(0.7);
    expect(f.monitor.status()).toMatchObject({ state: "monitoring", lastError: null });
    f.readSettings.mockRejectedValueOnce(new Error("settings unavailable")); await f.step(0.7);
    expect(f.monitor.status().lastError).toBe("settings unavailable");
    await f.step(0.7);
    expect(f.monitor.status()).toMatchObject({ state: "monitoring", lastError: null });
    expect(f.discover).not.toHaveBeenCalled();
  });

  it("isolates one manager's failure and keeps the other manager's request", async () => {
    const f = fixture();
    const other = { ...target(), managerId: "other" };
    const secondSend = vi.fn(async () => {});
    f.discover.mockResolvedValue({ targets: [target(), other], warnings: [] });
    f.ref.mockImplementation((id?: string) => id === "other" ? {
      refresh: vi.fn(async () => ({ agent: { ...idle(), id: "other" }, project: null })),
      send: secondSend, archive: f.archive,
    } : { refresh: f.refresh, send: f.send, archive: f.archive });
    f.send.mockRejectedValueOnce(new Error("unavailable provider"));
    await f.pressure();
    expect(secondSend).toHaveBeenCalledTimes(1);
    expect(f.monitor.status().notifiedManagers).toBe(1);
  });

  it("skips notices with no dev candidates and skips sending recovered events to removed managers", async () => {
    const f = fixture();
    f.discover.mockResolvedValue({ targets: [{ ...target(), candidates: [] }], warnings: [] });
    await f.pressure(); expect(f.send).not.toHaveBeenCalled();
    f.discover.mockResolvedValue({ targets: [target()], warnings: [] });
    await f.step(); await f.step(); expect(f.send).toHaveBeenCalledTimes(1);
    f.discover.mockResolvedValue({ targets: [], warnings: [] });
    await f.step(0.7); await f.step(0.7); await f.step(0.7);
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it("fails closed on invalid settings and respects disable without sampling or sending", async () => {
    const f = fixture(); f.config.enabled = false;
    await f.step();
    expect(f.monitor.status().state).toBe("disabled");
    expect(f.sample).not.toHaveBeenCalled();
    f.config.enabled = true; f.config.memoryWarningPercent = 99;
    await f.step();
    expect(f.monitor.status().state).toBe("error");
    expect(f.sample).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });

  it("samples before a runtime context exists, then uses the bound API", async () => {
    const f = fixture();
    const monitor = createResourceManager({ readSettings: f.readSettings, sample: f.sample, discover: f.discover, autoStart: false });
    controllers.push(monitor);
    await monitor.check();
    expect(monitor.status().state).toBe("awaiting_runtime");
    expect(f.discover).not.toHaveBeenCalled();
    monitor.bind(f.api, "observed-host");
    vi.setSystemTime(Date.now() + 15_000); await monitor.check();
    vi.setSystemTime(Date.now() + 15_000); await monitor.check();
    expect(f.discover).toHaveBeenCalledWith(f.api, expect.objectContaining({ hostId: "observed-host" }));
  });

  it("does not overlap ticks or send after disposal during directory discovery", async () => {
    const f = fixture(); await f.step(); await f.step();
    let resolve!: (value: Awaited<ReturnType<typeof f.discover>>) => void;
    f.discover.mockImplementationOnce(() => new Promise((complete) => { resolve = complete; }));
    const pending = f.step();
    await vi.waitFor(() => expect(f.discover).toHaveBeenCalledTimes(1));
    const joined = f.monitor.check();
    expect(f.discover).toHaveBeenCalledTimes(1);
    f.monitor.dispose();
    resolve({ targets: [target()], warnings: [] });
    await pending; await joined;
    await vi.advanceTimersByTimeAsync(300_000);
    expect(f.send).not.toHaveBeenCalled();
    expect(f.monitor.status().state).toBe("stopped");
    expect(f.dispose).not.toHaveBeenCalled();
  });

  it("cancels a pending send when settings change during native refresh", async () => {
    const f = fixture(); await f.step(); await f.step();
    let resolve!: (value: Awaited<ReturnType<typeof f.refresh>>) => void;
    f.refresh.mockImplementationOnce(() => new Promise((complete) => { resolve = complete; }));
    const pending = f.step();
    await vi.waitFor(() => expect(f.refresh).toHaveBeenCalledTimes(1));
    f.config.enabled = false; f.monitor.settingsChanged();
    resolve({ agent: idle(), project: null }); await pending;
    await vi.advanceTimersByTimeAsync(0);
    expect(f.send).not.toHaveBeenCalled();
    expect(f.monitor.status().state).toBe("disabled");
  });
});

describe("manager message safety", () => {
  it.each([
    { status: "running" }, { status: "initializing" }, { status: "closed" }, { status: "error" },
    { archivedAt: "now" }, { providerUnavailable: true }, { activeTurn: { id: "turn" } },
    { pendingPermissions: [{}] }, { requiresAttention: true, attentionReason: "permission" },
    { requiresAttention: true, attentionReason: null }, { attentionReason: "error" },
    { workspaceId: "moved" }, { labels: { ...labels, "lanes.ref": "#l999" } },
  ])("defers unsafe native manager state %j", (change) => {
    expect(canNotifyManager({ ...idle(), ...change } as PaseoAgent, target())).toBe(false);
  });

  it("permits an idle finished manager and bounds the candidate message", () => {
    expect(canNotifyManager({ ...idle(), requiresAttention: true, attentionReason: "finished" }, target())).toBe(true);
    const value = target(); value.candidates = Array.from({ length: 25 }, (_, index) => ({ ...value.candidates[0], agentId: `dev-${index}` }));
    const text = resourceNotice(value, snapshot(), "warning", ["memory"], resourceManagerSettings.parse({}));
    expect(text).toContain("5 additional candidates omitted");
    expect(text).toContain('"agentId":"dev-19"');
    expect(text).not.toContain('"agentId":"dev-20"');
    expect(text).toContain("worktrees, transcripts and association history");
  });
});
