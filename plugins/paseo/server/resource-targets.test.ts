import { beforeEach, describe, expect, it, vi } from "vitest";
import { execCommand } from "@getpaseo/plugin/server";
import { localProjects, normalizeBoard } from "./backend";
import { findClips } from "./clips-cli";
import {
  discoverResourceTargets, routeResourceTargets,
  type ResourceAgentObservation, type ResourceProjectObservation,
  type ResourceRegistrationObservation, type ResourceRoutingObservation,
} from "./resource-targets";

vi.mock("@getpaseo/plugin/server", async (original) => ({
  ...await original<typeof import("@getpaseo/plugin/server")>(), execCommand: vi.fn(),
}));
vi.mock("./backend", async (original) => ({
  ...await original<typeof import("./backend")>(), localProjects: vi.fn(),
}));
vi.mock("./clips-cli", () => ({ findClips: vi.fn() }));

const now = Date.parse("2026-10-24T12:00:00.000Z");
const options = { now, idleAgeSeconds: 300 };
const at = (secondsAgo: number) => new Date(now - secondsAgo * 1_000).toISOString();
const labels = (kind: string, ref: string, projectId = "p1", prefix = "clips") => ({
  [`${prefix}.kind`]: kind, [`${prefix}.ref`]: ref, [`${prefix}.projectId`]: projectId,
});
const rawBoard = () => ({
  lanes: [
    { ref: "#l001", title: "One", goal_refs: ["#g001"] },
    { ref: "#l002", title: "Two", goal_refs: ["#g002"] },
  ],
  goals: [
    { ref: "#g001", lane_id: "l001", tasks: [
      { ref: "#g001#t01", status: "closed" }, { ref: "#g001#t02" }, { ref: "#g001#t03" },
    ] },
    { ref: "#g002", lane_id: "l002", tasks: [{ ref: "#g002#t01" }] },
  ],
});
const project = (overrides: Partial<ResourceProjectObservation> = {}): ResourceProjectObservation => ({
  projectId: "p1", projectLabel: "First", projectIds: ["p1", "p1-worktree"], root: "/repos/first",
  board: normalizeBoard(rawBoard()), ...overrides,
});
const agent = (id: string, overrides: Partial<ResourceAgentObservation> = {}): ResourceAgentObservation => ({
  id, workspaceId: "w1", status: "idle", labels: labels("task", "#g001#t01"), updatedAt: at(600), ...overrides,
});
const manager = (overrides: Partial<ResourceAgentObservation> = {}) => agent("manager", {
  workspaceId: "wm", labels: labels("lane", "#l001"), ...overrides,
});
const registration = (overrides: Partial<ResourceRegistrationObservation> = {}): ResourceRegistrationObservation => ({
  projectRoot: "/repos/first", laneRef: "#l001", managerId: "manager", runtime: "paseo",
  status: "working", available: true, ...overrides,
});
const observation = (overrides: Partial<ResourceRoutingObservation> = {}): ResourceRoutingObservation => ({
  projects: [project()],
  workspaces: [{ id: "wm", projectId: "p1" }, { id: "w1", projectId: "p1-worktree" }],
  agents: [manager(), agent("old")], registrations: [], ...overrides,
});

describe("resource advisory routing", () => {
  it("ranks old idle agents before newer idle and current agents, including historical closed Tasks", () => {
    const result = routeResourceTargets(observation({ agents: [
      manager({ status: "running" }),
      agent("current", { status: "running", labels: labels("task", "#g001#t03"), updatedAt: at(900) }),
      agent("recent", { labels: labels("task", "#g001#t02"), updatedAt: at(20) }),
      agent("old"),
      agent("unrelated", { labels: {} }),
      agent("closed", { status: "closed" }),
      agent("archived", { archivedAt: at(20) }),
    ] }), options);
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0]).toMatchObject({
      managerId: "manager", managerWorkspaceId: "wm", managerLabels: labels("lane", "#l001"),
      candidates: [
        { agentId: "old", disposition: "old_idle", ref: "#g001#t01", needsInput: false },
        { agentId: "recent", disposition: "idle" },
        { agentId: "current", disposition: "current" },
      ],
    });
    expect(result.warnings).toEqual([]);
  });

  it("retains observed managers with no remaining dev agents so recovery can be delivered", () => {
    const result = routeResourceTargets(observation({ agents: [manager()] }), options);
    expect(result.targets).toMatchObject([{ managerId: "manager", candidates: [] }]);
  });

  it("accepts each label family and matching dual labels, rejecting incomplete and conflicting attribution", () => {
    const result = routeResourceTargets(observation({ agents: [
      manager({ labels: labels("lane", "#l001", "p1", "lanes") }),
      agent("modern", { labels: labels("task", "#g001#t01", "p1", "lanes") }),
      agent("legacy"),
      agent("dual", { labels: { ...labels("task", "#g001#t01"), ...labels("task", "#g001#t01", "p1", "lanes") } }),
      agent("conflict", { labels: { ...labels("task", "#g001#t01"), ...labels("task", "#g002#t01", "p1", "lanes") } }),
      agent("partial", { labels: { ...labels("task", "#g001#t01"), "lanes.kind": "task" } }),
      agent("wrong-kind", { labels: labels("goal", "#g001#t01") }),
    ] }), options);
    expect(result.targets[0].candidates.map((candidate) => candidate.agentId)).toEqual(["dual", "legacy", "modern"]);
    expect(result.warnings).toHaveLength(2);
  });

  it("aggregates a registered manager's several Lanes without requiring its one label to identify every Lane", () => {
    const result = routeResourceTargets(observation({
      registrations: [registration(), registration({ laneRef: "#l002" })],
      agents: [manager(), agent("one"), agent("two", { labels: labels("task", "#g002#t01") })],
    }), options);
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0].lanes.map((lane) => lane.laneRef)).toEqual(["#l001", "#l002"]);
    expect(result.targets[0].candidates.map((candidate) => candidate.agentId)).toEqual(["one", "two"]);
  });

  it("routes an unlabelled registered manager only after native workspace/project verification", () => {
    const data = observation({ agents: [manager({ labels: {} }), agent("dev")], registrations: [registration({ workspaceId: "wm" })] });
    expect(routeResourceTargets(data, options).targets).toHaveLength(1);
    data.workspaces = data.workspaces.filter((workspace) => workspace.id !== "wm");
    expect(routeResourceTargets(data, options).targets).toEqual([]);
  });

  it("routes explicit cross-project registrations while keeping legacy claim and label fallback within the native project", () => {
    const data = observation({
      projects: [project(), project({ projectId: "p2", projectLabel: "Second", projectIds: ["p2"], root: "/repos/second" })],
      workspaces: [{ id: "wm", projectId: "p1" }, { id: "w1", projectId: "p1-worktree" }, { id: "w2", projectId: "p2" }],
      registrations: [registration(), registration({ projectRoot: "/repos/second" })],
      agents: [manager(), agent("first"), agent("second", { workspaceId: "w2", labels: labels("task", "#g001#t01", "p2") })],
    });
    const result = routeResourceTargets(data, options);
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0].lanes.map((lane) => lane.projectId)).toEqual(["p1", "p2"]);
    expect(result.targets[0].candidates.map((candidate) => candidate.agentId)).toEqual(["first", "second"]);

    data.registrations = [];
    data.projects[1].board.lanes[0].managerClaim = { revision: 1, owners: [{
      host: "host", runtime: "paseo", session_id: "manager", workspace_id: "wm",
    }] };
    const legacy = routeResourceTargets(data, options);
    expect(legacy.targets[0].lanes.map((lane) => lane.projectId)).toEqual(["p1"]);
    expect(legacy.targets[0].candidates.map((candidate) => candidate.agentId)).toEqual(["first"]);

    data.registrations = [registration({ projectRoot: "/repos/second" })];
    data.agents[0].labels = labels("lane", "#l001", "p2");
    expect(routeResourceTargets(data, options).targets).toEqual([]);
  });

  it("routes an explicitly registered unlabelled central manager in an observed workspace outside initialized Lanes projects", () => {
    const data = observation({
      workspaces: [{ id: "wm", projectId: "central-directory" }, { id: "w1", projectId: "p1-worktree" }],
      registrations: [registration({ workspaceId: "wm" })],
      agents: [manager({ labels: {} }), agent("dev")],
    });
    expect(routeResourceTargets(data, options).targets[0]).toMatchObject({
      managerId: "manager", managerWorkspaceId: "wm", candidates: [{ agentId: "dev" }],
    });
    data.registrations[0].workspaceId = "unobserved-workspace";
    expect(routeResourceTargets(data, options).targets).toEqual([]);
  });

  it("uses scoped legacy claims but does not wake stopped, archived, closed, errored or unavailable managers", () => {
    const data = observation({ agents: [manager({ labels: {} }), agent("dev")] });
    data.projects[0].board.lanes[0].managerClaim = { revision: 1, owners: [{
      host: "host-a", runtime: "paseo", session_id: "manager", workspace_id: "wm",
    }] };
    expect(routeResourceTargets(data, { ...options, hostId: "host-a" }).targets).toHaveLength(1);
    expect(routeResourceTargets(data, { ...options, hostId: "host-b" }).targets).toEqual([]);
    for (const change of [{ status: "closed" }, { status: "error" }, { archivedAt: at(1) }, { providerUnavailable: true }]) {
      expect(routeResourceTargets({ ...data, agents: [manager({ labels: {}, ...change }), agent("dev")] }, options).targets).toEqual([]);
    }
    data.agents[0].labels = labels("lane", "#l001");
    data.registrations = [registration({ status: "stopped" })];
    expect(routeResourceTargets(data, options).targets).toEqual([]);
  });

  it("suppresses mismatched or unavailable registered associations instead of reviving them from stale labels", () => {
    for (const change of [{ hostId: "other-host" }, { workspaceId: "other-workspace" }, { available: false }]) {
      const result = routeResourceTargets(observation({ registrations: [registration(change)] }), { ...options, hostId: "this-host" });
      expect(result.targets).toEqual([]);
    }
    expect(routeResourceTargets(observation({ registrations: [registration({ hostId: "recorded-host" })] }), options).targets).toHaveLength(1);
  });

  it("does not let a stopped foreign-host registration suppress a verified current-host registration", () => {
    const data = observation({ registrations: [
      registration({ hostId: "foreign-host", status: "stopped" }),
      registration({ hostId: "local-host", workspaceId: "wm" }),
    ] });
    expect(routeResourceTargets(data, { ...options, hostId: "local-host" }).targets).toHaveLength(1);
    expect(routeResourceTargets(data, { ...options, hostId: "foreign-host" }).targets).toEqual([]);
    const unknown = routeResourceTargets(data, options);
    expect(unknown.targets).toEqual([]);
    expect(unknown.warnings.join(" ")).toContain("several recorded host identities");
    data.registrations[0].status = "working";
    expect(routeResourceTargets(data, options).targets).toEqual([]);
  });

  it("does not revive a mismatched legacy claim from labels, while a verified current registration supersedes that claim", () => {
    const data = observation();
    data.projects[0].board.lanes[0].managerClaim = { revision: 1, owners: [{
      host: "other-host", runtime: "paseo", session_id: "manager", workspace_id: "wm",
    }] };
    expect(routeResourceTargets(data, { ...options, hostId: "this-host" }).targets).toEqual([]);
    data.registrations = [registration({ hostId: "this-host", workspaceId: "wm" })];
    expect(routeResourceTargets(data, { ...options, hostId: "this-host" }).targets).toHaveLength(1);
    data.projects[0].board.lanes[0].managerClaimError = "Cannot read the legacy claim";
    expect(routeResourceTargets(data, { ...options, hostId: "this-host" }).targets).toHaveLength(1);
    data.registrations = [];
    expect(routeResourceTargets(data, options).targets).toEqual([]);
  });

  it("never routes a registered manager labelled as a dev or recommends that manager as a dev candidate", () => {
    const result = routeResourceTargets(observation({
      registrations: [registration()],
      agents: [manager({ labels: labels("task", "#g001#t01") }), manager({ id: "second" }), agent("dev")],
    }), options);
    expect(result.targets.map((target) => target.managerId)).toEqual(["second"]);
    expect(result.targets[0].candidates.map((candidate) => candidate.agentId)).toEqual(["dev"]);
  });

  it("preserves namespaces and native repository identity even when work refs collide", () => {
    const one = project({ board: normalizeBoard({
      lanes: [{ ref: "#l001", goal_refs: ["#alice#g001"] }, { ref: "#l002", goal_refs: ["#bob#g001"] }],
      goals: [
        { ref: "#alice#g001", lane_id: "l001", tasks: [{ ref: "#alice#g001#t01" }] },
        { ref: "#bob#g001", lane_id: "l002", tasks: [{ ref: "#bob#g001#t01" }] },
      ],
    }) });
    const result = routeResourceTargets(observation({
      projects: [one, project({ projectId: "p2", projectIds: ["p2"], root: "/repos/second" })],
      workspaces: [{ id: "wm", projectId: "p1" }, { id: "w1", projectId: "p1-worktree" }, { id: "w2", projectId: "p2" }],
      agents: [
        manager(), agent("alice", { labels: labels("task", "#alice#g001#t01") }),
        agent("bob", { labels: labels("task", "#bob#g001#t01") }),
        agent("wrong-project", { workspaceId: "w2", labels: labels("task", "#alice#g001#t01") }),
        agent("missing-namespace", { labels: labels("task", "#g001#t01") }),
      ],
    }), options);
    expect(result.targets[0].candidates.map((candidate) => candidate.agentId)).toEqual(["alice"]);
  });

  it("does not classify pending input, an active turn or invalid timestamps as old idle work", () => {
    const result = routeResourceTargets(observation({ agents: [
      manager(),
      agent("permission", { requiresAttention: true, attentionReason: "permission", pendingPermissions: [{}] }),
      agent("permission-reason", { attentionReason: "permission" }),
      agent("turn", { activeTurn: { id: "still-running" } }),
      agent("unknown-time", { updatedAt: "invalid" }),
      agent("future", { updatedAt: at(-1) }),
    ] }), options);
    const entries = new Map(result.targets[0].candidates.map((candidate) => [candidate.agentId, candidate]));
    expect(entries.get("permission")).toMatchObject({ disposition: "current", needsInput: true });
    expect(entries.get("permission-reason")).toMatchObject({ disposition: "current", needsInput: true });
    expect(entries.get("turn")).toMatchObject({ disposition: "current" });
    expect(entries.get("unknown-time")).toMatchObject({ disposition: "idle", updatedAt: null });
    expect(entries.get("future")).toMatchObject({ disposition: "idle" });
  });

  it("isolates ambiguous native IDs, work refs and Lane membership", () => {
    const data = observation({ agents: [manager(), agent("duplicate"), agent("duplicate"), agent("safe")] });
    expect(routeResourceTargets(data, options).targets[0].candidates.map((candidate) => candidate.agentId)).toEqual(["safe"]);
    data.projects[0].board.lanes[1].goalRefs.push("#g001");
    expect(routeResourceTargets(data, options).targets[0].candidates).toEqual([]);
    data.projects[0] = project();
    data.workspaces.push({ id: "w1", projectId: "p2" });
    expect(routeResourceTargets(data, options).targets[0].candidates).toEqual([]);
  });

  it("disables fallback on failed registration reads while retaining valid explicit registrations", () => {
    expect(routeResourceTargets(observation({ registrationsAvailable: false }), options).targets).toEqual([]);
    const result = routeResourceTargets(observation({ registrationsAvailable: false, registrations: [registration()] }), options);
    expect(result.targets).toHaveLength(1);
  });
});

describe("resource target discovery adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findClips).mockResolvedValue({ bin: "node", prefix: ["/checkout/src/cli.js"] });
    vi.mocked(localProjects).mockResolvedValue([{ projectId: "p1", projectIds: ["p1", "p1-worktree"], label: "First", root: "/repos/first", configPath: "/repos/first/lanes.config.json" }]);
    vi.mocked(execCommand).mockImplementation(async (_bin, args) => ({
      stdout: JSON.stringify(args.includes("board") ? rawBoard() : { registrations: [], warnings: [] }), stderr: "", exitCode: 0,
    } as Awaited<ReturnType<typeof execCommand>>));
  });
  const runtime = () => ({
    workspaces: { list: vi.fn().mockResolvedValue({ entries: [{ id: "wm", projectId: "p1" }, { id: "w1", projectId: "p1-worktree" }], pageInfo: { hasMore: false } }) },
    agents: { list: vi.fn().mockResolvedValue({ entries: [{ agent: manager() }, { agent: agent("dev") }], pageInfo: { hasMore: false } }) },
  });

  it("paginates both native directories, reads central registrations once and does not mutate the runtime", async () => {
    const paseo = runtime();
    paseo.agents.list.mockResolvedValueOnce({ entries: [{ agent: manager() }], pageInfo: { hasMore: true, nextCursor: "agents-two" } });
    paseo.workspaces.list.mockResolvedValueOnce({ entries: [], pageInfo: { hasMore: true, nextCursor: "workspaces-two" } });
    // The second agent page must not repeat the manager from page one.
    paseo.agents.list.mockResolvedValueOnce({ entries: [{ agent: agent("dev") }], pageInfo: { hasMore: false } });
    const result = await discoverResourceTargets(paseo as any, options);
    expect(result.targets[0].candidates.map((candidate) => candidate.agentId)).toEqual(["dev"]);
    expect(paseo.agents.list).toHaveBeenLastCalledWith({ filter: { includeArchived: false }, page: { limit: 200, cursor: "agents-two" } });
    expect(paseo.workspaces.list).toHaveBeenLastCalledWith({ page: { limit: 200, cursor: "workspaces-two" } });
    expect(vi.mocked(execCommand).mock.calls.filter(([, args]) => args.includes("manager"))).toHaveLength(1);
    expect(vi.mocked(localProjects)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(execCommand).mock.calls.map(([, args]) => args.slice(1))).toEqual([
      ["lane", "manager", "list", "--all", "--json"], ["board", "--json"],
    ]);
  });

  it("isolates a failed project board without discarding another project's valid targets", async () => {
    vi.mocked(localProjects).mockResolvedValue([
      { projectId: "p2", projectIds: ["p2"], label: "Broken", root: "/repos/broken", configPath: "/repos/broken/config.json" },
      { projectId: "p1", projectIds: ["p1", "p1-worktree"], label: "First", root: "/repos/first", configPath: "/repos/first/config.json" },
    ]);
    vi.mocked(execCommand).mockImplementation(async (_bin, args, settings) => {
      if (args.includes("board") && settings?.cwd === "/repos/broken") throw new Error("Broken board");
      return { stdout: JSON.stringify(args.includes("board") ? rawBoard() : { registrations: [], warnings: [] }), stderr: "" } as Awaited<ReturnType<typeof execCommand>>;
    });
    const result = await discoverResourceTargets(runtime() as any, options);
    expect(result.targets).toHaveLength(1);
    expect(result.warnings).toEqual(["Cannot route resources for Broken: Broken board"]);
  });

  it("rejects lost and repeated pagination cursors instead of using a partial directory", async () => {
    for (const nextCursor of [null, "same"]) {
      const paseo = runtime();
      paseo.agents.list.mockResolvedValue({ entries: [], pageInfo: { hasMore: true, nextCursor } });
      const result = await discoverResourceTargets(paseo as any, options);
      expect(result.targets).toEqual([]);
      expect(result.warnings).toContain("Cannot observe Paseo agents: Paseo agent pagination did not advance.");
      expect(paseo.agents.list.mock.calls.length).toBeLessThanOrEqual(2);
    }
  });

  it("bounds a native directory that keeps returning distinct continuation pages", async () => {
    const paseo = runtime();
    let page = 0;
    paseo.agents.list.mockImplementation(async () => ({ entries: [], pageInfo: { hasMore: true, nextCursor: `page-${++page}` } }));
    const result = await discoverResourceTargets(paseo as any, options);
    expect(result.targets).toEqual([]);
    expect(paseo.agents.list).toHaveBeenCalledTimes(100);
    expect(result.warnings).toContain("Cannot observe Paseo agents: Paseo agent directory exceeded the resource manager page limit.");
  });

  it("respects stopped canonical associations and reports registry failure without stale fallback", async () => {
    vi.mocked(execCommand).mockImplementation(async (_bin, args) => ({
      stdout: JSON.stringify(args.includes("board") ? rawBoard() : { registrations: [{
        project: { path: "/repos/first" }, lane_id: "l001", actor: { runtime: "paseo", session_id: "manager" },
        status: "stopped", availability: { status: "available" },
      }], warnings: [] }), stderr: "",
    } as Awaited<ReturnType<typeof execCommand>>));
    expect((await discoverResourceTargets(runtime() as any, options)).targets).toEqual([]);
    vi.mocked(execCommand).mockImplementation(async (_bin, args) => {
      if (args.includes("manager")) throw new Error("Registration store unavailable");
      return { stdout: JSON.stringify(rawBoard()), stderr: "" } as Awaited<ReturnType<typeof execCommand>>;
    });
    const result = await discoverResourceTargets(runtime() as any, options);
    expect(result.targets).toEqual([]);
    expect(result.warnings).toContain("Cannot read Lane manager registrations; fallback is disabled: Registration store unavailable");
  });
});
