
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizeBoard, readProjectBoard, saveModelRoutingPolicy, setProjectCollaboration, startWork } from "./backend";
import { branchName } from "../shared/work";

describe("Lanes JSON board projection", () => {
  it("preserves Lane membership, namespaced Task refs, and acceptance criteria", () => {
    const data = normalizeBoard({
      lanes: [{ ref: "#l001", title: "Release quality", status: "open", description: "Frame", goal_refs: ["#alice#g001"] }],
      goals: [{
        ref: "#alice#g001", title: "Ship integration", status: "in_progress",
        lane_id: "l001", plan: "Implement then test",
        tasks: [{
          ref: "#alice#g001#t01", title: "Add UI", description: "Native surface",
          status: "open", acceptance_criteria: [{ id: "A1", description: "Renders correctly" }],
        }],
      }],
      warnings: [{ message: "Retained legacy record" }],
    });
    expect(data.lanes[0]).toMatchObject({
      kind: "lane", ref: "#l001", goalRefs: ["#alice#g001"],
    });
    expect(data.goals[0]).toMatchObject({
      kind: "goal", ref: "#alice#g001", laneId: "l001", plan: "Implement then test",
    });
    expect(data.goals[0].tasks[0]).toMatchObject({
      kind: "task", ref: "#alice#g001#t01",
      acceptanceCriteria: [{ id: "A1", description: "Renders correctly" }],
    });
    expect(data.warnings).toEqual(["Retained legacy record"]);
  });

  it("accepts sparse and legacy records without losing refs", () => {
    const data = normalizeBoard({
      lanes: [{ ref: "#l002" }],
      goals: [{ ref: "#g1", tasks: [{ ref: "#g1#t1", acceptance_criteria: ["Build succeeds"] }] }],
      warnings: [],
    });
    expect(data.goals[0].tasks[0].acceptanceCriteria[0].id).toBe("A1");
    expect(data.lanes[0].goalRefs).toEqual([]);
  });
});

it("reads a local Lanes project through the checkout CLI", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clips-paseo-board-"));
  const cli = fileURLToPath(new URL("../../../src/cli.js", import.meta.url));
  const previous = Object.fromEntries(["LANES_HOME", "CLIPS_HOME", "LANES_CLI_PATH", "CLIPS_CLI_PATH"].map(key => [key, process.env[key]]));
  process.env.LANES_HOME = path.join(root, "home");
  process.env.LANES_CLI_PATH = cli;
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    const runClips = (...args: string[]) => execFileSync(process.execPath, [cli, ...args], {
      cwd: root,
      env: { ...process.env, LANES_HOME: path.join(root, "home") },
    });
    runClips("init", "--skills-scope", "project");
    runClips("lane", "create", JSON.stringify({ title: "Local lane" }));
    runClips("goal", "create", JSON.stringify({ title: "Local goal", lane_id: "l1" }));
    runClips("task", "create", "g1", JSON.stringify({ title: "Local task" }));

    const paseo = {
      projects: { list: async () => ({ projects: [{
        projectId: "project-1", projectKind: "git", projectRootPath: root,
        projectDisplayName: "Fixture", projectCustomName: null,
      }] }) },
    } as Parameters<typeof readProjectBoard>[0];
    const board = await readProjectBoard(paseo, "project-1");
    expect(board.lanes).toMatchObject([{ ref: "#l001", title: "Local lane" }]);
    expect(board.goals).toMatchObject([{ ref: "#g001", title: "Local goal", tasks: [{ ref: "#g001#t01", title: "Local task" }] }]);
    expect(board.warnings).toEqual([]);

    const target = board.goals[0].tasks[0];
    const launchPaseo = {
      ...paseo,
      workspaces: { list: async () => ({ entries: [{
        id: "workspace-1", projectId: "project-1", title: "Existing work",
        gitRuntime: { currentBranch: branchName(target) }, status: "needs_input",
      }], pageInfo: { hasMore: false } }) },
      agents: { list: async () => ({ entries: [{ agent: {
        id: "agent-1", workspaceId: "workspace-1", status: "running",
        requiresAttention: true, attentionReason: "permission", labels: {}, title: "Pending agent",
      } }], pageInfo: { hasMore: false } }) },
    } as unknown as Parameters<typeof startWork>[0];
    for (const input of [
      { projectId: "project-1", ref: target.ref, mode: "agent" as const },
      { projectId: "project-1", ref: target.ref, mode: "workspace" as const },
      { projectId: "project-1", ref: target.ref, mode: "agent" as const, workspaceId: "another-workspace" },
    ]) {
      await expect(startWork(launchPaseo, { agent: "" }, input)).resolves.toMatchObject({
        workspaceId: "workspace-1", agentId: "agent-1", alreadyRunning: true,
      });
    }

    // A cross-workspace concurrent action must share the same record-level guard.
    const first = startWork(launchPaseo, { agent: "" }, {
      projectId: "project-1", ref: target.ref, mode: "agent", workspaceId: "another-workspace",
    });
    const second = startWork(launchPaseo, { agent: "" }, {
      projectId: "project-1", ref: target.ref, mode: "workspace",
    });
    const results = await Promise.allSettled([first, second]);
    expect(results.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((entry) => entry.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.message).toContain("already in progress");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

it("changes only the workspace repository's collaboration setting", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lanes-repository-collaboration-"));
  const cli = fileURLToPath(new URL("../../../src/cli.js", import.meta.url));
  const previous = Object.fromEntries(["LANES_HOME", "CLIPS_HOME", "LANES_CLI_PATH", "CLIPS_CLI_PATH"].map((key) => [key, process.env[key]]));
  process.env.LANES_HOME = path.join(root, "home");
  process.env.LANES_CLI_PATH = cli;
  try {
    const repositories = ["one", "two"].map((name) => {
      const dir = path.join(root, name);
      fs.mkdirSync(path.join(dir, ".lanes", "db"), { recursive: true });
      execFileSync("git", ["init", "--quiet"], { cwd: dir });
      execFileSync("git", ["remote", "add", "origin", `https://github.com/example/${name}.git`], { cwd: dir });
      fs.writeFileSync(path.join(dir, ".lanes", "lanes.config.json"), JSON.stringify({ collaboration: false }));
      return dir;
    });
    const paseo = { projects: { list: async () => ({ projects: repositories.map((dir, index) => ({
      projectId: `p${index}`, projectKind: "git", projectRootPath: dir, projectDisplayName: `Repository ${index}`,
    })) }) } } as Parameters<typeof setProjectCollaboration>[0];
    const result = await setProjectCollaboration(paseo, { projectId: "p1", enabled: true });
    expect(result.collaboration?.enabled).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(repositories[0], ".lanes", "lanes.config.json"), "utf8")).collaboration).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(repositories[1], ".lanes", "lanes.config.json"), "utf8")).collaboration).toBe(true);
    expect((await readProjectBoard(paseo, "p0")).collaboration?.enabled).toBe(false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

describe("saving per-entry reasoning efforts", () => {
  const entries = [
    { provider: "codex", status: "ready", enabled: true, models: [{ id: "gpt-6.1-sol", isSelectable: true, thinkingOptions: [{ id: "low" }, { id: "high" }] }] },
    { provider: "antigravity", status: "ready", enabled: true, models: [{ id: "gemini-4-argon-high", isSelectable: true, thinkingOptions: [] }] },
  ];
  const paseo = { providers: { snapshot: async () => ({ entries }) } } as unknown as Parameters<typeof saveModelRoutingPolicy>[0];
  const policy = {
    version: 1 as const, providerOrder: ["codex", "antigravity"],
    modelOrder: { manager: ["codex/gpt-6.1-sol", "antigravity/gemini-4-argon-high"], dev: ["codex/gpt-6.1-sol"] },
    reasoningEffortOrder: ["low", "high"], warningThresholds: [80, 90], handoffThreshold: 95,
  };

  it("rejects an effort the model does not offer, including any effort on a model without effort levels", async () => {
    await expect(saveModelRoutingPolicy(paseo, { ...policy, modelEffort: { manager: { "codex/gpt-6.1-sol": "ultra" }, dev: {} } }))
      .rejects.toThrow("Reasoning effort ultra is unavailable for manager provider/model codex/gpt-6.1-sol");
    await expect(saveModelRoutingPolicy(paseo, { ...policy, modelEffort: { manager: { "antigravity/gemini-4-argon-high": "high" }, dev: {} } }))
      .rejects.toThrow("unavailable for manager provider/model antigravity/gemini-4-argon-high");
  });

  it("rejects an effort set on an entry that is not ranked for that role", async () => {
    await expect(saveModelRoutingPolicy(paseo, { ...policy, modelEffort: { manager: {}, dev: { "antigravity/gemini-4-argon-high": "high" } } }))
      .rejects.toThrow("unranked provider/model antigravity/gemini-4-argon-high");
  });

  it("persists a valid entry effort through the checkout CLI", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "clips-paseo-effort-"));
    const cli = fileURLToPath(new URL("../../../src/cli.js", import.meta.url));
    const previous = Object.fromEntries(["LANES_HOME", "CLIPS_HOME", "LANES_CLI_PATH", "CLIPS_CLI_PATH"].map((key) => [key, process.env[key]]));
    process.env.LANES_HOME = path.join(root, "home");
    delete process.env.CLIPS_HOME;
    process.env.LANES_CLI_PATH = cli;
    try {
      const saved = await saveModelRoutingPolicy(paseo, { ...policy, modelEffort: { manager: { "codex/gpt-6.1-sol": "high" }, dev: {} } });
      expect(saved.modelEffort).toEqual({ manager: { "codex/gpt-6.1-sol": "high" }, dev: {} });
      const stored = JSON.parse(execFileSync(process.execPath, [cli, "config", "--user", "model_routing_policy"], {
        cwd: root, env: { ...process.env, LANES_HOME: path.join(root, "home") },
      }).toString());
      expect(stored.modelEffort.manager).toEqual({ "codex/gpt-6.1-sol": "high" });
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});
