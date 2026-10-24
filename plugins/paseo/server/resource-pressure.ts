import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";

export type ResourceSnapshot = {
  sampledAt: number;
  totalMemoryBytes: number | null;
  availableMemoryBytes: number | null;
  memoryUsedRatio: number | null;
  cpuUsedRatio: number | null;
  memorySource: "linux-memavailable" | "darwin-memory-pressure" | "windows-freemem" | "unavailable";
};

type CpuTimes = { user: number; nice: number; sys: number; idle: number; irq: number };
type CpuReading = { count: number; total: number; idle: number };
export type ResourceSamplerDependencies = {
  platform: () => string;
  now: () => number;
  cpus: () => readonly { times: CpuTimes }[];
  totalmem: () => number;
  freemem: () => number;
  readTextFile: (file: string) => Promise<string>;
  readDarwinMemoryPressure: () => Promise<string>;
};

function darwinMemoryPressure(): Promise<string> {
  return new Promise((resolve, reject) => {
    // -Q only suppresses verbose statistics. With no -p/-l/-S, Apple's utility
    // reports kernel memory availability and exits; it never generates pressure.
    execFile("/usr/bin/memory_pressure", ["-Q"], {
      encoding: "utf8", timeout: 2_000, maxBuffer: 32 * 1024,
      env: { ...process.env, LC_ALL: "C" },
    }, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}

const defaults: ResourceSamplerDependencies = {
  platform: os.platform, now: Date.now, cpus: os.cpus,
  totalmem: os.totalmem, freemem: os.freemem,
  readTextFile: (file) => readFile(file, "utf8"),
  readDarwinMemoryPressure: darwinMemoryPressure,
};

function validBytes(value: number, positive = false): boolean {
  return Number.isSafeInteger(value) && (positive ? value > 0 : value >= 0);
}

function cpuReading(read: ResourceSamplerDependencies["cpus"]): CpuReading | null {
  try {
    const entries = read();
    if (!entries.length) return null;
    let total = 0, idle = 0;
    for (const { times } of entries) {
      const ticks = [times.user, times.nice, times.sys, times.idle, times.irq];
      if (!ticks.every((value) => Number.isFinite(value) && value >= 0)) return null;
      total += ticks.reduce((sum, value) => sum + value, 0);
      idle += times.idle;
    }
    return Number.isSafeInteger(total) && Number.isSafeInteger(idle)
      ? { count: entries.length, total, idle } : null;
  } catch { return null; }
}

/** Host metrics, not per-agent usage or container quotas. Invoke samples serially. */
export function createResourceSampler(overrides: Partial<ResourceSamplerDependencies> = {}) {
  const source = { ...defaults, ...overrides };
  let previousCpu: CpuReading | null = null;
  return async (): Promise<ResourceSnapshot> => {
    const sampledAt = source.now();
    const currentCpu = cpuReading(source.cpus);
    let cpuUsedRatio: number | null = null;
    if (currentCpu && previousCpu && currentCpu.count === previousCpu.count) {
      const elapsed = currentCpu.total - previousCpu.total;
      const idle = currentCpu.idle - previousCpu.idle;
      if (elapsed > 0 && idle >= 0 && idle <= elapsed) cpuUsedRatio = 1 - idle / elapsed;
    }
    // A failed observation or topology change starts a fresh measurement window.
    previousCpu = currentCpu;

    let totalMemoryBytes: number | null = null;
    let availableMemoryBytes: number | null = null;
    let memorySource: ResourceSnapshot["memorySource"] = "unavailable";
    try {
      const total = source.totalmem();
      if (validBytes(total, true)) totalMemoryBytes = total;
    } catch { /* Keep missing metrics unknown, never healthy by assumption. */ }
    try {
      const platform = source.platform();
      if (platform === "linux") {
        const meminfo = await source.readTextFile("/proc/meminfo");
        const totalMatch = /^MemTotal:\s+(\d+)\s+kB\s*$/m.exec(meminfo);
        const availableMatch = /^MemAvailable:\s+(\d+)\s+kB\s*$/m.exec(meminfo);
        const total = totalMatch ? Number(totalMatch[1]) * 1024 : NaN;
        const available = availableMatch ? Number(availableMatch[1]) * 1024 : NaN;
        if (validBytes(total, true) && validBytes(available) && available <= total) {
          totalMemoryBytes = total;
          availableMemoryBytes = available;
          memorySource = "linux-memavailable";
        }
      } else if (platform === "darwin" && totalMemoryBytes !== null) {
        const output = await source.readDarwinMemoryPressure();
        const match = /^System-wide memory free percentage:\s*(\d+(?:\.\d+)?)%\s*$/m.exec(output);
        const percent = match ? Number(match[1]) : NaN;
        if (Number.isFinite(percent) && percent >= 0 && percent <= 100) {
          availableMemoryBytes = Math.round(totalMemoryBytes * percent / 100);
          memorySource = "darwin-memory-pressure";
        }
      } else if (platform === "win32" && totalMemoryBytes !== null) {
        const available = source.freemem();
        if (validBytes(available) && available <= totalMemoryBytes) {
          availableMemoryBytes = available;
          memorySource = "windows-freemem";
        }
      }
    } catch { /* A missing command/procfs metric must not become false pressure. */ }
    return {
      sampledAt, totalMemoryBytes, availableMemoryBytes, memorySource, cpuUsedRatio,
      memoryUsedRatio: totalMemoryBytes !== null && availableMemoryBytes !== null
        ? (totalMemoryBytes - availableMemoryBytes) / totalMemoryBytes : null,
    };
  };
}

export type PressureLevel = "normal" | "warning" | "critical";
export type PressureReason = "memory" | "cpu";
export type PressureConfig = {
  memoryWarningPercent: number;
  memoryCriticalPercent: number;
  memoryRecoveryPercent: number;
  cpuWarningPercent: number;
  cpuCriticalPercent: number;
  cpuRecoveryPercent: number;
  consecutiveSamples: number;
};
export const DEFAULT_PRESSURE_CONFIG: Readonly<PressureConfig> = Object.freeze({
  memoryWarningPercent: 85, memoryCriticalPercent: 95, memoryRecoveryPercent: 80,
  cpuWarningPercent: 90, cpuCriticalPercent: 98, cpuRecoveryPercent: 80,
  consecutiveSamples: 3,
});
export type PressureState = { level: PressureLevel; reasons: PressureReason[]; changed: boolean };

type MetricState = { level: PressureLevel; warning: number; critical: number; recovery: number };
const emptyMetric = (): MetricState => ({ level: "normal", warning: 0, critical: 0, recovery: 0 });

function validateConfig(config: PressureConfig): void {
  for (const prefix of ["memory", "cpu"] as const) {
    const recovery = config[`${prefix}RecoveryPercent`];
    const warning = config[`${prefix}WarningPercent`];
    const critical = config[`${prefix}CriticalPercent`];
    if (![recovery, warning, critical].every(Number.isFinite) ||
        recovery < 0 || recovery >= warning || warning >= critical || critical > 100) {
      throw new Error(`${prefix} pressure thresholds must satisfy 0 <= recovery < warning < critical <= 100.`);
    }
  }
  if (!Number.isSafeInteger(config.consecutiveSamples) || config.consecutiveSamples < 1) {
    throw new Error("consecutiveSamples must be a positive integer.");
  }
}

/** Independent sustained signals; an unknown metric cannot trigger or recover it. */
export function createPressureTracker(input: Partial<PressureConfig> = {}) {
  const config = { ...DEFAULT_PRESSURE_CONFIG, ...input };
  validateConfig(config);
  let metrics = { memory: emptyMetric(), cpu: emptyMetric() };
  let previous: PressureState = { level: "normal", reasons: [], changed: false };
  return {
    reset(): void {
      metrics = { memory: emptyMetric(), cpu: emptyMetric() };
      previous = { level: "normal", reasons: [], changed: false };
    },
    observe(snapshot: ResourceSnapshot): PressureState {
      for (const reason of ["memory", "cpu"] as const) {
        const metric = metrics[reason];
        const ratio = reason === "memory" ? snapshot.memoryUsedRatio : snapshot.cpuUsedRatio;
        if (ratio === null || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
          metric.warning = metric.critical = metric.recovery = 0;
          continue;
        }
        const percent = ratio * 100;
        const bump = (count: number, matches: boolean) => matches ? Math.min(count + 1, config.consecutiveSamples) : 0;
        metric.warning = bump(metric.warning, percent >= config[`${reason}WarningPercent`]);
        metric.critical = bump(metric.critical, percent >= config[`${reason}CriticalPercent`]);
        metric.recovery = bump(metric.recovery, percent < config[`${reason}RecoveryPercent`]);
        if (metric.recovery >= config.consecutiveSamples) metric.level = "normal";
        else if (metric.critical >= config.consecutiveSamples) metric.level = "critical";
        else if (metric.warning >= config.consecutiveSamples && metric.level === "normal") metric.level = "warning";
      }
      const reasons = (["memory", "cpu"] as const).filter((reason) => metrics[reason].level !== "normal");
      const level: PressureLevel = reasons.some((reason) => metrics[reason].level === "critical")
        ? "critical" : reasons.length ? "warning" : "normal";
      const changed = level !== previous.level || reasons.join(",") !== previous.reasons.join(",");
      previous = { level, reasons, changed };
      return { ...previous, reasons: [...reasons] };
    },
  };
}
