import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  composeRoleTitle, defaultLaneEnvironmentSettings, enforceRoleTitle, laneEnvironmentSettings, topicOf,
  MAX_AGENT_TITLE_CHARS, type LaneEnvironmentSettings,
} from "../shared/lane-environment";
import { createLaneEnvironment, effectiveActivation, CONTINUATION_TTL_MS, PENDING_MANAGER_TTL_MS } from "./lane-environment";
import { createLaneEnvironmentStore, laneEnvironmentStateFile, StaleRevisionError, emptyEnvironmentState } from "./lane-environment-store";

type FakeAgent = {
  id: string; workspaceId: string | null; cwd: string | null; title: string | null; archivedAt: string | null; status: string | null;
  activeTurn: unknown | null; pendingPermissions: unknown[] | null;
  runtimeInfo: { provider: string; model?: string | null } | null;
};

function fakePaseo(options: { workspaces?: Record<string, string>; agents?: FakeAgent[]; createFails?: boolean; sendFails?: boolean } = {}) {
  const agents = new Map((options.agents ?? []).map((agent) => [agent.id, { ...agent }]));
  const workspaces = options.workspaces ?? { ws1: "/repo/one", ws2: "/repo/two" };
  const creates: { workspaceId: string; options: Record<string, unknown> }[] = [];
  const sent: { agentId: string; text: string }[] = [];
  let nextId = 1;
  const paseo = {
    workspaces: {
      list: async () => ({
        entries: Object.entries(workspaces).map(([id, dir]) => ({ id, workspaceDirectory: dir })),
        pageInfo: { hasMore: false, nextCursor: null },
      }),
      ref: (workspaceId: string) => ({
        agents: {
          create: async (createOptions: Record<string, unknown>) => {
            creates.push({ workspaceId, options: createOptions });
            if (options.createFails) throw new Error("create refused");
            const id = `new-${nextId++}`;
            const config = createOptions.config as { provider: string };
            agents.set(id, {
              id, workspaceId, cwd: workspaces[workspaceId] ?? null, title: (createOptions.title as string) ?? null, archivedAt: null, status: "idle",
              activeTurn: null, pendingPermissions: [], runtimeInfo: { provider: config.provider },
            });
            return { id };
          },
        },
      }),
    },
    agents: {
      ref: (agentId: string) => ({
        refresh: async () => (agents.has(agentId) ? { agent: agents.get(agentId) } : null),
        send: async (text: string) => {
          if (options.sendFails) throw new Error("send refused");
          sent.push({ agentId, text });
        },
      }),
    },
  };
  return { paseo: paseo as unknown as PaseoApi, creates, sent, agents };
}

function titleCli(agents: Map<string, FakeAgent>, options: { staleInspectAfterUpdate?: boolean; unavailable?: boolean; wrongCwd?: boolean; failUpdateId?: string } = {}) {
  const calls: string[][] = [];
  let staleInspect = false;
  const run = async (args: readonly string[]) => {
    const command = [...args];
    calls.push(command);
    if (options.unavailable) throw new Error("spawn paseo ENOENT");
    if (command[0] === "ls" && command[1] === "--global") {
      return JSON.stringify([...agents.values()].map((agent) => ({
        id: agent.id, name: agent.title, cwd: options.wrongCwd && agent.id === "m1" ? "/repo/two" : agent.cwd,
      })));
    }
    if (command[0] === "inspect") {
      const agent = agents.get(command[1]);
      if (!agent) throw new Error(`unknown agent ${command[1]}`);
      let name = agent.title;
      if (staleInspect && options.staleInspectAfterUpdate) {
        staleInspect = false;
        name = "🧭 Ship it";
      }
      return JSON.stringify({ Id: agent.id, Name: name, Cwd: options.wrongCwd && agent.id === "m1" ? "/repo/two" : agent.cwd });
    }
    if (command[0] === "agent" && command[1] === "update") {
      const agent = agents.get(command[2]);
      if (!agent) throw new Error(`unknown agent ${command[2]}`);
      if (command[2] === options.failUpdateId) throw new Error(`update refused for ${command[2]}`);
      agent.title = command[4];
      if (options.staleInspectAfterUpdate && command[4]?.startsWith("[former Lane Manager]")) staleInspect = true;
      return JSON.stringify({ Id: agent.id, Name: agent.title, Cwd: agent.cwd });
    }
    throw new Error(`unexpected Paseo CLI call: ${command.join(" ")}`);
  };
  return { run, calls };
}

describe("lane environment titles", () => {
  const settings = defaultLaneEnvironmentSettings();

  it("composes emoji and role-name titles and strips known prefixes", () => {
    expect(composeRoleTitle("lane-manager", "Ship it", settings)).toBe("🧭 Ship it");
    expect(composeRoleTitle("lane-dev", "Ship it", settings)).toBe("⚡ Ship it");
    expect(composeRoleTitle("design-engineer", "Ship it", settings)).toBe("👾 Ship it");
    const roleNames = laneEnvironmentSettings.parse({ titleMode: "role-name" });
    expect(composeRoleTitle("lane-manager", "Ship it", roleNames)).toBe("Lane Manager: Ship it");
    expect(topicOf("🧭 Lane Manager: Ship it")).toBe("Ship it");
    expect(topicOf("[former Lane Manager] 🧭 Ship it")).toBe("Ship it");
  });

  it("enforces titles idempotently without touching the topic", () => {
    const first = enforceRoleTitle("Ship it", "lane-manager", settings, "Lane");
    expect(first).toEqual({ title: "🧭 Ship it", changed: true });
    const second = enforceRoleTitle(first.title, "lane-manager", settings, "Lane");
    expect(second).toEqual({ title: "🧭 Ship it", changed: false });
  });

  it("uses the fallback topic and trims over-long titles", () => {
    expect(enforceRoleTitle(null, "lane-dev", settings, "Fallback").title).toBe("⚡ Fallback");
    const long = composeRoleTitle("lane-dev", "x".repeat(500), settings);
    expect(long.length).toBeLessThanOrEqual(MAX_AGENT_TITLE_CHARS);
  });

  it("validates custom emoji and rejects empty ones", () => {
    expect(laneEnvironmentSettings.safeParse({ roleEmojis: { "lane-manager": "" } }).success).toBe(false);
    const custom = laneEnvironmentSettings.parse({ roleEmojis: { "lane-manager": "★", "lane-dev": "⚡", "design-engineer": "👾" } });
    expect(composeRoleTitle("lane-manager", "Topic", custom)).toBe("★ Topic");
    expect(topicOf("★ Topic", custom)).toBe("Topic");
  });
});

describe("lane environment store", () => {
  let dir: string;
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), "lane-env-")); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it("persists mutations atomically and bumps the revision once per change", async () => {
    const store = createLaneEnvironmentStore(path.join(dir, "paseo", "state.json"));
    expect((await store.read()).revision).toBe(0);
    const first = await store.mutate(undefined, (state) => { state.workspaces.a = { defaultActivated: true, managerId: null, pendingManager: null, continuation: null, demoted: [] }; });
    expect(first.storeRevision).toBe(1);
    const unchanged = await store.mutate(undefined, () => undefined);
    expect(unchanged.storeRevision).toBe(1);
    const reread = JSON.parse(await fs.readFile(path.join(dir, "paseo", "state.json"), "utf8"));
    expect(reread.revision).toBe(1);
    expect(reread.workspaces.a.defaultActivated).toBe(true);
  });

  it("rejects stale expected revisions without writing", async () => {
    const store = createLaneEnvironmentStore(path.join(dir, "state.json"));
    await store.mutate(undefined, (state) => { state.workspaces.a = { defaultActivated: true, managerId: null, pendingManager: null, continuation: null, demoted: [] }; });
    await expect(store.mutate(0, () => undefined)).rejects.toBeInstanceOf(StaleRevisionError);
  });

  it("serializes concurrent mutations so none are lost", async () => {
    const store = createLaneEnvironmentStore(path.join(dir, "state.json"));
    await Promise.all(Array.from({ length: 20 }, (_, index) => store.mutate(undefined, (state) => {
      state.workspaces[`w${index}`] = { defaultActivated: true, managerId: null, pendingManager: null, continuation: null, demoted: [] };
    })));
    const state = await store.read();
    expect(Object.keys(state.workspaces)).toHaveLength(20);
    expect(state.revision).toBe(20);
  });

  it("refuses to overwrite an unknown store version", async () => {
    const file = path.join(dir, "state.json");
    await fs.writeFile(file, JSON.stringify({ version: 2, revision: 9, workspaces: {} }));
    const store = createLaneEnvironmentStore(file);
    await expect(store.read()).rejects.toThrow(/not a version 1 store/);
    await expect(store.mutate(undefined, () => undefined)).rejects.toThrow(/not a version 1 store/);
  });

  it("uses the documented Lanes home override order for its state file", () => {
    expect(laneEnvironmentStateFile({ LANES_HOME: "/x/lanes", CLIPS_HOME: "/x/clips" } as NodeJS.ProcessEnv)).toBe("/x/lanes/paseo/lane-environment.json");
    expect(laneEnvironmentStateFile({ CLIPS_HOME: "/x/clips" } as NodeJS.ProcessEnv)).toBe("/x/clips/paseo/lane-environment.json");
    expect(emptyEnvironmentState().revision).toBe(0);
  });
});

describe("activation", () => {
  it("prefers explicit host settings over the default for new workspaces", () => {
    const settings = laneEnvironmentSettings.parse({ workspaces: { ws1: { enabled: false } } });
    expect(effectiveActivation(settings, "ws1", { defaultActivated: true, managerId: null, pendingManager: null, continuation: null, demoted: [] }))
      .toEqual({ enabled: false, source: "explicit" });
    expect(effectiveActivation(settings, "ws2", { defaultActivated: true, managerId: null, pendingManager: null, continuation: null, demoted: [] }))
      .toEqual({ enabled: true, source: "default" });
    expect(effectiveActivation(settings, "ws3", undefined)).toEqual({ enabled: false, source: "none" });
  });
});

describe("lane environment lifecycle", () => {
  let dir: string;
  let warnings: string[];
  let now: number;
  let counter: number;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lane-env-life-"));
    warnings = [];
    now = 1_000_000;
    counter = 0;
  });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  function service(
    settingsOverrides: Partial<LaneEnvironmentSettings> = {},
    storeFile = path.join(dir, "state.json"),
    runPaseoCli: (args: readonly string[]) => Promise<string> = async () => { throw new Error("test Paseo CLI unavailable"); },
    guidance?: string,
  ) {
    const current = laneEnvironmentSettings.parse({ ...settingsOverrides });
    return createLaneEnvironment({
      store: createLaneEnvironmentStore(storeFile),
      settings: async () => current,
      managerSystemPrompt: async ({ systemPrompt }) => systemPrompt ?? guidance,
      runPaseoCli,
      now: () => now,
      randomId: () => `req-${++counter}`,
      warn: (message) => warnings.push(message),
    });
  }

  const createRequest = (cwd: string, title: string | null = "Ship it") => ({ config: { cwd, title, provider: "claude/sonnet" } });

  it("activates new workspaces by default without adopting existing ones", async () => {
    const env = service();
    await env.onWorkspaceCreated({ id: "ws1" });
    const status = await env.status("ws1");
    expect(status.workspace).toMatchObject({ enabled: true, enabledSource: "default", managerId: null });
    const untouched = await env.status("ws-existing");
    expect(untouched.workspace).toMatchObject({ enabled: false, enabledSource: "none" });
  });

  it("does not activate new workspaces when the default is off", async () => {
    const env = service({ activateNewWorkspaces: false });
    await env.onWorkspaceCreated({ id: "ws1" });
    expect((await env.status("ws1")).workspace.enabled).toBe(false);
  });

  it("explicit disable overrides default activation", async () => {
    const env = service({ workspaces: { ws1: { enabled: false } } });
    await env.onWorkspaceCreated({ id: "ws1" });
    expect((await env.status("ws1")).workspace).toMatchObject({ enabled: false, enabledSource: "explicit" });
  });

  it("claims the first agent as manager with a manager title and confirms it on creation", async () => {
    const env = service();
    const { paseo } = fakePaseo();
    await env.onWorkspaceCreated({ id: "ws1" });
    const request = await env.beforeAgentCreate(createRequest("/repo/one"), paseo);
    expect(request?.config.title).toBe("🧭 Ship it");
    expect((await env.status("ws1")).workspace.pendingManager).toMatchObject({ title: "🧭 Ship it", agentId: null });
    await env.onAgentCreated({ id: "agent-a", workspaceId: "ws1", title: "🧭 Ship it" });
    expect((await env.status("ws1")).workspace).toMatchObject({ managerId: "agent-a", pendingManager: null });
  });

  it("elects exactly one manager among simultaneous creates", async () => {
    const env = service();
    const { paseo } = fakePaseo();
    await env.onWorkspaceCreated({ id: "ws1" });
    const results = await Promise.all(Array.from({ length: 5 }, () => env.beforeAgentCreate(createRequest("/repo/one"), paseo)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((result) => result?.config.title === "🧭 Ship it")).toHaveLength(1);
  });

  it("does not claim for disabled workspaces, the internal agents or when the manager feature is off", async () => {
    const { paseo } = fakePaseo();
    const disabled = service({ workspaces: { ws1: { enabled: false } } });
    await disabled.onWorkspaceCreated({ id: "ws1" });
    expect(await disabled.beforeAgentCreate(createRequest("/repo/one"), paseo)).toBeUndefined();

    const off = service({ firstAgentManager: false });
    await off.onWorkspaceCreated({ id: "ws1" });
    expect(await off.beforeAgentCreate(createRequest("/repo/one"), paseo)).toBeUndefined();

    const internal = service();
    await internal.onWorkspaceCreated({ id: "ws1" });
    const request = { config: { ...createRequest("/repo/one").config, internal: true } };
    expect(await internal.beforeAgentCreate(request, paseo)).toBeUndefined();
  });

  it("does not claim when the directory matches no workspace", async () => {
    const env = service();
    await env.onWorkspaceCreated({ id: "ws1" });
    expect(await env.beforeAgentCreate(createRequest("/elsewhere"), fakePaseo().paseo)).toBeUndefined();
  });

  it("does not let a non-matching agent confirm the pending claim", async () => {
    const env = service();
    const { paseo } = fakePaseo();
    await env.onWorkspaceCreated({ id: "ws1" });
    await env.beforeAgentCreate(createRequest("/repo/one"), paseo);
    await env.onAgentCreated({ id: "user-agent", workspaceId: "ws1", title: "Something else" });
    expect((await env.status("ws1")).workspace).toMatchObject({ managerId: null });
    expect((await env.status("ws1")).workspace.pendingManager).not.toBeNull();
  });

  it("blocks a second claim while the first is pending and allows one after the TTL", async () => {
    const env = service();
    const { paseo } = fakePaseo();
    await env.onWorkspaceCreated({ id: "ws1" });
    expect(await env.beforeAgentCreate(createRequest("/repo/one"), paseo)).toBeDefined();
    expect(await env.beforeAgentCreate(createRequest("/repo/one"), paseo)).toBeUndefined();
    now += PENDING_MANAGER_TTL_MS + 1;
    expect(await env.beforeAgentCreate(createRequest("/repo/one"), paseo)).toBeDefined();
  });

  it("fails open with a warning when the store cannot be read", async () => {
    const file = path.join(dir, "bad.json");
    await fs.writeFile(file, JSON.stringify({ version: 9, revision: 0, workspaces: {} }));
    const env = service({}, file);
    const result = await env.beforeAgentCreate(createRequest("/repo/one"), fakePaseo().paseo);
    expect(result).toBeUndefined();
    expect(warnings.join("\n")).toMatch(/manager election skipped/);
  });

  it("assigns an explicit manager in the same workspace, demotes the previous one and reports the title limit", async () => {
    const agents: FakeAgent[] = [
      { id: "a1", workspaceId: "ws1", cwd: "/repo/one", title: "🧭 Old", archivedAt: null, status: "idle", activeTurn: null, pendingPermissions: [], runtimeInfo: { provider: "claude" } },
      { id: "a2", workspaceId: "ws1", cwd: "/repo/one", title: "Working on login", archivedAt: null, status: "idle", activeTurn: null, pendingPermissions: [], runtimeInfo: { provider: "claude" } },
    ];
    const fake = fakePaseo({ agents });
    const cli = titleCli(fake.agents);
    const env = service({}, path.join(dir, "state.json"), cli.run);
    await env.onWorkspaceCreated({ id: "ws1" });
    await env.onAgentCreated({ id: "a1", workspaceId: "ws1", title: null });
    await env.beforeAgentCreate(createRequest("/repo/one"), fake.paseo);
    await env.onAgentCreated({ id: "a1", workspaceId: "ws1", title: "🧭 Ship it" });
    fake.agents.get("a1")!.title = "🧭 Ship it";
    const result = await env.assignManager(fake.paseo, { workspaceId: "ws1", agentId: "a2" });
    expect(result.assignmentApplied).toBe(true);
    expect(result.titleApplied).toBe(true);
    expect(result.advisoryTitle).toBe("🧭 Working on login");
    expect(result.formerManagerTitleApplied).toBe(true);
    expect(result.formerManagerAdvisoryTitle).toBe("[former Lane Manager] Ship it");
    expect(fake.agents.get("a2")?.title).toBe("🧭 Working on login");
    expect(fake.agents.get("a1")?.title).toBe("[former Lane Manager] Ship it");
    expect(result.workspace).toMatchObject({ managerId: "a2" });
    expect(result.workspace.demoted.map((entry) => entry.agentId)).toEqual(["a1"]);
  });

  it("sends the Lane Manager guidance to the promoted running session", async () => {
    const fake = fakePaseo({ agents: [
      { id: "candidate", workspaceId: "ws1", cwd: "/repo/one", title: "Work on login", archivedAt: null, status: "idle", activeTurn: null, pendingPermissions: [], runtimeInfo: null },
    ] });
    const env = service({}, path.join(dir, "state.json"), titleCli(fake.agents).run, "ROLE GUIDANCE");
    const result = await env.assignManager(fake.paseo, { workspaceId: "ws1", agentId: "candidate" });
    expect(result).toMatchObject({ assignmentApplied: true, guidanceDelivered: true, guidanceError: null });
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]).toMatchObject({ agentId: "candidate", text: "/lane-manager Proceed as the lane manager" });
  });

  it("keeps the assignment and reports it when the guidance cannot be delivered", async () => {
    const fake = fakePaseo({ sendFails: true, agents: [
      { id: "candidate", workspaceId: "ws1", cwd: "/repo/one", title: "Work on login", archivedAt: null, status: "idle", activeTurn: null, pendingPermissions: [], runtimeInfo: null },
    ] });
    const env = service({}, path.join(dir, "state.json"), titleCli(fake.agents).run, "ROLE GUIDANCE");
    const result = await env.assignManager(fake.paseo, { workspaceId: "ws1", agentId: "candidate" });
    expect(result).toMatchObject({ assignmentApplied: true, guidanceDelivered: false });
    expect(result.guidanceError).toContain("Lane Manager guidance was not delivered");
    expect(result.workspace.managerId).toBe("candidate");
  });

  it("applies the manager title when assigning into a workspace with no previous manager", async () => {
    const fake = fakePaseo({ agents: [
      { id: "candidate", workspaceId: "ws1", cwd: "/repo/one", title: "Work on login", archivedAt: null, status: "idle", activeTurn: null, pendingPermissions: [], runtimeInfo: null },
    ] });
    const cli = titleCli(fake.agents);
    const env = service({}, path.join(dir, "state.json"), cli.run);
    await env.onWorkspaceCreated({ id: "ws1" });
    const result = await env.assignManager(fake.paseo, { workspaceId: "ws1", agentId: "candidate" });
    expect(result).toMatchObject({
      assignmentApplied: true,
      titleApplied: true,
      titleError: null,
      advisoryTitle: "🧭 Work on login",
      formerManagerTitleApplied: null,
      formerManagerTitleError: null,
      formerManagerAdvisoryTitle: null,
    });
    expect(fake.agents.get("candidate")?.title).toBe("🧭 Work on login");
  });

  it("restores the selected manager title when the former-manager title update fails", async () => {
    const fake = fakePaseo({ agents: [
      { id: "old", workspaceId: "ws1", cwd: "/repo/one", title: "🧭 Existing", archivedAt: null, status: "idle", activeTurn: null, pendingPermissions: [], runtimeInfo: null },
      { id: "candidate", workspaceId: "ws1", cwd: "/repo/one", title: "Work on login", archivedAt: null, status: "idle", activeTurn: null, pendingPermissions: [], runtimeInfo: null },
    ] });
    const cli = titleCli(fake.agents, { failUpdateId: "old" });
    const file = path.join(dir, "state.json");
    const env = service({}, file, cli.run);
    await env.onWorkspaceCreated({ id: "ws1" });
    await createLaneEnvironmentStore(file).mutate(undefined, (state) => { state.workspaces.ws1.managerId = "old"; });
    const result = await env.assignManager(fake.paseo, { workspaceId: "ws1", agentId: "candidate" });
    expect(result.assignmentApplied).toBe(false);
    expect(result.assignmentError).toMatch(/Former-manager title failed/);
    expect(result.titleApplied).toBe(false);
    expect(result.formerManagerTitleApplied).toBe(false);
    expect(result.workspace.managerId).toBe("old");
    expect(fake.agents.get("candidate")?.title).toBe("Work on login");
    expect(fake.agents.get("old")?.title).toBe("🧭 Existing");
  });

  it("does not commit an assignment when the selected manager title cannot be verified", async () => {
    const fake = fakePaseo({ agents: [
      { id: "candidate", workspaceId: "ws1", cwd: "/repo/one", title: "Work on login", archivedAt: null, status: "idle", activeTurn: null, pendingPermissions: [], runtimeInfo: null },
    ] });
    const cli = titleCli(fake.agents, { unavailable: true });
    const env = service({}, path.join(dir, "state.json"), cli.run);
    await env.onWorkspaceCreated({ id: "ws1" });
    const result = await env.assignManager(fake.paseo, { workspaceId: "ws1", agentId: "candidate" });
    expect(result.assignmentApplied).toBe(false);
    expect(result.titleApplied).toBe(false);
    expect(result.titleError).toMatch(/spawn paseo ENOENT/);
    expect(result.workspace.managerId).toBeNull();
    expect(fake.agents.get("candidate")?.title).toBe("Work on login");
  });

  it("restores the selected title when revision-checked manager assignment cannot commit", async () => {
    const fake = fakePaseo({ agents: [
      { id: "candidate", workspaceId: "ws1", cwd: "/repo/one", title: "Work on login", archivedAt: null, status: "idle", activeTurn: null, pendingPermissions: [], runtimeInfo: null },
    ] });
    const file = path.join(dir, "state.json");
    const competitor = createLaneEnvironmentStore(file);
    const cli = titleCli(fake.agents);
    let wroteCompetingRevision = false;
    const runCli = async (args: readonly string[]) => {
      const output = await cli.run(args);
      if (!wroteCompetingRevision && args[0] === "agent" && args[1] === "update") {
        wroteCompetingRevision = true;
        await competitor.mutate(undefined, (state) => { state.workspaces.ws1.demoted.push({ agentId: "concurrent", demotedAt: now }); });
      }
      return output;
    };
    const env = service({}, file, runCli);
    await env.onWorkspaceCreated({ id: "ws1" });
    const result = await env.assignManager(fake.paseo, { workspaceId: "ws1", agentId: "candidate" });
    expect(result.assignmentApplied).toBe(false);
    expect(result.assignmentError).toMatch(/revision/);
    expect(result.titleApplied).toBe(false);
    expect(result.titleError).toMatch(/title was restored/);
    expect(result.workspace.managerId).toBeNull();
    expect(fake.agents.get("candidate")?.title).toBe("Work on login");
  });

  it("restores both manager titles when succession title writes race with a store revision", async () => {
    const fake = fakePaseo({ agents: [
      { id: "old", workspaceId: "ws1", cwd: "/repo/one", title: "🧭 Existing topic", archivedAt: null, status: "idle", activeTurn: null, pendingPermissions: [], runtimeInfo: null },
      { id: "candidate", workspaceId: "ws1", cwd: "/repo/one", title: "Work on login", archivedAt: null, status: "idle", activeTurn: null, pendingPermissions: [], runtimeInfo: null },
    ] });
    const file = path.join(dir, "state.json");
    const competitor = createLaneEnvironmentStore(file);
    const cli = titleCli(fake.agents);
    let wroteCompetingRevision = false;
    const runCli = async (args: readonly string[]) => {
      const output = await cli.run(args);
      if (!wroteCompetingRevision && args[0] === "agent" && args[1] === "update") {
        wroteCompetingRevision = true;
        await competitor.mutate(undefined, (state) => { state.workspaces.ws1.demoted.push({ agentId: "concurrent", demotedAt: now }); });
      }
      return output;
    };
    const env = service({}, file, runCli);
    await env.onWorkspaceCreated({ id: "ws1" });
    await competitor.mutate(undefined, (state) => { state.workspaces.ws1.managerId = "old"; });
    const result = await env.assignManager(fake.paseo, { workspaceId: "ws1", agentId: "candidate" });
    expect(result.assignmentApplied).toBe(false);
    expect(result.assignmentError).toMatch(/revision/);
    expect(result.titleApplied).toBe(false);
    expect(result.formerManagerTitleApplied).toBe(false);
    expect(fake.agents.get("candidate")?.title).toBe("Work on login");
    expect(fake.agents.get("old")?.title).toBe("🧭 Existing topic");
    expect((await env.status("ws1")).workspace.managerId).toBe("old");
  });

  it("rejects assignment across workspaces, archived agents and unknown agents", async () => {
    const agents: FakeAgent[] = [
      { id: "other", workspaceId: "ws2", cwd: "/repo/two", title: null, archivedAt: null, status: "idle", activeTurn: null, pendingPermissions: [], runtimeInfo: null },
      { id: "gone", workspaceId: "ws1", cwd: "/repo/one", title: null, archivedAt: "2026-10-31T00:00:00Z", status: "idle", activeTurn: null, pendingPermissions: [], runtimeInfo: null },
    ];
    const { paseo } = fakePaseo({ agents });
    const env = service();
    await expect(env.assignManager(paseo, { workspaceId: "ws1", agentId: "other" })).rejects.toThrow(/not in workspace/);
    await expect(env.assignManager(paseo, { workspaceId: "ws1", agentId: "gone" })).rejects.toThrow(/archived/);
    await expect(env.assignManager(paseo, { workspaceId: "ws1", agentId: "missing" })).rejects.toThrow(/not found/);
  });

  it("rejects stale assignment revisions without changing the workspace", async () => {
    const agents: FakeAgent[] = [{ id: "a2", workspaceId: "ws1", cwd: "/repo/one", title: null, archivedAt: null, status: "idle", activeTurn: null, pendingPermissions: [], runtimeInfo: null }];
    const { paseo } = fakePaseo({ agents });
    const env = service();
    await env.onWorkspaceCreated({ id: "ws1" });
    await expect(env.assignManager(paseo, { workspaceId: "ws1", agentId: "a2", expectedRevision: 99 })).rejects.toThrow(/changed/);
    expect((await env.status("ws1")).workspace.managerId).toBeNull();
  });

  describe("continuation", () => {
    const manager: FakeAgent = {
      id: "m1", workspaceId: "ws1", cwd: "/repo/one", title: "🧭 Ship it", archivedAt: null, status: "idle", activeTurn: null,
      pendingPermissions: [], runtimeInfo: { provider: "claude", model: "sonnet" },
    };
    async function withManager(
      agents: FakeAgent[] = [manager], createFails = false, sendFails = false,
      runPaseoCli?: (args: readonly string[]) => Promise<string>,
    ) {
      const fake = fakePaseo({ agents, createFails, sendFails });
      const env = service({}, path.join(dir, "state.json"), runPaseoCli ?? titleCli(fake.agents).run);
      await env.onWorkspaceCreated({ id: "ws1" });
      await env.assignManager(fake.paseo, { workspaceId: "ws1", agentId: "m1" });
      return { env, ...fake };
    }

    it("creates a new session with the checkpoint, promotes it and demotes the old manager", async () => {
      const { env, paseo, creates, sent } = await withManager();
      const result = await env.continueManager(paseo, { workspaceId: "ws1", fromAgentId: "m1", checkpoint: "Decisions: X" });
      expect(creates).toHaveLength(1);
      expect(creates[0].workspaceId).toBe("ws1");
      expect(creates[0].options).toMatchObject({ idempotencyKey: "req-1", config: { provider: "claude/sonnet" }, title: "🧭 Ship it" });
      expect(String(creates[0].options.prompt)).toContain("Decisions: X");
      expect(result.newAgentId).toBe("new-1");
      expect(result.workspace).toMatchObject({ managerId: "new-1", continuation: null });
      expect(result.workspace.demoted.map((entry) => entry.agentId)).toEqual(["m1"]);
      expect(result.demotionNotice).toBe("sent");
      expect(result.titleApplied).toBe(true);
      expect(result.titleError).toBeNull();
      expect(sent[0].agentId).toBe("m1");
      expect(result.limitations.join(" ")).toMatch(/not a native fork/);
    });

    it("renames the previous manager only after CLI and SDK identity readback agree", async () => {
      const fake = fakePaseo({ agents: [manager] });
      const cli = titleCli(fake.agents);
      const env = service({}, path.join(dir, "state.json"), cli.run);
      await env.onWorkspaceCreated({ id: "ws1" });
      await env.assignManager(fake.paseo, { workspaceId: "ws1", agentId: "m1" });
      const result = await env.continueManager(fake.paseo, { workspaceId: "ws1", fromAgentId: "m1", checkpoint: "Decisions: X" });
      expect(result).toMatchObject({ titleApplied: true, titleError: null, advisoryTitle: "[former Lane Manager] Ship it" });
      expect(fake.agents.get("m1")?.title).toBe("[former Lane Manager] Ship it");
      expect(cli.calls).toContainEqual(["agent", "update", "m1", "--name", "[former Lane Manager] Ship it", "--json"]);
      expect(cli.calls).toContainEqual(["inspect", "m1", "--json"]);
      expect(cli.calls).toContainEqual(["ls", "--global", "--json"]);
    });

    it("renames a demoted manager on explicit assignment", async () => {
      const agents: FakeAgent[] = [
        manager,
        { ...manager, id: "m2", title: "Work on login" },
      ];
      const fake = fakePaseo({ agents });
      const cli = titleCli(fake.agents);
      const env = service({}, path.join(dir, "state.json"), cli.run);
      await env.onWorkspaceCreated({ id: "ws1" });
      await env.assignManager(fake.paseo, { workspaceId: "ws1", agentId: "m1" });
      const result = await env.assignManager(fake.paseo, { workspaceId: "ws1", agentId: "m2" });
      expect(result).toMatchObject({
        formerManagerTitleApplied: true,
        formerManagerTitleError: null,
        formerManagerAdvisoryTitle: "[former Lane Manager] Ship it",
      });
      expect(fake.agents.get("m1")?.title).toBe("[former Lane Manager] Ship it");
    });

    it("reports a transient readback mismatch and rolls back the old title", async () => {
      const fake = fakePaseo({ agents: [manager] });
      const cli = titleCli(fake.agents, { staleInspectAfterUpdate: true });
      const env = service({}, path.join(dir, "state.json"), cli.run);
      await env.onWorkspaceCreated({ id: "ws1" });
      await env.assignManager(fake.paseo, { workspaceId: "ws1", agentId: "m1" });
      const result = await env.continueManager(fake.paseo, { workspaceId: "ws1", fromAgentId: "m1", checkpoint: "Decisions: X" });
      expect(result.titleApplied).toBe(false);
      expect(result.titleError).toMatch(/readback mismatched; the original title was restored/);
      expect(fake.agents.get("m1")?.title).toBe("🧭 Ship it");
      expect(cli.calls).toContainEqual(["agent", "update", "m1", "--name", "🧭 Ship it", "--json"]);
    });

    it("fails closed when the CLI is missing and performs no rename", async () => {
      const fake = fakePaseo({ agents: [manager] });
      const cli = titleCli(fake.agents, { unavailable: true });
      const env = service({}, path.join(dir, "state.json"), cli.run);
      await env.onWorkspaceCreated({ id: "ws1" });
      await createLaneEnvironmentStore(path.join(dir, "state.json")).mutate(undefined, (state) => { state.workspaces.ws1.managerId = "m1"; });
      const result = await env.continueManager(fake.paseo, { workspaceId: "ws1", fromAgentId: "m1", checkpoint: "Decisions: X" });
      expect(result.titleApplied).toBe(false);
      expect(result.titleError).toMatch(/spawn paseo ENOENT/);
      expect(fake.agents.get("m1")?.title).toBe("🧭 Ship it");
      expect(cli.calls.some((args) => args[0] === "agent" && args[1] === "update")).toBe(false);
    });

    it("refuses a CLI target whose cwd does not match the SDK workspace agent", async () => {
      const fake = fakePaseo({ agents: [manager] });
      const cli = titleCli(fake.agents, { wrongCwd: true });
      const env = service({}, path.join(dir, "state.json"), cli.run);
      await env.onWorkspaceCreated({ id: "ws1" });
      await createLaneEnvironmentStore(path.join(dir, "state.json")).mutate(undefined, (state) => { state.workspaces.ws1.managerId = "m1"; });
      const result = await env.continueManager(fake.paseo, { workspaceId: "ws1", fromAgentId: "m1", checkpoint: "Decisions: X" });
      expect(result.titleApplied).toBe(false);
      expect(result.titleError).toMatch(/cwd does not match/);
      expect(fake.agents.get("m1")?.title).toBe("🧭 Ship it");
      expect(cli.calls.some((args) => args[0] === "agent" && args[1] === "update")).toBe(false);
    });

    it("refuses while the manager is running and does not create a session", async () => {
      const busy = { ...manager, status: "running" };
      const { env, paseo, creates } = await withManager([busy]);
      await expect(env.continueManager(paseo, { workspaceId: "ws1", fromAgentId: "m1", checkpoint: "x" })).rejects.toThrow(/still running/);
      expect(creates).toHaveLength(0);
    });

    it("refuses when the source is not the current manager", async () => {
      const { env, paseo } = await withManager([manager, { ...manager, id: "m2" }]);
      await expect(env.continueManager(paseo, { workspaceId: "ws1", fromAgentId: "m2", checkpoint: "x" })).rejects.toThrow(/not the current manager/);
    });

    it("refuses to switch providers when the provider is unknown", async () => {
      const unknown = { ...manager, runtimeInfo: null };
      const { env, paseo, creates } = await withManager([unknown]);
      await expect(env.continueManager(paseo, { workspaceId: "ws1", fromAgentId: "m1", checkpoint: "x" })).rejects.toThrow(/will not switch providers/);
      expect(creates).toHaveLength(0);
    });

    it("keeps the old manager and records failure when creation fails", async () => {
      const { env, paseo } = await withManager([manager], true);
      await expect(env.continueManager(paseo, { workspaceId: "ws1", fromAgentId: "m1", checkpoint: "x" })).rejects.toThrow(/create refused/);
      const status = await env.status("ws1");
      expect(status.workspace.managerId).toBe("m1");
      expect(status.workspace.continuation).toMatchObject({ status: "failed", fromAgentId: "m1" });
    });

    it("blocks a second continuation while one is fresh, and reuses the request id once stale", async () => {
      const fake = fakePaseo({ agents: [manager] });
      const env = service({}, path.join(dir, "state.json"), titleCli(fake.agents).run);
      await env.onWorkspaceCreated({ id: "ws1" });
      await env.assignManager(fake.paseo, { workspaceId: "ws1", agentId: "m1" });
      const store = createLaneEnvironmentStore(path.join(dir, "state.json"));
      await store.mutate(undefined, (state) => {
        state.workspaces.ws1.continuation = { requestId: "pending-1", fromAgentId: "m1", status: "creating", startedAt: now, error: null, toAgentId: null };
      });
      await expect(env.continueManager(fake.paseo, { workspaceId: "ws1", fromAgentId: "m1", checkpoint: "x" })).rejects.toThrow(/already creating/);
      now += CONTINUATION_TTL_MS + 1;
      await env.continueManager(fake.paseo, { workspaceId: "ws1", fromAgentId: "m1", checkpoint: "x" });
      expect(fake.creates[0].options.idempotencyKey).toBe("pending-1");
    });

    it("reports a failed demotion notice without undoing the promotion", async () => {
      const { env, paseo } = await withManager([manager], false, true);
      const result = await env.continueManager(paseo, { workspaceId: "ws1", fromAgentId: "m1", checkpoint: "x" });
      expect(result.demotionNotice).toBe("failed");
      expect(result.workspace.managerId).toBe(result.newAgentId);
      expect(warnings.join("\n")).toMatch(/Could not notify previous manager/);
    });

    it("does not elect a new first-agent manager while a continuation is creating", async () => {
      const { env, paseo } = await withManager();
      const store = createLaneEnvironmentStore(path.join(dir, "state.json"));
      await store.mutate(undefined, (state) => {
        state.workspaces.ws1.managerId = null;
        state.workspaces.ws1.continuation = { requestId: "c", fromAgentId: "m1", status: "creating", startedAt: now, error: null, toAgentId: null };
      });
      expect(await env.beforeAgentCreate(createRequest("/repo/one"), paseo)).toBeUndefined();
    });
  });
});

describe("settings schema", () => {
  it("parses defaults and per-workspace overrides", () => {
    expect(defaultLaneEnvironmentSettings()).toEqual({
      activateNewWorkspaces: true,
      firstAgentManager: true,
      titleMode: "emoji-topic",
      workspaces: {},
      roleEmojis: { "lane-manager": "🧭", "lane-dev": "⚡", "design-engineer": "👾" },
    });
    expect(laneEnvironmentSettings.parse({ workspaces: { w: { enabled: false } } }).workspaces.w).toEqual({ enabled: false });
    expect(laneEnvironmentSettings.safeParse({ titleMode: "other" }).success).toBe(false);
  });
});
