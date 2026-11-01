import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { agentRoleDefinition, type AgentRoleInput } from "../shared/agent-roles";
import {
  AgentRoleResolutionError, resolveRoleLaunch,
  type ConfigureOverride, type LaunchConfiguration, type RoleRoute,
} from "./agent-roles";

const modes = [
  { id: "full-access", label: "Full access", colorTier: "dangerous" },
  { id: "default", label: "Always Ask", colorTier: "safe" },
];

function fakePaseo(options: {
  ready?: string[];
  models?: Record<string, string[]>;
  usage?: Record<string, number> | null;
  fetchedAt?: string;
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
      listUsage: vi.fn(async () => ({
        fetchedAt: options.fetchedAt ?? new Date().toISOString(),
        providers: options.usage === null ? [] : Object.keys(models).map((providerId) => ({
          providerId, status: "available", fetchedAt: options.fetchedAt ?? new Date().toISOString(),
          windows: [{ usedPct: options.usage?.[providerId] ?? 10 }],
        })),
      })),
    },
  } as any;
}

const configure = vi.fn(async (override?: ConfigureOverride): Promise<LaunchConfiguration> => ({
  provider: override?.provider ?? "claude/claude-sonnet-5-5",
  modeId: override?.modeId ?? "full-access",
  ...(override?.thinkingOptionId ? { thinkingOptionId: override.thinkingOptionId } : {}),
  featureValues: override?.featureValues ?? {},
}));

function role(overrides: Partial<AgentRoleInput> = {}) {
  return agentRoleDefinition.parse({
    id: "design-engineer", name: "Design Engineer", instructions: "Build accessible UI.", ...overrides,
  });
}

function resolve(paseo: any, roles: ReturnType<typeof role>[], extra: Partial<Parameters<typeof resolveRoleLaunch>[0]> = {}) {
  const routes: RoleRoute[] = [
    { agent: "claude/claude-sonnet-5-5", effort: "high" },
    { agent: "codex/gpt-6-luna", effort: "high" },
  ];
  return resolveRoleLaunch({
    paseo, roles, roleId: roles[0].id, cwd: "/repo",
    routes, configure, workPrompt: "WORK", handoffThreshold: 95, ...extra,
  });
}

describe("ordered route resolution", () => {
  it("selects the first eligible route in order with provenance and composes the prompt once", async () => {
    const paseo = fakePaseo();
    const result = await resolve(paseo, [role()]);
    expect(result).toMatchObject({
      source: "routing", selectedIndex: 0,
      config: { provider: "claude/claude-sonnet-5-5", thinkingOptionId: "high" },
    });
    expect(result.attempts).toEqual([
      expect.objectContaining({ index: 0, agent: "claude/claude-sonnet-5-5", code: "selected" }),
    ]);
    expect(result.prompt).toBe("WORK");
    expect(result.config.systemPrompt).toContain("[Lanes role: design-engineer r1]");
    expect(result.composition).toMatchObject({
      delivery: "system_prompt", marker: "[Lanes role: design-engineer r1]", skills: [],
    });
  });

  it("skips an unavailable provider and selects the next eligible route", async () => {
    const paseo = fakePaseo({ ready: ["codex"] });
    const result = await resolve(paseo, [role()]);
    expect(result.selectedIndex).toBe(1);
    expect(result.config.provider).toBe("codex/gpt-6-luna");
    expect(result.attempts[0]).toMatchObject({ code: "provider_unavailable" });
    expect(result.attempts[1]).toMatchObject({ code: "selected" });
  });

  it("reports every skipped route with an explicit reason when nothing qualifies", async () => {
    const paseo = fakePaseo({ ready: [] });
    const error = await resolve(paseo, [role()]).catch((caught) => caught);
    expect(error).toBeInstanceOf(AgentRoleResolutionError);
    expect(error.attempts.map((a: { code: string }) => a.code)).toEqual([
      "provider_unavailable", "provider_unavailable",
    ]);
    expect(error.message).toContain("provider_unavailable");
  });

  it("uses fresh shared quota for automatic routing and fails closed for unknown or stale usage", async () => {
    const overThreshold = await resolve(fakePaseo({ usage: { claude: 96, codex: 12 } }), [role()]);
    expect(overThreshold).toMatchObject({ selectedIndex: 1, config: { provider: "codex/gpt-6-luna" } });
    expect(overThreshold.attempts[0]).toMatchObject({ code: "quota_handoff" });

    const unknown = await resolve(fakePaseo({ usage: null }), [role()]).catch((error) => error);
    expect(unknown).toBeInstanceOf(AgentRoleResolutionError);
    expect(unknown.attempts.map((attempt: { code: string }) => attempt.code)).toEqual(["quota_unknown", "quota_unknown"]);

    const future = await resolve(fakePaseo({ fetchedAt: new Date(Date.now() + 5 * 60_000).toISOString() }), [role()]).catch((error) => error);
    expect(future).toBeInstanceOf(AgentRoleResolutionError);
    expect(future.attempts[0]).toMatchObject({ code: "quota_unknown" });
  });

  it("reports crossed warning thresholds in selected route diagnostics", async () => {
    const result = await resolve(fakePaseo({ usage: { claude: 85, codex: 12 } }), [role()], {
      warningThresholds: [80, 90], handoffThreshold: 95,
    });
    expect(result.attempts[0]).toMatchObject({
      code: "selected",
      message: expect.stringContaining("Usage is 85%, crossing warning threshold 80%."),
    });
  });

  it("lets the provider model default handle a saved effort the model no longer offers", async () => {
    configure.mockClear();
    const result = await resolve(fakePaseo(), [role()], {
      routes: [{ agent: "claude/claude-sonnet-5-5", effort: "ultra" }],
    });
    expect(result.config).not.toHaveProperty("thinkingOptionId");
    expect(configure).toHaveBeenCalledWith(
      { provider: "claude/claude-sonnet-5-5", featureValues: {} }, { automaticRoute: true },
    );
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

  it("records configuration failures from configure override and moves on", async () => {
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
  it("lets explicit manual options win over every route while still composing guidance", async () => {
    const paseo = fakePaseo();
    const result = await resolve(paseo, [role()], { agentConfig: { provider: "codex/gpt-6-luna", featureValues: {} } });
    expect(result).toMatchObject({ source: "manual", selectedIndex: null, config: { provider: "codex/gpt-6-luna" } });
    expect(result.config.systemPrompt).toContain("[Lanes role: design-engineer r1]");
    expect(result.prompt).toBe("WORK");
    expect(paseo.providers.snapshot).not.toHaveBeenCalled();
  });

  it("uses the existing per-role defaults for a role without routes", async () => {
    const preset = role({ id: "lane-dev", name: "Lane Dev", instructions: "", skills: [] });
    const result = await resolve(fakePaseo(), [preset], { routes: [], workPrompt: "WORK" });
    expect(result).toMatchObject({ source: "defaults", prompt: "WORK" });
    expect(configure).toHaveBeenLastCalledWith();
  });

  it("returns an unchanged work prompt for an instruction-free preset", async () => {
    const preset = role({ id: "fast-implementation", name: "Fast", instructions: "", skills: [] });
    const result = await resolve(fakePaseo(), [preset]);
    expect(result.prompt).toBe("WORK");
    expect(result.config.systemPrompt).toBeUndefined();
  });

  it("composes actual skill content and preserves a caller systemPrompt", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "role-skill-"));
    try {
      fs.mkdirSync(path.join(dir, "lane-dev"));
      fs.writeFileSync(path.join(dir, "lane-dev", "SKILL.md"), "LANE DEV SKILL BODY");
      const withSkill = role({ skills: ["lane-dev"] });
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
      const needsSkill = role({ skills: ["absent-skill"] });
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
