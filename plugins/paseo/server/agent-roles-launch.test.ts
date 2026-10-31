import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { agentRoleDefinition, builtInRoles, agentRolesSettings } from "../shared/agent-roles";
import { preferences } from "../shared/contracts";
import { promptFor } from "../shared/work";
import { startWork } from "./backend";
import { setAgentRoleSource } from "./agent-role-source";
import { registerAgentRoles } from "./agent-roles-register";
import { start } from "../cli.js";

const cli = fileURLToPath(new URL("../../../src/cli.js", import.meta.url));
const pluginManifestId = JSON.parse(fs.readFileSync(fileURLToPath(new URL("../paseo-plugin.json", import.meta.url)), "utf8")).id;
const NOW = Date.now();
const fresh = new Date(NOW - 60_000).toISOString();

const modes = [
  { id: "full-access", label: "Full access", colorTier: "dangerous" },
  { id: "default", label: "Always Ask", colorTier: "safe" },
];
const catalog = () => ({
  entries: [{
    provider: "claude", status: "ready", enabled: true, defaultModeId: "full-access", modes,
    models: ["claude-sonnet-5-5", "claude-haiku-5-5"].map((id) => ({
      id, label: id, isSelectable: true,
      thinkingOptions: [{ id: "high", label: "High" }, { id: "medium", label: "Medium" }],
      defaultThinkingOptionId: "medium",
    })),
  }],
});

function fakePaseo(root: string, options: { usedPct?: number } = {}) {
  const agentCreate = vi.fn(async () => ({ id: "agent-1", workspaceId: "ws-new", send: vi.fn() }));
  const workspaceCreate = vi.fn(async () => ({ id: "ws-new", agents: { create: agentCreate } }));
  const usageReports = options.usedPct === undefined ? [] : [{
    providerId: "claude", displayName: "Claude", status: "available", planLabel: null, fetchedAt: fresh,
    windows: [{ id: "wk", label: "Weekly", usedPct: options.usedPct }],
  }];
  const paseo: any = {
    projects: { list: async () => ({ projects: [{
      projectId: "p1", projectKind: "git", projectRootPath: root, projectDisplayName: "Fixture", projectCustomName: null,
    }] }) },
    workspaces: {
      list: async () => ({ entries: [], pageInfo: { hasMore: false } }),
      create: workspaceCreate,
      ref: () => ({ id: "ws-new", agents: { create: agentCreate } }),
    },
    agents: { list: async () => ({ entries: [], pageInfo: { hasMore: false } }) },
    providers: {
      snapshot: async () => catalog(),
      listModes: async () => ({ modes }),
      listFeatures: async () => ({ features: [] }),
      listUsage: async () => ({ requestId: "r", fetchedAt: fresh, providers: usageReports }),
    },
  };
  return { paseo, agentCreate, workspaceCreate };
}

function setRoles(roles: ReturnType<typeof builtInRoles> | null) {
  setAgentRoleSource(roles ? { read: async () => ({ status: "ready", revision: "1", values: { roles } }) } : null);
}

let root = "";
let previousEnv: Record<string, string | undefined> = {};
let target = "";
let workPrompt = "";
// One Lanes fixture per file: the CLI is slow under parallel test load, and launches only read the board.
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lanes-role-launch-"));
  previousEnv = Object.fromEntries(["LANES_HOME", "LANES_CLI_PATH"].map((key) => [key, process.env[key]]));
  process.env.LANES_HOME = path.join(root, "home");
  process.env.LANES_CLI_PATH = cli;
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "--quiet", "-m", "init"], { cwd: root });
  const run = (...args: string[]) => execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
  run("init", "--skills-scope", "project");
  run("goal", "create", JSON.stringify({ title: "Role goal", description: "Verify roles" }));
  run("task", "create", "g1", JSON.stringify({ title: "Role task", description: "Build the role path" }));
  fs.mkdirSync(path.join(root, ".agents", "skills", "lane-fixture"), { recursive: true });
  fs.writeFileSync(path.join(root, ".agents", "skills", "lane-fixture", "SKILL.md"), "FIXTURE SKILL BODY");
  target = "#g001#t01";
  workPrompt = promptFor({ kind: "task", ref: target, title: "Role task" });
});
afterEach(() => setAgentRoleSource(null));
afterAll(() => {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

describe("role launches through the backend", () => {
  it("resolves the first eligible live candidate and composes the work prompt exactly once", async () => {
    setRoles(builtInRoles());
    const { paseo, agentCreate, workspaceCreate } = fakePaseo(root, { usedPct: 10 });
    const result = await startWork(paseo, preferences.schema.parse({}), { projectId: "p1", ref: target, mode: "agent", roleId: "design-engineer" });
    expect(result).toMatchObject({ agentId: "agent-1", agent: "claude/claude-sonnet-5-5" });
    expect(workspaceCreate).toHaveBeenCalledOnce();
    const sent = agentCreate.mock.calls[0][0] as { prompt: string; config: { provider: string; thinkingOptionId?: string; systemPrompt?: string } };
    expect(sent.config).toMatchObject({ provider: "claude/claude-sonnet-5-5", thinkingOptionId: "high" });
    // Guidance is the creation-time systemPrompt, exactly once; the Task prompt is sent unchanged.
    expect(sent.config.systemPrompt?.split("[Lanes role: design-engineer r1]")).toHaveLength(2);
    expect(sent.prompt).toBe(workPrompt);
  });

  it("does not create a workspace when no candidate is eligible", async () => {
    setRoles(builtInRoles());
    const { paseo, workspaceCreate, agentCreate } = fakePaseo(root, { usedPct: 96 });
    await expect(startWork(paseo, preferences.schema.parse({}), { projectId: "p1", ref: target, mode: "agent", roleId: "design-engineer" }))
      .rejects.toThrow(/quota_exhausted/);
    expect(workspaceCreate).not.toHaveBeenCalled();
    expect(agentCreate).not.toHaveBeenCalled();
  });

  it("keeps manual launches unchanged: the work prompt is sent without role guidance", async () => {
    const { paseo, agentCreate } = fakePaseo(root);
    await startWork(paseo, preferences.schema.parse({}), {
      projectId: "p1", ref: target, mode: "agent",
      agentConfig: { provider: "claude/claude-haiku-5-5", modeId: "full-access", thinkingOptionId: "medium", featureValues: {} },
    });
    const sent = agentCreate.mock.calls[0][0] as { prompt: string; config: { provider: string; systemPrompt?: string } };
    expect(sent.prompt).toBe(workPrompt);
    expect(sent.config.systemPrompt).toBeUndefined();
    expect(sent.config.provider).toBe("claude/claude-haiku-5-5");
  });

  it("explicit manual options win over a role's candidates while the role still contributes guidance", async () => {
    setRoles(builtInRoles());
    const { paseo, agentCreate } = fakePaseo(root);
    await startWork(paseo, preferences.schema.parse({}), {
      projectId: "p1", ref: target, mode: "agent", roleId: "design-engineer",
      agentConfig: { provider: "claude/claude-haiku-5-5", modeId: "full-access", thinkingOptionId: "medium", featureValues: {} },
    });
    const sent = agentCreate.mock.calls[0][0] as { prompt: string; config: { provider: string; systemPrompt?: string } };
    expect(sent.config.provider).toBe("claude/claude-haiku-5-5");
    expect(sent.config.systemPrompt).toContain("[Lanes role: design-engineer r1]");
    expect(sent.prompt).toBe(workPrompt);
  });

  it("sends real skill content in the systemPrompt and fails with no workspace when a required skill is absent", async () => {
    const withSkill = agentRoleDefinition.parse({
      id: "skilled", name: "Skilled", instructions: "Follow the skill.", skills: ["lane-fixture"],
      candidates: [{ agent: "claude/claude-sonnet-5-5" }],
    });
    setRoles([...builtInRoles(), withSkill]);
    const { paseo, agentCreate, workspaceCreate } = fakePaseo(root);
    await startWork(paseo, preferences.schema.parse({}), { projectId: "p1", ref: target, mode: "agent", roleId: "skilled" });
    const sent = agentCreate.mock.calls.at(-1)?.[0] as { prompt: string; config: { systemPrompt?: string } };
    expect(sent.config.systemPrompt).toContain("FIXTURE SKILL BODY");
    expect(sent.prompt).toBe(workPrompt);

    setRoles([...builtInRoles(), agentRoleDefinition.parse({ ...withSkill, id: "needs-missing", name: "Needs Missing", skills: ["not-installed"] })]);
    const before = workspaceCreate.mock.calls.length;
    await expect(startWork(paseo, preferences.schema.parse({}), { projectId: "p1", ref: target, mode: "agent", roleId: "needs-missing" }))
      .rejects.toMatchObject({ code: "skill_missing" });
    expect(workspaceCreate.mock.calls.length).toBe(before);
  });

  it("rejects roles outside agent mode and roles when no role source is registered", async () => {
    const { paseo, workspaceCreate } = fakePaseo(root);
    setRoles(builtInRoles());
    await expect(startWork(paseo, preferences.schema.parse({}), { projectId: "p1", ref: target, mode: "workspace", roleId: "design-engineer" }))
      .rejects.toThrow(/choose agent mode/);
    setRoles(null);
    await expect(startWork(paseo, preferences.schema.parse({}), { projectId: "p1", ref: target, mode: "agent", roleId: "design-engineer" }))
      .rejects.toThrow(/not registered/);
    expect(workspaceCreate).not.toHaveBeenCalled();
  });
});

describe("role settings registration", () => {
  it("registers settings, list, catalog and resolve handlers and resolves through the shared validator", async () => {
    const handlers = new Map<string, (input: any, context: any) => Promise<any>>();
    const registered: unknown[] = [];
    const server: any = {
      registerSettings: (definition: unknown) => { registered.push(definition); return { read: async () => ({ status: "ready", revision: "7", values: { roles: builtInRoles() } }) }; },
      handle: (contract: { name: string }, handler: (input: any, context: any) => Promise<any>) => handlers.set(contract.name, handler),
    };
    const dispose = registerAgentRoles(server, { readPreferences: async () => preferences.schema.parse({}) });
    expect(registered).toEqual([agentRolesSettings]);
    const { paseo } = fakePaseo(root, { usedPct: 3 });
    const listed = await handlers.get("clips.agent-roles.list")!({}, { paseo });
    expect(listed).toMatchObject({ revision: "7", builtInIds: expect.arrayContaining(["design-engineer"]) });
    const resolved = await handlers.get("clips.agent-roles.resolve")!({
      roleId: "design-engineer", workPrompt: "WORK", approveMetered: false,
    }, { paseo });
    expect(resolved).toMatchObject({ source: "candidate", config: { provider: "claude/claude-sonnet-5-5" } });
    expect(resolved.config.systemPrompt).toContain("[Lanes role: design-engineer r1]");
    expect(resolved.prompt).toBe("WORK");
    const catalogOut = await handlers.get("clips.agent-roles.catalog")!({}, { paseo });
    expect(catalogOut.providers[0].models.map((m: { agent: string }) => m.agent)).toContain("claude/claude-sonnet-5-5");
    dispose();
  });
});

describe("CLI role launches", () => {
  function cliClient(): any {
    return {
      projects: { list: async () => ({ projects: [{ projectId: "p1", projectKind: "git", projectRootPath: root }] }) },
      workspaces: { list: async () => ({ entries: [], pageInfo: { hasMore: false } }) },
      agents: { list: async () => ({ entries: [], pageInfo: { hasMore: false } }) },
      providers: { snapshot: async () => catalog(), listModes: async () => ({ modes }), listFeatures: async () => ({ features: [] }) },
    };
  }
  const resolution = {
    role: { id: "fast-implementation", name: "Fast Implementation", revision: 1 },
    source: "candidate", selectedIndex: 0,
    config: { provider: "claude/claude-haiku-5-5", modeId: "full-access", thinkingOptionId: "medium", featureValues: {} },
    prompt: null,
    composition: { instructions: true, skills: [], marker: "[Lanes role: fast-implementation r1]", delivery: "system_prompt" },
    attempts: [{ index: 0, agent: "claude/claude-haiku-5-5", code: "selected", message: "ok", usage: null }],
    quota: { maxUsagePct: 95, maxAgeMinutes: 30, whenUnknown: "allow" },
  };

  it("dry-run resolves through the plugin RPC with the manifest plugin ID and reports the resolution without creating anything", async () => {
    process.env.LANES_HOME = path.join(root, "home");
    const invokePluginRpc = vi.fn(async (_plugin: string, _method: string, input: { workPrompt: string }) => ({
      ...resolution,
      config: { ...resolution.config, systemPrompt: "[Lanes role: fast-implementation r1] Fast Implementation" },
      prompt: input.workPrompt,
    }));
    const driver = { invokePluginRpc };
    const plan = await start(cliClient(), { project: root, ref: target, role: "fast-implementation", "dry-run": true, features: [], "approve-metered": true }, driver);
    expect(invokePluginRpc).toHaveBeenCalledWith(pluginManifestId, "clips.agent-roles.resolve", expect.objectContaining({
      roleId: "fast-implementation", projectId: "p1", approveMetered: true,
    }));
    expect(plan).toMatchObject({
      action: "create-worktree-and-agent",
      config: { provider: "claude/claude-haiku-5-5", systemPrompt: "[Lanes role: fast-implementation r1] Fast Implementation" },
      role: { id: "fast-implementation", source: "candidate", selectedIndex: 0, composition: { marker: "[Lanes role: fast-implementation r1]", delivery: "system_prompt" } },
    });
    expect(plan.prompt).toBe(workPrompt);
  });

  it("honors an explicit --plugin-id and passes manual --provider as the override", async () => {
    const invokePluginRpc = vi.fn(async () => resolution);
    await start(cliClient(), {
      project: root, ref: target, role: "fast-implementation", provider: "claude/claude-haiku-5-5",
      thinking: "high", mode: "full-access", features: [], "dry-run": true, "plugin-id": "custom-plugin",
    }, { invokePluginRpc });
    expect(invokePluginRpc).toHaveBeenCalledWith("custom-plugin", "clips.agent-roles.resolve", expect.objectContaining({
      agentConfig: { provider: "claude/claude-haiku-5-5", thinkingOptionId: "high", modeId: "full-access", featureValues: {} },
    }));
  });

  it("rejects --speed with --role before any RPC", async () => {
    const invokePluginRpc = vi.fn();
    await expect(start(cliClient(), { project: root, ref: target, role: "fast-implementation", speed: "fast", features: [], "dry-run": true }, { invokePluginRpc }))
      .rejects.toThrow(/--speed is not supported/);
    expect(invokePluginRpc).not.toHaveBeenCalled();
  });
});
