import { describe, expect, it, vi } from "vitest";
import {
  createPressureTracker, createResourceSampler, DEFAULT_PRESSURE_CONFIG,
  type ResourceSamplerDependencies, type ResourceSnapshot,
} from "./resource-pressure";

const cpu = (user: number, idle: number) => ({ times: { user, idle, sys: 0, nice: 0, irq: 0 } });
const sources = (overrides: Partial<ResourceSamplerDependencies> = {}): ResourceSamplerDependencies => ({
  platform: () => "linux", now: () => 1234,
  cpus: () => [cpu(100, 100)], totalmem: () => 1_024_000, freemem: () => 0,
  readTextFile: async () => "MemTotal: 1000 kB\nMemFree: 10 kB\nMemAvailable: 400 kB\n",
  readDarwinMemoryPressure: async () => "The system has 1024000 bytes.\nSystem-wide memory free percentage: 40%\n",
  ...overrides,
});
const snapshot = (memory: number | null, cpuUsage: number | null = 0.2): ResourceSnapshot => ({
  sampledAt: 1234, totalMemoryBytes: 1000,
  availableMemoryBytes: memory === null ? null : 1000 * (1 - memory),
  memoryUsedRatio: memory, cpuUsedRatio: cpuUsage, memorySource: "linux-memavailable",
});

describe("host resource sampler", () => {
  it("uses Linux available memory, including reclaimable cache, instead of almost empty free memory", async () => {
    const readTextFile = vi.fn(sources().readTextFile);
    const result = await createResourceSampler(sources({ readTextFile }))();
    expect(result).toEqual({
      sampledAt: 1234, totalMemoryBytes: 1_024_000, availableMemoryBytes: 409_600,
      memoryUsedRatio: 0.6, cpuUsedRatio: null, memorySource: "linux-memavailable",
    });
    expect(readTextFile).toHaveBeenCalledExactlyOnceWith("/proc/meminfo");
  });

  it("calculates CPU load from successive counters across cores rather than cumulative uptime", async () => {
    const cpus = vi.fn()
      .mockReturnValueOnce([cpu(100, 900), cpu(100, 900)])
      .mockReturnValueOnce([cpu(190, 910), cpu(150, 950)]);
    const sample = createResourceSampler(sources({ cpus }));
    expect((await sample()).cpuUsedRatio).toBeNull();
    expect((await sample()).cpuUsedRatio).toBeCloseTo(0.7);
  });

  it("restarts CPU windows after unavailable counters, resets, topology changes or no elapsed time", async () => {
    const cpus = vi.fn()
      .mockReturnValueOnce([cpu(100, 900)])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([cpu(200, 1000)])
      .mockReturnValueOnce([cpu(1, 1)])
      .mockReturnValueOnce([cpu(1, 1)])
      .mockReturnValueOnce([cpu(2, 2), cpu(2, 2)])
      .mockReturnValueOnce([cpu(NaN, 3)]);
    const sample = createResourceSampler(sources({ cpus }));
    for (let count = 0; count < 7; count += 1) expect((await sample()).cpuUsedRatio).toBeNull();
  });

  it("uses macOS kernel availability rather than raw free RAM", async () => {
    const readDarwinMemoryPressure = vi.fn(sources().readDarwinMemoryPressure);
    const result = await createResourceSampler(sources({ platform: () => "darwin", readDarwinMemoryPressure }))();
    expect(result).toMatchObject({ memoryUsedRatio: 0.6, availableMemoryBytes: 409_600, memorySource: "darwin-memory-pressure" });
    expect(readDarwinMemoryPressure).toHaveBeenCalledOnce();
  });

  it("retains valid zero available memory and completely available memory", async () => {
    for (const available of [0, 100]) {
      const result = await createResourceSampler(sources({
        platform: () => "darwin",
        readDarwinMemoryPressure: async () => `System-wide memory free percentage: ${available}%\n`,
      }))();
      expect(result.memoryUsedRatio).toBe(1 - available / 100);
    }
  });

  it("uses native available physical memory on Windows", async () => {
    const result = await createResourceSampler(sources({ platform: () => "win32", freemem: () => 102_400 }))();
    expect(result).toMatchObject({ memoryUsedRatio: 0.9, memorySource: "windows-freemem" });
  });

  const unavailableMemoryReadings: Partial<ResourceSamplerDependencies>[] = [
    { readTextFile: async () => "MemTotal: 1000 kB\nMemFree: 10 kB\n" },
    { readTextFile: async () => "MemTotal: 1000 kB\nMemAvailable: 1001 kB\n" },
    { readTextFile: async () => "MemTotal: 0 kB\nMemAvailable: 0 kB\n" },
    { readTextFile: async () => { throw new Error("procfs unavailable"); } },
    { platform: () => "darwin", readDarwinMemoryPressure: async () => "System-wide memory free percentage: 101%" },
    { platform: () => "darwin", readDarwinMemoryPressure: async () => "unrecognized output" },
    { platform: () => "darwin", readDarwinMemoryPressure: async () => { throw new Error("timeout"); } },
    { platform: () => "win32", freemem: () => -1 },
    { platform: () => "freebsd" },
  ];
  it.each(unavailableMemoryReadings)("reports unavailable memory honestly without a raw-freemem fallback (%#)", async (overrides) => {
    const result = await createResourceSampler(sources(overrides))();
    expect(result).toMatchObject({ availableMemoryBytes: null, memoryUsedRatio: null, memorySource: "unavailable" });
  });

  it("keeps memory and CPU collection failures independent", async () => {
    const result = await createResourceSampler(sources({
      cpus: () => { throw new Error("CPU unavailable"); },
      totalmem: () => { throw new Error("total unavailable"); },
    }))();
    expect(result).toMatchObject({ memoryUsedRatio: 0.6, cpuUsedRatio: null });
  });
});

describe("sustained pressure policy", () => {
  it("ignores short spikes and requires consecutive warning observations", () => {
    const tracker = createPressureTracker();
    for (const ratio of [0.9, 0.9, 0.5, 0.9, 0.9]) {
      expect(tracker.observe(snapshot(ratio))).toMatchObject({ level: "normal", changed: false });
    }
    expect(tracker.observe(snapshot(0.9))).toEqual({ level: "warning", reasons: ["memory"], changed: true });
    expect(tracker.observe(snapshot(0.9)).changed).toBe(false);
  });

  it("escalates warning to sustained critical pressure without a one-sample escalation", () => {
    const tracker = createPressureTracker();
    for (let i = 0; i < 3; i += 1) tracker.observe(snapshot(0.86));
    expect(tracker.observe(snapshot(0.96)).level).toBe("warning");
    expect(tracker.observe(snapshot(0.96)).level).toBe("warning");
    expect(tracker.observe(snapshot(0.96))).toEqual({ level: "critical", reasons: ["memory"], changed: true });
  });

  it("can enter critical directly and requires recovery below the lower threshold", () => {
    const tracker = createPressureTracker();
    for (let i = 0; i < 3; i += 1) tracker.observe(snapshot(0.96));
    for (const ratio of [0.84, 0.81, 0.8, 0.79, 0.8, 0.79, 0.79]) {
      expect(tracker.observe(snapshot(ratio)).level).toBe("critical");
    }
    expect(tracker.observe(snapshot(0.79))).toEqual({ level: "normal", reasons: [], changed: true });
  });

  it("tracks independent memory and CPU causes and recovers only their measured signals", () => {
    const tracker = createPressureTracker();
    for (let i = 0; i < 3; i += 1) tracker.observe(snapshot(0.86, 0.99));
    expect(tracker.observe(snapshot(0.86, 0.99))).toMatchObject({ level: "critical", reasons: ["memory", "cpu"] });
    for (let i = 0; i < 3; i += 1) tracker.observe(snapshot(0.86, 0.5));
    expect(tracker.observe(snapshot(0.86, 0.5))).toMatchObject({ level: "warning", reasons: ["memory"] });
    for (let i = 0; i < 3; i += 1) tracker.observe(snapshot(0.5, null));
    expect(tracker.observe(snapshot(0.5, null))).toMatchObject({ level: "normal", reasons: [] });
  });

  it("does not combine alternating single-resource spikes into sustained pressure", () => {
    const tracker = createPressureTracker();
    for (let i = 0; i < 10; i += 1) {
      expect(tracker.observe(snapshot(i % 2 ? 0.5 : 0.9, i % 2 ? 0.95 : 0.5)).level).toBe("normal");
    }
  });

  it("never treats missing, malformed or out-of-range data as healthy recovery", () => {
    const tracker = createPressureTracker();
    for (let i = 0; i < 3; i += 1) tracker.observe(snapshot(0.96));
    for (const value of [null, NaN, Infinity, -1, 2, null]) {
      expect(tracker.observe(snapshot(value))).toMatchObject({ level: "critical", reasons: ["memory"], changed: false });
    }
    expect(tracker.observe(snapshot(0.5)).level).toBe("critical");
    tracker.observe(snapshot(null));
    expect(tracker.observe(snapshot(0.5)).level).toBe("critical");
  });

  it("breaks rising streaks when a metric is missing and does not require unsupported memory for CPU warnings", () => {
    const tracker = createPressureTracker();
    tracker.observe(snapshot(0.99));
    tracker.observe(snapshot(0.99));
    expect(tracker.observe(snapshot(null)).level).toBe("normal");
    expect(tracker.observe(snapshot(0.99)).level).toBe("normal");
    for (let i = 0; i < 3; i += 1) tracker.observe(snapshot(null, 0.95));
    expect(tracker.observe(snapshot(null, 0.95))).toMatchObject({ level: "warning", reasons: ["cpu"] });
  });

  it("resets state and isolates caller-owned output from future observations", () => {
    const tracker = createPressureTracker({ consecutiveSamples: 1 });
    const state = tracker.observe(snapshot(0.9));
    state.reasons.splice(0);
    expect(tracker.observe(snapshot(0.9))).toEqual({ level: "warning", reasons: ["memory"], changed: false });
    tracker.reset();
    expect(tracker.observe(snapshot(0.5))).toEqual({ level: "normal", reasons: [], changed: false });
  });

  it("validates threshold order, finite percentages and whole positive sample counts", () => {
    for (const config of [
      { memoryRecoveryPercent: 85 }, { memoryWarningPercent: 96 }, { memoryCriticalPercent: 101 },
      { cpuWarningPercent: NaN }, { cpuRecoveryPercent: -1 }, { consecutiveSamples: 0 }, { consecutiveSamples: 1.5 },
    ]) expect(() => createPressureTracker(config)).toThrow();
    expect(() => createPressureTracker({ ...DEFAULT_PRESSURE_CONFIG, consecutiveSamples: 1 })).not.toThrow();
  });
});
