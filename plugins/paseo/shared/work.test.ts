
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { start } from "../cli.js";
import { startWork } from "../server/backend";
import { branchName, branchPrefix, defaultProvider, executionFor, executionForManagers, matchesWorkspace, promptFor, type AgentInfo, type WorkspaceInfo } from "./work";

const task = { kind: "task" as const, ref: "#alice#g001#t01", title: "Write tests" };
const projectIds = ["parent", "linked"];

function workspace(branch = branchName(task), id = "workspace-1"): WorkspaceInfo {
  return { id, projectId: "linked", name: "Renamed manually", branch, status: "running" };
}
function agent(status: string, requiresAttention = false, attentionReason: AgentInfo["attentionReason"] = null): AgentInfo {
  return { id: "a1", workspaceId: "workspace-1", status, requiresAttention, attentionReason, labels: {}, title: null };
}

describe("Paseo work mapping", () => {
  it("uses title-independent branches and namespace-safe refs", () => {
    expect(branchName(task).startsWith(branchPrefix(task))).toBe(true);
    expect(branchPrefix({ ...task, title: "new title" })).toBe(branchPrefix(task));
    expect(branchPrefix({ ...task, ref: "#bob#g001#t01" })).not.toBe(branchPrefix(task));
    expect(branchPrefix({ ...task, kind: "goal" })).not.toBe(branchPrefix(task));
  });

  it("matches linked-worktree project IDs and branch-renamed workspace titles", () => {
    expect(matchesWorkspace(workspace(), task, projectIds)).toBe(true);
    expect(matchesWorkspace({ ...workspace(), projectId: "unrelated" }, task, projectIds)).toBe(false);
    expect(matchesWorkspace(workspace("clips/task/elsewhere"), task, projectIds)).toBe(false);
  });

  it("only counts an actively executing agent as running", () => {
    expect(executionFor(task, projectIds, [workspace()], [agent("running")])).toMatchObject({ status: "running", runningAgents: 1 });
    expect(executionFor(task, projectIds, [workspace()], [agent("initializing")])).toMatchObject({ status: "running", runningAgents: 1 });
    expect(executionFor(task, projectIds, [workspace()], [agent("idle")])).toMatchObject({ status: "idle", runningAgents: 0 });
    expect(executionFor(task, projectIds, [workspace()], [agent("idle", true, "permission")])).toMatchObject({ status: "attention" });
    expect(executionFor(task, projectIds, [workspace()], [agent("running", true, "permission")])).toMatchObject({ status: "attention", runningAgents: 0 });
    expect(executionFor(task, projectIds, [workspace()], [agent("idle", true, "finished")])).toMatchObject({ status: "idle" });
    expect(executionFor(task, projectIds, [{ ...workspace(), status: "attention" }], [agent("idle", true, "finished")])).toMatchObject({ status: "idle" });
    expect(executionFor(task, projectIds, [workspace()], [agent("error", true, "error")])).toMatchObject({ status: "error" });
    expect(executionFor(task, projectIds, [workspace()], [agent("error")])).toMatchObject({ status: "error" });
    expect(executionFor(task, projectIds, [], [])).toMatchObject({ status: "none" });
  });

  it("recovers a retitled/rebranched workspace through agent labels", () => {
    const changed = workspace("different-branch");
    const labeled = { ...agent("running"), labels: { "clips.ref": task.ref, "clips.projectId": "parent" } };
    expect(executionFor(task, projectIds, [changed], [labeled])).toMatchObject({
      status: "running", workspaceId: changed.id,
    });
  });

  it("does not adopt siblings in a shared workspace or override explicit labels", () => {
    const labeled = { ...agent("running"), labels: { "clips.ref": task.ref, "clips.projectId": "parent" } };
    const unrelated = { ...agent("running"), id: "other", labels: { "clips.ref": "#other", "clips.projectId": "parent" } };
    const legacy = { ...agent("running"), id: "legacy" };
    expect(executionFor(task, projectIds, [workspace("main")], [labeled, unrelated, legacy]).agents).toEqual([labeled]);
    expect(executionFor(task, projectIds, [workspace()], [unrelated]).agents).toEqual([]);
    expect(executionFor(task, projectIds, [{ ...workspace(), status: "needs_input" }], [unrelated]).status).toBe("idle");
    expect(executionFor(task, projectIds, [workspace()], [{ ...labeled, labels: { ...labeled.labels, "clips.kind": "lane-closure-autofill" } }]).agents).toEqual([]);
    expect(executionFor(task, projectIds, [workspace()], [agent("running"), legacy]).agents).toEqual([]);
    expect(executionFor(task, projectIds, [workspace()], [{ ...labeled, labels: { ...labeled.labels, "clips.projectId": "foreign" } }]).agents).toEqual([]);
  });

  it("keeps multiple active targets and pending-input sessions across project workspaces", () => {
    const first = { ...agent("running"), labels: { "clips.ref": task.ref, "clips.projectId": "parent" } };
    const second = { ...first, id: "a2", workspaceId: "workspace-2", status: "attention" };
    const result = executionFor(task, projectIds, [workspace("main"), workspace("main", "workspace-2")], [first, second]);
    expect(result.agents).toEqual([first, second]);
    expect(result.workspaceCount).toBe(2);
    expect(executionFor(task, projectIds, [workspace("main", "workspace-2")], [second]).status).toBe("attention");
  });

  it("maps claimed managers independently of workers, host aliases and stopped execution", () => {
    const owners = [{ host: "host", runtime: "paseo", session_id: "manager" }];
    const manager = { ...agent("idle"), id: "manager" };
    const worker = { ...agent("running"), id: "worker" };
    const result = executionForManagers(owners, "host", [workspace()], [manager, worker]);
    expect(result).toMatchObject({ status: "idle", runningAgents: 0, agents: [manager] });
    expect(executionForManagers(owners, "host", [{ ...workspace(), status: "needs_input" }], [manager, worker]).status).toBe("idle");
    expect(executionForManagers(owners, "different-host", [workspace()], [manager, worker]).agents).toEqual([]);
    expect(executionForManagers(owners, "host", [workspace()], [worker]).agents).toEqual([]);
    const shared = [...owners, { host: "host", runtime: "paseo", session_id: "second-manager" }];
    expect(executionForManagers(shared, "host", [workspace()], [manager, { ...manager, id: "second-manager" }, worker]).agents).toHaveLength(2);
  });

  it("prevents incorrect source/model or acceptance promises", () => {
    expect(defaultProvider([{ provider: "a", status: "offline" }, { provider: "codex", status: "ready", models: [{ id: "m", isDefault: true }] }])).toBe("codex/m");
    expect(promptFor(task)).toContain("without self-approving");
    expect(promptFor(task)).toContain("clips view '#alice#g001#t01' --json");
    expect(promptFor({ kind: "lane", ref: "#l001", title: "Vision" })).toContain("strategic product frame");
    const managerPrompt = promptFor({ kind: "lane", ref: "#l001", title: "Vision" });
    expect(managerPrompt).toContain("claims and registrations are advisory metadata, not prerequisites for authorized work");
    expect(managerPrompt).toContain("Mediate competing approaches with the developers");
    expect(managerPrompt).toContain("record decisions and amend contracts");
    expect(managerPrompt).toContain("make authorized local commits before manager analysis and user validation");
    expect(managerPrompt).toContain("default human review is a Goal-attached CR for the exact candidate");
    expect(managerPrompt).not.toContain("do not begin management");
    expect(managerPrompt).toContain("verified top-level workspace dev agents the user can steer directly");
    expect(managerPrompt).toContain("Review their evidence without taking over implementation");
  });
});

describe("generated work execution contexts", () => {
  it.each(["goal", "task"] as const)("gives %s dev owners tracked Task parallelism and integrated evidence duties", (kind) => {
    const prompt = promptFor({ ...task, kind });
    expect(prompt).toMatch(/Use other workers only when the task contracts authorize it and the host supports it/);
    expect(prompt).not.toContain("Use sub-agents for as much useful feasible work as possible");
    expect(prompt).toMatch(/dependency-ready, non-conflicting Tasks concurrently; sequence prerequisites and conflicting writes/);
    expect(prompt).toMatch(/one dev coordinator for integration, verification and workflow-record writes/);
    expect(prompt).toMatch(/results and checks mapped to Task IDs and the actual source\/artifact checked/);
    expect(prompt).not.toContain("Do not create child agents");
    if (kind === "task") expect(prompt).toContain("A Task assignment does not authorize sibling scope");
  });

  it("makes managers convey the execution contract while retaining their coordination boundary", () => {
    const prompt = promptFor({ kind: "lane", ref: "#l001", title: "Vision" });
    expect(prompt).toMatch(/In every handoff, instruct the top-level dev owner.*Plan and execute parallel Tasks/);
    expect(prompt).toContain("Do not create or direct the owner's sub-agents yourself");
    expect(prompt).toContain("Mediate competing approaches with the developers");
    expect(prompt).not.toContain("run validation or babysit workers yourself");
    expect(prompt).not.toContain("assigning each worker Task IDs and contracts");
  });

  it("keeps worker retirement independent of a pending human Goal review", () => {
    const prompt = promptFor(task);
    expect(prompt).toContain("Return the finite batch after durable handoff");
    expect(prompt).toContain("a pending human Goal review does not keep an idle worker assigned");
  });

  it("passes the same Goal/Task context through CLI previews, CLI/server agents and workspace attachments", async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lane-dev-context-")));
    const cli = fileURLToPath(new URL("../../../src/cli.js", import.meta.url));
    const previous = Object.fromEntries(["LANES_HOME", "LANES_CLI_PATH"].map(key => [key, process.env[key]]));
    process.env.LANES_HOME = path.join(root, "home");
    process.env.LANES_CLI_PATH = cli;
    try {
      execFileSync("git", ["init", "--quiet"], { cwd: root });
      const run = (...args: string[]) => execFileSync(process.execPath, [cli, ...args], { cwd: root });
      run("init", "--skills-scope", "project");
      run("goal", "create", JSON.stringify({ title: "Local goal" }));
      run("task", "create", "g1", JSON.stringify({ title: "Local task" }));
      const createAgent = vi.fn(async (_options: any) => ({ id: "dev-agent", workspaceId: "w1" }));
      const createWorkspace = vi.fn(async (_options: any) => ({ id: "new-workspace" }));
      const paseo: any = {
        projects: { list: async () => ({ projects: [{ projectId: "p1", projectKind: "git", projectRootPath: root }] }) },
        workspaces: {
          list: async () => ({ entries: [{ id: "w1", projectId: "p1", name: "Existing", status: "ready", gitRuntime: { currentBranch: "main" } }], pageInfo: { hasMore: false } }),
          ref: () => ({ id: "w1", agents: { create: createAgent } }),
          create: createWorkspace,
        },
        agents: { list: async () => ({ entries: [], pageInfo: { hasMore: false } }) },
        providers: {
          snapshot: async () => ({ entries: [{ provider: "codex", status: "ready", models: [{ id: "model", isDefault: true }], modes: [{ id: "full-access", label: "Full access" }] }] }),
          listModes: async () => ({ modes: [{ id: "full-access", label: "Full access" }] }),
          listFeatures: async () => ({ features: [] }),
        },
      };
      const targets = [
        { kind: "goal" as const, ref: "#g001", title: "Local goal" },
        { kind: "task" as const, ref: "#g001#t01", title: "Local task" },
      ];
      for (const target of targets) {
        const expectedPrompt = promptFor(target);
        const options = { project: root, ref: target.ref, provider: "codex/model", workspace: "w1", features: [] };
        const preview = await start(paseo, { ...options, "dry-run": true });
        expect(preview.prompt).toBe(expectedPrompt);
        expect(createAgent).not.toHaveBeenCalled();
        await start(paseo, options);
        await startWork(paseo, { agent: "codex/model", featureValues: {} } as any, {
          projectId: "p1", ref: target.ref, mode: "agent", workspaceId: "w1",
        });
        expect(createAgent).toHaveBeenCalledTimes(2);
        for (const [created] of createAgent.mock.calls) {
          expect(created).toMatchObject({
            prompt: expectedPrompt,
            config: { provider: "codex/model", modeId: "full-access" },
            labels: { "clips.ref": target.ref, "clips.projectId": "p1", "clips.kind": target.kind },
          });
        }
        await startWork(paseo, { agent: "", featureValues: {} } as any, { projectId: "p1", ref: target.ref, mode: "workspace" });
        expect(createWorkspace).toHaveBeenLastCalledWith(expect.objectContaining({
          firstAgentContext: { attachments: [expect.objectContaining({ text: expectedPrompt, contextKind: "clips" })] },
          source: expect.objectContaining({ kind: "worktree", cwd: root, action: "branch-off" }),
        }));
        createAgent.mockClear();
      }
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
