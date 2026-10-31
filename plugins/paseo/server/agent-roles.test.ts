import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { agentRoleDefinition, type AgentRoleInput } from "../shared/agent-roles";
import { AgentRoleResolutionError, resolveRoleLaunch, usageEvidence, escalates, type ConfigureOverride, type LaunchConfiguration } from "./agent-roles";

const NOW = Date.parse("2026-10-31T20:00:00Z");
const fresh = new Date(NOW - 5 * 60_000).toISOString();
const stale = new Date(NOW - 90 * 60_000).toISOString();

const modes = [
  { id: "full-access", label: "Full access", colorTier: "dangerous" },
  { id: "default", label: "Always Ask", colorTier: "safe" },
];

function fakePaseo(options: {
  ready?: string[];
  models?: Record<string, string[]>;
  usage?: Record<string, { fetchedAt?: string; status?: string; windows: { id: string; label: string; usedPct: number | null }[] }>;
  usageFails?: boolean;
  usageFetchedAt?: string;
} = {}) {
  const ready = options.ready ?? ["claude", "codex"];
  const models = options.models ?? { claude: ["claude-sonnet-5-5", "claude-opus-5-5"], codex: ["gpt-6-luna"] };
  return {
    providers: {
      snapshot: vi.fn(async () => ({
        entries: Object.keys(models).map((provider) => ({
          provider, status: ready.includes(provider) ? "ready" : "unavailable", enabled: true,
          defaultModeId: "full-access", modes,
          models: models[provider].map((id) => ({
            id, label: id, isSelectable: true,
            thinkingOptions: [{ id: "high", label: "High" }, { id: "medium", label: "Medium" }],
            defaultThinkingOptionId: "medium",
          })),
        })),
      })),
      listModes: vi.fn(async () => ({ modes })),
      listUsage: vi.fn(async () => {
        if (options.usageFails) throw new Error("usage service down");
        return {
          requestId: "r", fetchedAt: options.usageFetchedAt ?? fresh,
          providers: Object.entries(options.usage ?? {}).map(([providerId, report]) => ({
            providerId, displayName: providerId, status: report.status ?? "available", planLabel: null,
            fetchedAt: report.fetchedAt ?? fresh, windows: report.windows,
          })),
        };
      }),
    },
  } as any;
}

const configure = vi.fn(async (override?: ConfigureOverride): Promise<LaunchConfiguration> => ({
  provider: override?.provider ?? "claude/claude-sonnet-5-5",
  modeId: override?.modeId ?? "full-access",
  ...(override?.thinkingOptionId ? { thinkingOptionId: override.thinkingOptionId } : {}),
  featureValues: override?.featureValues ?? {},
}));

function role(overrides: Partial<AgentRoleInput> = {}, candidates = [
  { agent: "claude/claude-sonnet-5-5", thinkingOptionId: "high" },
  { agent: "codex/gpt-6-luna", thinkingOptionId: "high" },
]) {
  return agentRoleDefinition.parse({
    id: "design-engineer", name: "Design Engineer", instructions: "Build accessible UI.", candidates, ...overrides,
  });
}

function resolve(paseo: any, roles: ReturnType<typeof role>[], extra: Partial<Parameters<typeof resolveRoleLaunch>[0]> = {}) {
  return resolveRoleLaunch({
    paseo, roles, roleId: roles[0].id, cwd: "/repo", baselineModeId: "full-access",
    configure, now: () => NOW, workPrompt: "WORK", ...extra,
  });
}

describe("usage evidence", () => {
  const report = { status: "available", fetchedAt: fresh, windows: [
    { id: "5h", label: "5-hour", usedPct: 40 }, { id: "wk", label: "Weekly", usedPct: 82 }, { id: "x", label: "X", usedPct: null },
  ] };

  it("uses the maximum applicable window rather than the average", () => {
    const evidence = usageEvidence("claude", report, { maxAgeMinutes: 30, now: NOW });
    expect(evidence).toMatchObject({ state: "known", maxUsedPct: 82, window: "Weekly" });
  });

  it("treats missing, stale, failed and non-numeric readings as unknown, never zero", () => {
    expect(usageEvidence("claude", undefined, { maxAgeMinutes: 30, now: NOW })).toMatchObject({ state: "unknown" });
    expect(usageEvidence("claude", { ...report, fetchedAt: stale }, { maxAgeMinutes: 30, now: NOW })).toMatchObject({ state: "unknown" });
    expect(usageEvidence("claude", report, { maxAgeMinutes: 30, now: NOW, failure: "boom" })).toMatchObject({ state: "unknown" });
    expect(usageEvidence("claude", { status: "available", fetchedAt: fresh, windows: [] }, { maxAgeMinutes: 30, now: NOW }))
      .toMatchObject({ state: "unknown", maxUsedPct: null });
  });

  it("falls back to the report-level fetch time when the provider entry omits one", () => {
    const evidence = usageEvidence("claude", { status: "available", windows: [{ id: "a", label: "A", usedPct: 10 }] },
      { maxAgeMinutes: 30, now: NOW, fallbackFetchedAt: fresh });
    expect(evidence).toMatchObject({ state: "known", maxUsedPct: 10 });
  });
});

describe("ordered candidate resolution", () => {
  it("selects the first eligible candidate with provenance and composes the prompt once", async () => {
    const paseo = fakePaseo({ usage: { claude: { windows: [{ id: "5h", label: "5-hour", usedPct: 40 }] } } });
    const result = await resolve(paseo, [role()]);
    expect(result).toMatchObject({ source: "candidate", selectedIndex: 0, config: { provider: "claude/claude-sonnet-5-5" } });
    expect(result.attempts).toEqual([expect.objectContaining({ index: 0, agent: "claude/claude-sonnet-5-5", code: "selected" })]);
    // Guidance travels in the creation-time systemPrompt; the work prompt stays exactly as supplied.
    expect(result.prompt).toBe("WORK");
    expect(result.config.systemPrompt).toContain("[Lanes role: design-engineer r1]");
    expect(result.composition).toMatchObject({ delivery: "system_prompt", marker: "[Lanes role: design-engineer r1]", skills: [] });
  });

  it("skips a provider at the 95% threshold and selects the next eligible candidate", async () => {
    const paseo = fakePaseo({ usage: {
      claude: { windows: [{ id: "wk", label: "Weekly", usedPct: 95 }] },
      codex: { windows: [{ id: "5h", label: "5-hour", usedPct: 94.9 }] },
    } });
    const result = await resolve(paseo, [role()]);
    expect(result.selectedIndex).toBe(1);
    expect(result.attempts[0]).toMatchObject({ code: "quota_exhausted", usage: { maxUsedPct: 95, window: "Weekly" } });
    expect(result.attempts[1]).toMatchObject({ code: "selected" });
  });

  it("reports every skipped candidate with an explicit reason when nothing qualifies", async () => {
    const paseo = fakePaseo({ ready: ["claude"], usage: { claude: { windows: [{ id: "wk", label: "Weekly", usedPct: 99 }] } } });
    const error = await resolve(paseo, [role()]).catch((caught) => caught);
    expect(error).toBeInstanceOf(AgentRoleResolutionError);
    expect(error.attempts.map((a: { code: string }) => a.code)).toEqual(["quota_exhausted", "provider_unavailable"]);
    expect(error.message).toContain("quota_exhausted");
  });

  it("never treats a model absent from the live catalog as launchable", async () => {
    const paseo = fakePaseo({ models: { claude: ["claude-opus-5-5"], codex: ["gpt-6-luna"] } });
    const result = await resolve(paseo, [role()]);
    expect(result.attempts[0]).toMatchObject({ code: "model_unavailable" });
    expect(result.selectedIndex).toBe(1);
  });

  it("does not invent availability for an unreported provider", async () => {
    const paseo = fakePaseo({ ready: [], models: { claude: ["claude-sonnet-5-5"] } });
    await expect(resolve(paseo, [role()])).rejects.toMatchObject({
      attempts: expect.arrayContaining([expect.objectContaining({ code: "provider_unavailable" })]),
    });
  });
});

describe("unknown and stale quota", () => {
  const unknownPaseo = () => fakePaseo({ usage: { claude: { fetchedAt: stale, windows: [{ id: "5h", label: "5h", usedPct: 1 }] } } });

  it("allows unknown quota by default but records the reason and never treats it as zero", async () => {
    const result = await resolve(unknownPaseo(), [role({}, [{ agent: "claude/claude-sonnet-5-5" }])]);
    expect(result.selectedIndex).toBe(0);
    expect(result.attempts[0].usage).toMatchObject({ state: "unknown", maxUsedPct: null });
    expect(result.attempts[0].message).toMatch(/Quota unknown/);
  });

  it("skips unknown quota when the role asks for skip", async () => {
    const skipping = role({ quota: { whenUnknown: "skip" } }, [{ agent: "claude/claude-sonnet-5-5" }]);
    await expect(resolve(unknownPaseo(), [skipping])).rejects.toMatchObject({ attempts: [expect.objectContaining({ code: "quota_unknown_skipped" })] });
  });

  it("treats a failed usage read as unknown rather than failing the whole resolution", async () => {
    const result = await resolve(fakePaseo({ usageFails: true }), [role({}, [{ agent: "claude/claude-sonnet-5-5" }])]);
    expect(result.attempts[0].usage).toMatchObject({ state: "unknown" });
    expect(result.attempts[0].usage?.reason).toMatch(/usage service down/);
  });
});

describe("cost, permission and configuration guards", () => {
  it("requires approval for a metered candidate, including the first choice", async () => {
    const metered = role({}, [{ agent: "codex/gpt-6-luna", metered: true }, { agent: "claude/claude-sonnet-5-5" }]);
    const blocked = await resolve(fakePaseo(), [metered]);
    expect(blocked.attempts[0]).toMatchObject({ code: "metered_not_approved" });
    expect(blocked.selectedIndex).toBe(1);
    const approved = await resolve(fakePaseo(), [metered], { approveMetered: true });
    expect(approved.selectedIndex).toBe(0);
  });

  it("refuses a candidate mode more permissive than the launch baseline", async () => {
    const paseo = fakePaseo();
    const escalating = role({}, [{ agent: "claude/claude-sonnet-5-5", modeId: "full-access" }]);
    const result = await resolve(paseo, [escalating], { baselineModeId: "default" }).catch((caught) => caught);
    expect(result.attempts[0]).toMatchObject({ code: "permission_escalation" });
  });

  it("allows an equal or narrower candidate mode", () => {
    expect(escalates(modes, "default", "full-access")).toBe(false);
    expect(escalates(modes, "full-access", "default")).toBe(true);
    expect(escalates(modes, "full-access", "unknown-baseline")).toBe(false);
  });

  it("records configuration failures from the shared validator and moves on", async () => {
    const strict = vi.fn(async (override?: ConfigureOverride) => {
      if (override?.provider === "claude/claude-sonnet-5-5") throw new Error("Thinking option high is unavailable.");
      return configure(override);
    });
    const result = await resolve(fakePaseo(), [role()], { configure: strict });
    expect(result.attempts[0]).toMatchObject({ code: "configuration_invalid", message: expect.stringContaining("high") });
    expect(result.selectedIndex).toBe(1);
  });
});

describe("manual precedence and defaults", () => {
  it("lets explicit manual options win over every candidate while still composing guidance", async () => {
    const paseo = fakePaseo();
    const result = await resolve(paseo, [role()], { agentConfig: { provider: "codex/gpt-6-luna", featureValues: {} } });
    expect(result).toMatchObject({ source: "manual", selectedIndex: null, config: { provider: "codex/gpt-6-luna" } });
    expect(result.config.systemPrompt).toContain("[Lanes role: design-engineer r1]");
    expect(result.prompt).toBe("WORK");
    expect(paseo.providers.snapshot).not.toHaveBeenCalled();
  });

  it("uses the existing per-role defaults for a role without candidates", async () => {
    const preset = role({ id: "lane-dev", name: "Lane Dev", instructions: "", skills: [] }, []);
    const result = await resolve(fakePaseo(), [preset], { workPrompt: "WORK" });
    expect(result).toMatchObject({ source: "defaults", prompt: "WORK" });
    expect(configure).toHaveBeenLastCalledWith();
  });

  it("returns an unchanged work prompt for an instruction-free preset", async () => {
    const preset = role({ id: "fast-implementation", name: "Fast", instructions: "", skills: [] }, [{ agent: "claude/claude-sonnet-5-5" }]);
    const result = await resolve(fakePaseo(), [preset]);
    expect(result.prompt).toBe("WORK");
    expect(result.config.systemPrompt).toBeUndefined();
  });

  it("composes actual skill content and preserves a caller systemPrompt", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "role-skill-"));
    try {
      fs.mkdirSync(path.join(dir, "lane-dev"));
      fs.writeFileSync(path.join(dir, "lane-dev", "SKILL.md"), "LANE DEV SKILL BODY");
      const withSkill = role({ skills: ["lane-dev"] }, [{ agent: "claude/claude-sonnet-5-5" }]);
      const result = await resolve(fakePaseo(), [withSkill], {
        skillRoots: [{ scope: "workspace", dir }], systemPrompt: "Caller policy first.",
      });
      expect(result.config.systemPrompt?.startsWith("Caller policy first.")).toBe(true);
      expect(result.config.systemPrompt).toContain("LANE DEV SKILL BODY");
      expect(result.composition.skills).toEqual([expect.objectContaining({ id: "lane-dev", scope: "workspace" })]);
      expect(result.prompt).toBe("WORK");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails the role launch with the missing skill and searched roots instead of claiming it loaded", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "role-skill-empty-"));
    try {
      const needsSkill = role({ skills: ["absent-skill"] }, [{ agent: "claude/claude-sonnet-5-5" }]);
      const paseo = fakePaseo();
      await expect(resolve(paseo, [needsSkill], { skillRoots: [{ scope: "workspace", dir }] }))
        .rejects.toMatchObject({ code: "skill_missing" });
      expect(paseo.providers.snapshot).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("names unknown roles explicitly", async () => {
    await expect(resolve(fakePaseo(), [role()], { roleId: "missing" })).rejects.toThrow(/does not exist/);
  });
});
