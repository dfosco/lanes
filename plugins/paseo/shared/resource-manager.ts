import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

const percent = () => z.number().min(1).max(100);

/** Separate host settings keep resource policy independent of launch/model defaults. */
export const resourceManagerSettings = z.object({
  enabled: z.boolean().default(true),
  sampleIntervalSeconds: z.number().int().min(5).max(300).default(15),
  consecutiveSamples: z.number().int().min(2).max(20).default(3),
  notificationCooldownSeconds: z.number().int().min(30).max(3600).default(120),
  idleAgeSeconds: z.number().int().min(0).max(86400).default(300),
  memoryWarningPercent: percent().default(85),
  memoryCriticalPercent: percent().default(95),
  memoryRecoveryPercent: percent().default(80),
  cpuWarningPercent: percent().default(90),
  cpuCriticalPercent: percent().default(98),
  cpuRecoveryPercent: percent().default(80),
}).superRefine((value, context) => {
  for (const metric of ["memory", "cpu"] as const) {
    if (value[`${metric}RecoveryPercent`] >= value[`${metric}WarningPercent`] ||
        value[`${metric}WarningPercent`] >= value[`${metric}CriticalPercent`]) {
      context.addIssue({ code: "custom", path: [`${metric}WarningPercent`],
        message: `${metric === "memory" ? "Memory" : "CPU"} thresholds must be recovery < warning < critical.` });
    }
  }
});
export type ResourceManagerSettings = z.infer<typeof resourceManagerSettings>;

export const resourceManagerPreferences = defineSettings({
  id: "resource-manager",
  scope: "host",
  version: 1,
  schema: resourceManagerSettings,
});

export const resourceSnapshot = z.object({
  sampledAt: z.number(),
  totalMemoryBytes: z.number().nonnegative().nullable(),
  availableMemoryBytes: z.number().nonnegative().nullable(),
  memoryUsedRatio: z.number().min(0).max(1).nullable(),
  cpuUsedRatio: z.number().min(0).max(1).nullable(),
  memorySource: z.string(),
});

export const resourceManagerStatus = z.object({
  enabled: z.boolean(),
  state: z.enum(["starting", "monitoring", "awaiting_runtime", "disabled", "error", "stopped"]),
  pressure: z.enum(["normal", "warning", "critical"]),
  reasons: z.array(z.enum(["memory", "cpu"])),
  snapshot: resourceSnapshot.nullable(),
  lastNoticeAt: z.number().nullable(),
  notifiedManagers: z.number().int().nonnegative(),
  deferredManagers: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
});
export type ResourceManagerStatus = z.infer<typeof resourceManagerStatus>;

export const resourceManagerStatusRpc = defineRpc({
  name: "clips.resource-manager.status",
  input: z.object({}).strict(),
  output: resourceManagerStatus,
});
