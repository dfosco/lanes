import { execCommand, type PluginHandlerContext } from "@getpaseo/plugin/server";
import { localProjects, normalizeBoard } from "./backend";
import { findClips } from "./clips-cli";

type Paseo = PluginHandlerContext["paseo"];
type Board = ReturnType<typeof normalizeBoard>;
const MAX_PAGES = 100;

export type ResourceLane = {
  projectId: string;
  projectLabel: string;
  laneRef: string;
  laneTitle: string;
};
export type ResourceCandidate = ResourceLane & {
  agentId: string;
  workspaceId: string;
  ref: string;
  status: string;
  disposition: "old_idle" | "idle" | "current";
  updatedAt: string | null;
  needsInput: boolean;
};
export type ResourceTarget = {
  managerId: string;
  managerWorkspaceId: string;
  managerLabels: Record<string, string>;
  lanes: ResourceLane[];
  candidates: ResourceCandidate[];
};

/** Only native observations and CLI projections enter the routing policy. */
export type ResourceAgentObservation = {
  id: string;
  workspaceId: string | null;
  status: string;
  labels: Record<string, string>;
  archivedAt?: string | null;
  providerUnavailable?: boolean;
  updatedAt?: string | null;
  activeTurn?: unknown;
  requiresAttention?: boolean;
  attentionReason?: string | null;
  pendingPermissions?: readonly unknown[];
};
export type ResourceProjectObservation = {
  projectId: string;
  projectLabel: string;
  projectIds: string[];
  root: string;
  board: Board;
};
export type ResourceRegistrationObservation = {
  projectRoot: string;
  laneRef: string;
  managerId: string;
  runtime: string;
  status: "working" | "stopped";
  available: boolean;
  workspaceId?: string;
  hostId?: string;
};
export type ResourceRoutingObservation = {
  projects: ResourceProjectObservation[];
  workspaces: { id: string; projectId: string }[];
  agents: ResourceAgentObservation[];
  registrations: ResourceRegistrationObservation[];
  /** Failed registration discovery must not resurrect stopped associations via fallback. */
  registrationsAvailable?: boolean;
};
export type ResourceTargetOptions = { now: number; idleAgeSeconds: number; hostId?: string };

type Binding = { ref: string; projectId: string; kind: "lane" | "goal" | "task" };
type BindingResult = { binding: Binding | null; conflict: boolean };
function bindingFor(labels: Record<string, string>): BindingResult {
  const bindings: Binding[] = [];
  for (const prefix of ["lanes", "clips"]) {
    const fields = ["ref", "projectId", "kind"].map((key) => labels[`${prefix}.${key}`]);
    if (fields.every((value) => value === undefined)) continue;
    const [ref, projectId, kind] = fields;
    if (fields.some((value) => typeof value !== "string" || !value.trim()) ||
        !["lane", "goal", "task"].includes(kind)) return { binding: null, conflict: true };
    bindings.push({ ref, projectId, kind: kind as Binding["kind"] });
  }
  if (bindings.length === 2 && ["ref", "projectId", "kind"].some((key) =>
    bindings[0][key as keyof Binding] !== bindings[1][key as keyof Binding])) {
    return { binding: null, conflict: true };
  }
  return { binding: bindings[0] ?? null, conflict: false };
}

function uniqueBy<T>(values: T[], key: (value: T) => string, kind: string, warnings: Set<string>): Map<string, T> {
  const out = new Map<string, T>();
  const duplicates = new Set<string>();
  for (const value of values) {
    const id = key(value);
    if (!id || out.has(id) || duplicates.has(id)) {
      out.delete(id);
      duplicates.add(id);
      warnings.add(`Ambiguous ${kind} ${JSON.stringify(id)} was excluded from resource routing.`);
    } else out.set(id, value);
  }
  return out;
}

const laneKey = (lane: ResourceLane) => JSON.stringify([lane.projectId, lane.laneRef]);
const associationKey = (projectId: string, laneRef: string, managerId: string) => JSON.stringify([projectId, laneRef, managerId]);

/** Produces suggestions, never retirement authority or a process liveness claim. */
export function routeResourceTargets(
  observed: ResourceRoutingObservation,
  options: ResourceTargetOptions,
): { targets: ResourceTarget[]; warnings: string[] } {
  const warnings = new Set<string>();
  const workspaces = uniqueBy(observed.workspaces, (workspace) => workspace.id, "workspace", warnings);
  const agents = uniqueBy(observed.agents, (agent) => agent.id, "agent", warnings);
  const projects = uniqueBy(observed.projects, (project) => project.root, "project root", warnings);
  const projectIds = new Map<string, ResourceProjectObservation>();
  const conflictingProjectIds = new Set<string>();
  for (const project of projects.values()) {
    for (const id of project.projectIds) {
      if (projectIds.has(id) && projectIds.get(id) !== project || conflictingProjectIds.has(id)) {
        projectIds.delete(id);
        conflictingProjectIds.add(id);
        warnings.add(`Paseo project ${JSON.stringify(id)} belongs to ambiguous repository observations.`);
      } else projectIds.set(id, project);
    }
  }
  const bindings = new Map<string, BindingResult>();
  for (const agent of agents.values()) {
    const binding = bindingFor(agent.labels);
    bindings.set(agent.id, binding);
    if (binding.conflict) warnings.add(`Agent ${agent.id} has incomplete or conflicting Lanes labels; it was excluded.`);
  }
  const laneMaps = new Map<string, Map<string, Board["lanes"][number]>>();
  for (const project of projects.values()) {
    laneMaps.set(project.root, uniqueBy(project.board.lanes, (lane) => lane.ref, `Lane in ${project.projectLabel}`, warnings));
  }
  const laneInfo = (project: ResourceProjectObservation, ref: string): ResourceLane | null => {
    const lane = laneMaps.get(project.root)?.get(ref);
    return lane ? { projectId: project.projectId, projectLabel: project.projectLabel, laneRef: ref, laneTitle: lane.title } : null;
  };
  const nativeProject = (agent: ResourceAgentObservation): ResourceProjectObservation | undefined => {
    const workspace = agent.workspaceId ? workspaces.get(agent.workspaceId) : undefined;
    return workspace ? projectIds.get(workspace.projectId) : undefined;
  };
  const suppressed = new Set<string>();
  const fallbackSuppressed = new Set<string>();
  const registrationHosts = new Map<string, Set<string>>();
  for (const registration of observed.registrations) {
    const project = projects.get(registration.projectRoot);
    if (!project || registration.runtime !== "paseo") continue;
    const key = associationKey(project.projectId, registration.laneRef, registration.managerId);
    const hosts = registrationHosts.get(key) ?? new Set<string>();
    hosts.add(registration.hostId ?? "");
    registrationHosts.set(key, hosts);
    // A foreign actor tuple must not suppress a verified registration for the
    // current host merely because the two daemons use the same session ID.
    if (options.hostId && registration.hostId && registration.hostId !== options.hostId) {
      fallbackSuppressed.add(key);
      continue;
    }
    const agent = agents.get(registration.managerId);
    if (registration.status === "stopped" || !registration.available ||
        registration.workspaceId && agent && registration.workspaceId !== agent.workspaceId) {
      suppressed.add(key);
    }
  }
  if (!options.hostId) {
    for (const [key, hosts] of registrationHosts) {
      if (hosts.size > 1) {
        suppressed.add(key);
        warnings.add(`Manager association ${key} has several recorded host identities; resource routing needs an observed host ID.`);
      }
    }
  }
  const targets = new Map<string, ResourceTarget>();
  const fallbackBlockedLanes = new Set<string>();
  // A known manager remains protected from being suggested as a developer even
  // if a conflicting label prevents us from sending that manager an advisory.
  const managerIds = new Set<string>();
  for (const registration of observed.registrations) {
    if (registration.runtime === "paseo" && projects.has(registration.projectRoot)) managerIds.add(registration.managerId);
  }
  for (const project of projects.values()) {
    for (const lane of project.board.lanes) {
      if (lane.managerClaimError) {
        fallbackBlockedLanes.add(JSON.stringify([project.projectId, lane.ref]));
        warnings.add(`${project.projectLabel} ${lane.ref}: ${lane.managerClaimError}`);
      }
      for (const owner of lane.managerClaim?.owners ?? []) {
        if (owner.runtime !== "paseo") continue;
        managerIds.add(owner.session_id);
        const agent = agents.get(owner.session_id);
        if (options.hostId && owner.host !== options.hostId ||
            owner.workspace_id && agent && owner.workspace_id !== agent.workspaceId) {
          fallbackSuppressed.add(associationKey(project.projectId, lane.ref, owner.session_id));
        }
      }
    }
  }
  const addManager = (project: ResourceProjectObservation, laneRef: string, managerId: string, workspaceId?: string, hostId?: string, registered = false) => {
    const agent = agents.get(managerId);
    const lane = laneInfo(project, laneRef);
    const nativeWorkspace = agent?.workspaceId ? workspaces.get(agent.workspaceId) : undefined;
    if (!agent || !lane || !agent.workspaceId || !nativeWorkspace || agent.archivedAt || agent.providerUnavailable ||
        !["idle", "running", "initializing"].includes(agent.status) ||
        !registered && nativeProject(agent) !== project ||
        workspaceId && workspaceId !== agent.workspaceId ||
        options.hostId && hostId && options.hostId !== hostId ||
        suppressed.has(associationKey(project.projectId, laneRef, managerId)) ||
        !registered && (fallbackSuppressed.has(associationKey(project.projectId, laneRef, managerId)) ||
          fallbackBlockedLanes.has(JSON.stringify([project.projectId, laneRef])))) return;
    const attribution = bindings.get(managerId)!;
    // Explicit central registrations supply managed scope, including other
    // repositories. Labels, when present, still identify the manager's actual
    // native workspace project; they cannot silently reassign a dev's role.
    const ownProject = nativeProject(agent);
    const labelMatchesNativeProject = attribution.binding && (
      attribution.binding.projectId === nativeWorkspace.projectId ||
      ownProject && projectIds.get(attribution.binding.projectId) === ownProject
    );
    if (attribution.conflict || attribution.binding && (
      attribution.binding.kind !== "lane" || !labelMatchesNativeProject ||
      !registered && !laneMaps.get(project.root)?.has(attribution.binding.ref)
    )) {
      warnings.add(`Manager ${managerId} has labels that conflict with its observed Lane association.`);
      return;
    }
    managerIds.add(managerId);
    const target = targets.get(managerId) ?? {
      managerId, managerWorkspaceId: agent.workspaceId, managerLabels: { ...agent.labels }, lanes: [], candidates: [],
    };
    if (!target.lanes.some((entry) => laneKey(entry) === laneKey(lane))) target.lanes.push(lane);
    targets.set(managerId, target);
  };
  for (const registration of observed.registrations) {
    const project = projects.get(registration.projectRoot);
    if (project && registration.runtime === "paseo" && registration.status === "working" && registration.available) {
      addManager(project, registration.laneRef, registration.managerId, registration.workspaceId, registration.hostId, true);
    }
  }
  if (observed.registrationsAvailable !== false) {
    for (const project of projects.values()) {
      for (const lane of project.board.lanes) {
        if (lane.managerClaimError) {
          continue;
        }
        for (const owner of lane.managerClaim?.owners ?? []) {
          if (owner.runtime === "paseo") addManager(project, lane.ref, owner.session_id, owner.workspace_id, owner.host);
        }
      }
    }
    for (const agent of agents.values()) {
      const attribution = bindings.get(agent.id)!;
      if (attribution.conflict || attribution.binding?.kind !== "lane") continue;
      const project = projectIds.get(attribution.binding.projectId);
      if (project) addManager(project, attribution.binding.ref, agent.id);
    }
  }

  const candidateRecords = new Map<string, Map<string, { kind: "goal" | "task"; lane: ResourceLane }>>();
  for (const project of projects.values()) {
    const entries: { ref: string; kind: "goal" | "task"; lane: ResourceLane }[] = [];
    const goals = uniqueBy(project.board.goals, (goal) => goal.ref, `Goal in ${project.projectLabel}`, warnings);
    for (const goal of goals.values()) {
      const membership = project.board.lanes.filter((lane) => lane.goalRefs.includes(goal.ref)).map((lane) => lane.ref);
      const declared = goal.laneId ? (goal.laneId.startsWith("#") ? goal.laneId : `#${goal.laneId}`) : null;
      if (declared) membership.push(declared);
      const refs = [...new Set(membership)];
      if (refs.length !== 1) {
        if (refs.length > 1) warnings.add(`${project.projectLabel} ${goal.ref} has conflicting Lane membership; dev routing was skipped.`);
        continue;
      }
      const lane = laneInfo(project, refs[0]);
      if (!lane) continue;
      entries.push({ ref: goal.ref, kind: "goal", lane });
      for (const task of goal.tasks) entries.push({ ref: task.ref, kind: "task", lane });
    }
    candidateRecords.set(project.root, uniqueBy(entries, (entry) => entry.ref, `work reference in ${project.projectLabel}`, warnings));
  }
  for (const agent of agents.values()) {
    if (!agent.workspaceId || agent.archivedAt || agent.providerUnavailable || agent.status === "closed" ||
        !["idle", "running", "initializing", "error"].includes(agent.status) || managerIds.has(agent.id)) continue;
    const attribution = bindings.get(agent.id)!;
    if (attribution.conflict || !attribution.binding || attribution.binding.kind === "lane") continue;
    const project = nativeProject(agent);
    if (!project || projectIds.get(attribution.binding.projectId) !== project) continue;
    const record = candidateRecords.get(project.root)?.get(attribution.binding.ref);
    if (!record || record.kind !== attribution.binding.kind) continue;
    const needsInput = !!agent.pendingPermissions?.length || agent.attentionReason === "permission" || !!(agent.requiresAttention &&
      agent.attentionReason !== "finished" && agent.attentionReason !== "error");
    const timestamp = agent.updatedAt ? Date.parse(agent.updatedAt) : NaN;
    const updatedAt = Number.isFinite(timestamp) ? agent.updatedAt! : null;
    const idle = agent.status === "idle" && !agent.activeTurn && !needsInput;
    const disposition: ResourceCandidate["disposition"] = idle
      ? updatedAt && options.now - timestamp >= options.idleAgeSeconds * 1_000 ? "old_idle" : "idle"
      : "current";
    const candidate: ResourceCandidate = {
      ...record.lane, agentId: agent.id, workspaceId: agent.workspaceId,
      ref: attribution.binding.ref, status: agent.status, disposition, updatedAt, needsInput,
    };
    for (const target of targets.values()) {
      if (target.lanes.some((lane) => laneKey(lane) === laneKey(candidate))) target.candidates.push(candidate);
    }
  }
  const ranks = { old_idle: 0, idle: 1, current: 2 };
  for (const target of targets.values()) {
    target.lanes.sort((a, b) => laneKey(a).localeCompare(laneKey(b)));
    target.candidates.sort((a, b) => ranks[a.disposition] - ranks[b.disposition] ||
      (a.updatedAt ? Date.parse(a.updatedAt) : Infinity) - (b.updatedAt ? Date.parse(b.updatedAt) : Infinity) ||
      a.agentId.localeCompare(b.agentId));
  }
  return { targets: [...targets.values()].sort((a, b) => a.managerId.localeCompare(b.managerId)), warnings: [...warnings] };
}

async function listWorkspaces(paseo: Paseo): Promise<ResourceRoutingObservation["workspaces"]> {
  const entries: ResourceRoutingObservation["workspaces"] = [];
  let cursor: string | undefined;
  const cursors = new Set<string>();
  for (let index = 0; index < MAX_PAGES; index++) {
    const result = await paseo.workspaces.list({ page: { limit: 200, cursor } });
    for (const workspace of result.entries) entries.push({ id: workspace.id, projectId: workspace.projectId });
    if (!result.pageInfo.hasMore) return entries;
    cursor = result.pageInfo.nextCursor ?? undefined;
    if (!cursor || cursors.has(cursor)) throw new Error("Paseo workspace pagination did not advance.");
    cursors.add(cursor);
  }
  throw new Error("Paseo workspace directory exceeded the resource manager page limit.");
}

async function listAgents(paseo: Paseo): Promise<ResourceAgentObservation[]> {
  const entries: ResourceAgentObservation[] = [];
  let cursor: string | undefined;
  const cursors = new Set<string>();
  for (let index = 0; index < MAX_PAGES; index++) {
    const result = await paseo.agents.list({ filter: { includeArchived: false }, page: { limit: 200, cursor } });
    for (const { agent } of result.entries) entries.push({ ...agent, workspaceId: agent.workspaceId || null, labels: agent.labels ?? {} });
    if (!result.pageInfo.hasMore) return entries;
    cursor = result.pageInfo.nextCursor ?? undefined;
    if (!cursor || cursors.has(cursor)) throw new Error("Paseo agent pagination did not advance.");
    cursors.add(cursor);
  }
  throw new Error("Paseo agent directory exceeded the resource manager page limit.");
}

const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && !!value.trim();
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

function registrationsFrom(raw: unknown, warnings: string[]): {
  registrations: ResourceRegistrationObservation[]; available: boolean;
} {
  if (!object(raw) || !Array.isArray(raw.registrations)) throw new Error("Lanes returned invalid manager registrations.");
  let available = true;
  const registrations: ResourceRegistrationObservation[] = [];
  for (const warning of Array.isArray(raw.warnings) ? raw.warnings : []) {
    warnings.push(`Lanes manager discovery: ${text(warning?.message) ? warning.message : String(warning)}`);
    // Preserve valid explicit registrations but avoid fallback over unknown state.
    if (["invalid_registration", "invalid_registry", "duplicate_project_id"].includes(warning?.kind)) available = false;
  }
  for (const entry of raw.registrations) {
    if (!object(entry) || !object(entry.project) || !text(entry.project.path) ||
        !text(entry.lane_id) || !object(entry.actor) || !text(entry.actor.session_id) ||
        !text(entry.actor.runtime) || !["working", "stopped"].includes(entry.status) ||
        !object(entry.availability) || !["available", "unavailable"].includes(entry.availability.status) ||
        entry.actor.host !== undefined && !text(entry.actor.host) ||
        entry.actor.workspace_id !== undefined && !text(entry.actor.workspace_id)) {
      available = false;
      warnings.push("A malformed Lane manager registration was excluded; legacy fallback is disabled for this observation.");
      continue;
    }
    registrations.push({
      projectRoot: entry.project.path,
      laneRef: entry.lane_id.startsWith("#") ? entry.lane_id : `#${entry.lane_id}`,
      managerId: entry.actor.session_id, runtime: entry.actor.runtime,
      status: entry.status, available: entry.availability.status === "available",
      ...(entry.actor.host === undefined ? {} : { hostId: entry.actor.host }),
      ...(entry.actor.workspace_id === undefined ? {} : { workspaceId: entry.actor.workspace_id }),
    });
  }
  return { registrations, available };
}

/** Read each project once through the canonical CLI; never interpret journals. */
export async function discoverResourceTargets(
  paseo: Paseo,
  options: ResourceTargetOptions,
): Promise<{ targets: ResourceTarget[]; warnings: string[] }> {
  const warnings: string[] = [];
  const results = await Promise.allSettled([localProjects(paseo), listWorkspaces(paseo), listAgents(paseo)] as const);
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") warnings.push(`Cannot observe ${["Lanes projects", "Paseo workspaces", "Paseo agents"][index]}: ${errorText(result.reason)}`);
  }
  const [projectResult, workspaceResult, agentResult] = results;
  if (projectResult.status !== "fulfilled" || workspaceResult.status !== "fulfilled" || agentResult.status !== "fulfilled") {
    return { targets: [], warnings };
  }
  const projects = projectResult.value;
  if (!projects.length) return { targets: [], warnings };
  let cli;
  try { cli = await findClips(paseo); }
  catch (error) { return { targets: [], warnings: [...warnings, `Cannot resolve Lanes CLI: ${errorText(error)}`] }; }
  let registrations: ResourceRegistrationObservation[] = [];
  let registrationsAvailable = false;
  try {
    const result = await execCommand(cli.bin, [...cli.prefix, "lane", "manager", "list", "--all", "--json"], {
      cwd: projects[0].root, timeout: 10_000,
    });
    const parsed = registrationsFrom(JSON.parse(result.stdout), warnings);
    registrations = parsed.registrations;
    registrationsAvailable = parsed.available;
  } catch (error) {
    warnings.push(`Cannot read Lane manager registrations; fallback is disabled: ${errorText(error)}`);
  }
  const observations: ResourceProjectObservation[] = [];
  // Avoid launching another burst of CLI subprocesses on an already busy host.
  for (const project of projects) {
    try {
      const result = await execCommand(cli.bin, [...cli.prefix, "board", "--json"], { cwd: project.root, timeout: 10_000 });
      const raw: unknown = JSON.parse(result.stdout);
      if (!object(raw) || !Array.isArray(raw.lanes) || !Array.isArray(raw.goals)) throw new Error("Invalid Lanes board response.");
      const board = normalizeBoard(raw);
      warnings.push(...board.warnings.map((warning) => `${project.label}: ${warning}`));
      observations.push({ ...project, projectLabel: project.label, board });
    } catch (error) {
      warnings.push(`Cannot route resources for ${project.label}: ${errorText(error)}`);
    }
  }
  const routed = routeResourceTargets({
    projects: observations, workspaces: workspaceResult.value, agents: agentResult.value,
    registrations, registrationsAvailable,
  }, options);
  return { targets: routed.targets, warnings: [...warnings, ...routed.warnings] };
}
