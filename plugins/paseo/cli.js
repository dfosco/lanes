#!/usr/bin/env node
import { createPaseoApi } from "@getpaseo/client";
// This exported adapter is also used by Paseo's native CLI; keep the SDK version pinned.
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FULL_ACCESS_MODE, resolvePermissionMode } from "./shared/permission-modes.ts";
import { branchName, branchPrefix, matchesWorkspace, executionFor, isActiveAgent, promptFor, workspaceTitle } from "./shared/work.ts";

import { acquireLaunchLock } from "./server/launch-lock.ts";
import { assertUnclaimed, launchLaneManager } from "./server/lane-managers.ts";

const pluginRoot = path.dirname(fileURLToPath(import.meta.url));
const runtimePluginId = JSON.parse(readFileSync(path.join(pluginRoot, "paseo-plugin.json"), "utf8")).id;
const localClipsCli = path.resolve(pluginRoot, "../../src/cli.js");
const help = `Lanes Paseo CLI

Usage:
  node plugins/paseo/cli.js options --project <path> [--provider <provider[/model]>]
  node plugins/paseo/cli.js start --project <path> --ref <lanes-ref> --provider <provider/model> [options]
  node plugins/paseo/cli.js resources --manager <agent-id> [--action status|reserve|report|release] [--watch]
  node plugins/paseo/cli.js handoff --manager <agent-id> --agent <dev-id> --context-file <path> [--reason completed|resource_warning|resource_critical|reassignment]
  node plugins/paseo/cli.js fold --manager <agent-id> --agent <dev-id> [--handoff-id <uuid>]

Resource channel:
  --count <N> --request-id <id>  Reserve measured headroom (shared across managers)
  --reservation <id> --agents <id,id>  Report native agents started against a grant
  --reservation <id>           Release an unused reservation
  --watch                      Stream status/inbox updates every 15 seconds
  --handoff-id <uuid>           Idempotent handoff; fold acknowledges this Goal-attached context
  Normal folds require a complete handoff and an idle dev. Critical folds close
  immediately without waiting for context, then attach an incomplete emergency note.

Options:
  --thinking <id>              Provider-supported reasoning level
  --speed <fast|normal|id>     Provider speed choice, resolved from discovered features
  --permission <restricted|full-access>
                                Select a matching provider mode; defaults to full-access
  --mode <id>                   Select an exact provider mode ID from options
  --feature <id=value>         Additional provider feature; repeatable
  --workspace <id>             Add the agent to an existing workspace
  --base <branch>              Base branch for a new worktree; defaults to current branch
  --host-id <observed-id>       Required for Lane manager starts; same host ID shown by the app
  --role <id>                  Launch with a plugin-owned role (ordered live candidates)
  --approve-metered            Approve a metered role candidate for this launch only
  --plugin-id <id>             Plugin ID for role RPCs (default: this checkout's paseo-plugin.json; or LANES_PAESO_PLUGIN_ID)
  --title <text>               Agent title
  --url <ws-url>               Paseo daemon WebSocket URL (default ws://127.0.0.1:6767/ws)
  --json                       Print structured output
  --dry-run                    Show resolved action/config without creating anything
  --help                       Show this help

Environment:
  PASEO_WS_URL, PASEO_PASSWORD, LANES_CLI_PATH (legacy CLIPS_CLI_PATH)
`;

function parseArgs(argv) {
  const command = argv[0] && !argv[0].startsWith("-") ? argv.shift() : "help";
  const options = { features: [] };
  while (argv.length) {
    const flag = argv.shift();
    if (flag === "--help" || flag === "-h") return { command: "help", options };
    if (flag === "--json" || flag === "--dry-run" || flag === "--watch" || flag === "--approve-metered") {
      options[flag.slice(2)] = true;
      continue;
    }
    if (!flag?.startsWith("--")) throw new Error(`Unexpected argument: ${flag}`);
    const key = flag.slice(2);
    const value = argv.shift();
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
    if (key === "feature") options.features.push(value);
    else options[key] = value;
  }
  return { command, options };
}

function fail(message) {
  throw new Error(message);
}

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function gitCommonDir(root) {
  return realpathSync(git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
}

function clipsCommand() {
  const override = (process.env.LANES_CLI_PATH || process.env.CLIPS_CLI_PATH)?.trim();
  if (override) {
    return override.endsWith(".js")
      ? { bin: process.execPath, prefix: [path.resolve(override)] }
      : { bin: override, prefix: [] };
  }
  if (existsSync(localClipsCli)) return { bin: process.execPath, prefix: [localClipsCli] };
  fail("The matching Lanes CLI is missing. Keep the full repository checkout or set LANES_CLI_PATH explicitly.");
}

function readBoard(root) {
  const cli = clipsCommand();
  try {
    return JSON.parse(execFileSync(cli.bin, [...cli.prefix, "board", "--json"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
    }));
  } catch (error) {
    const stderr = error?.stderr?.toString?.().trim();
    fail(`Cannot read the Lanes board: ${stderr || error.message}`);
  }
}

function findTarget(board, ref) {
  const lane = (board.lanes ?? []).find((entry) => entry.ref === ref);
  if (lane) return { kind: "lane", ref, title: lane.title, status: lane.status };
  for (const goal of board.goals ?? []) {
    if (goal.ref === ref) return { kind: "goal", ref, title: goal.title, status: goal.status };
    const task = (goal.tasks ?? []).find((entry) => entry.ref === ref);
    if (task) return { kind: "task", ref, title: task.title, status: task.status };
  }
  return null;
}

function splitProvider(value) {
  const [provider, ...modelParts] = value.split("/");
  return { provider, model: modelParts.join("/") };
}

function speedFeature(features) {
  return features.find((feature) => /\b(speed|fast)\b/i.test(`${feature.id} ${feature.label}`.replace(/[_-]+/g, " "))) ?? null;
}

function speedValue(feature, requested) {
  if (!feature) fail("The selected provider/model does not expose a speed setting.");
  const value = requested.trim().toLowerCase();
  if (feature.type === "toggle") {
    if (["fast", "on", "true", "enabled"].includes(value)) return true;
    if (["normal", "default", "off", "false", "disabled"].includes(value)) return false;
    fail(`Use --speed fast or --speed normal for the ${feature.label} toggle.`);
  }
  const options = feature.options ?? [];
  const exact = options.find((option) => option.id.toLowerCase() === value || option.label.toLowerCase() === value);
  if (exact) return exact.id;
  if (value === "fast") {
    const fast = options.find((option) => /\bfast\b/i.test(`${option.id} ${option.label}`));
    if (fast) return fast.id;
  }
  if (["normal", "default"].includes(value)) {
    const normal = options.find((option) => option.isDefault || /\b(normal|default|standard)\b/i.test(`${option.id} ${option.label}`));
    if (normal) return normal.id;
  }
  fail(`Unknown speed value ${requested}. Choose: ${options.map((option) => `${option.id} (${option.label})`).join(", ")}.`);
}

function parseFeatureValues(values) {
  const out = {};
  for (const value of values) {
    const splitAt = value.indexOf("=");
    if (splitAt <= 0) fail(`Invalid --feature ${value}. Use --feature id=value.`);
    const id = value.slice(0, splitAt);
    const raw = value.slice(splitAt + 1);
    if (Object.hasOwn(out, id)) fail(`Provider feature ${id} was supplied more than once.`);
    out[id] = raw === "true" ? true : raw === "false" ? false : raw;
  }
  return out;
}

function validateFeatureValues(features, values) {
  for (const [id, value] of Object.entries(values)) {
    const feature = features.find((item) => item.id === id);
    if (!feature) fail(`Provider feature ${id} is not available for this model.`);
    const valid = feature.type === "toggle"
      ? typeof value === "boolean"
      : typeof value === "string" && feature.options.some((option) => option.id === value);
    if (!valid) fail(`Value ${String(value)} is not valid for provider feature ${id}.`);
  }
}

async function providerOptions(client, cwd, agent, thinkingOptionId) {
  const snapshot = await client.providers.snapshot({ cwd });
  if (!agent.includes("/")) {
    const entries = snapshot.entries.filter((entry) => entry.status === "ready" && entry.enabled !== false &&
      (!agent || entry.provider === agent));
    return { providers: entries.map((entry) => ({
      provider: entry.provider,
      label: entry.label ?? entry.provider,
      defaultModeId: entry.defaultModeId ?? null,
      permissionModes: entry.modes ?? [],
      models: (entry.models ?? []).filter((model) => model.isSelectable !== false).map((model) => ({
        id: model.id,
        label: model.label,
        thinkingOptions: model.thinkingOptions ?? [],
        defaultThinkingOptionId: model.defaultThinkingOptionId ?? null,
      })),
    })) };
  }
  const { provider, model: modelId } = splitProvider(agent);
  const entry = snapshot.entries.find((candidate) => candidate.provider === provider && candidate.status === "ready" && candidate.enabled !== false);
  const model = entry?.models?.find((candidate) => candidate.id === modelId && candidate.isSelectable !== false);
  if (!entry || !model) fail(`Provider/model ${agent} is not ready on this Paseo host.`);
  if (thinkingOptionId && !model.thinkingOptions?.some((option) => option.id === thinkingOptionId)) {
    fail(`Thinking option ${thinkingOptionId} is unavailable for ${agent}.`);
  }
  const features = await client.providers.listFeatures({
    provider: agent,
    cwd,
    ...(thinkingOptionId || model.defaultThinkingOptionId ? { thinkingOptionId: thinkingOptionId || model.defaultThinkingOptionId } : {}),
  });
  const modes = await client.providers.listModes(provider, { cwd });
  return {
    provider: agent,
    thinkingOptions: model.thinkingOptions ?? [],
    defaultThinkingOptionId: model.defaultThinkingOptionId ?? null,
    features: features.features ?? [],
    featureError: features.error ?? null,
    permissionModes: modes.modes?.length ? modes.modes : entry.modes ?? [],
    defaultModeId: entry.defaultModeId ?? null,
    modeError: modes.error ?? null,
  };
}

async function allWorkspaces(client) {
  const out = [];
  let cursor;
  for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
    const page = await client.workspaces.list({ page: { limit: 200, cursor } });
    out.push(...page.entries.map((workspace) => ({
      id: workspace.id,
      projectId: workspace.projectId,
      name: workspace.title || workspace.name,
      branch: workspace.gitRuntime?.currentBranch ?? "",
      status: workspace.status,
    })));
    if (!page.pageInfo.hasMore) return out;
    cursor = page.pageInfo.nextCursor ?? undefined;
    if (!cursor) fail("Paseo workspace listing did not return a continuation cursor.");
  }
  fail("Too many Paseo workspaces to inspect safely.");
}

async function allAgents(client) {
  const out = [];
  let cursor;
  for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
    const page = await client.agents.list({ page: { limit: 200, cursor } });
    out.push(...page.entries.map(({ agent }) => ({
      id: agent.id,
      workspaceId: agent.workspaceId || null,
      status: agent.status,
      requiresAttention: agent.requiresAttention ?? false,
      attentionReason: agent.attentionReason ?? null,
      labels: agent.labels ?? {},
    })));
    if (!page.pageInfo.hasMore) return out;
    cursor = page.pageInfo.nextCursor ?? undefined;
    if (!cursor) fail("Paseo agent listing did not return a continuation cursor.");
  }
  fail("Too many Paseo agents to inspect safely.");
}

async function clipsProjectIds(client, root) {
  const common = gitCommonDir(root);
  const { projects } = await client.projects.list();
  const matches = projects.filter((project) => project.projectKind === "git" && project.projectRootPath).filter((project) => {
    try { return gitCommonDir(project.projectRootPath) === common; } catch { return false; }
  });
  if (!matches.length) fail("Add this Git project to Paseo before starting Lanes work.");
  return matches.map((project) => project.projectId);
}

function managerCommand(root, action, ref, request) {
  const cli = clipsCommand();
  const args = [...cli.prefix, "lane", "manager", action, ref];
  if (request) args.push(JSON.stringify(request));
  args.push("--json");
  return JSON.parse(execFileSync(cli.bin, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
}

export async function start(client, options, driver) {
  // Dry-run is read-only. Live launches share the daemon handler's repository/ref lock.
  if (options["dry-run"]) return startUnlocked(client, options, driver);
  const root = path.resolve(options.project ?? process.cwd());
  if (!options.ref) fail("start requires --ref <lanes-ref>.");
  const release = acquireLaunchLock(root, options.ref);
  try { return await startUnlocked(client, options, driver); }
  finally { release(); }
}

async function manualLaunch(client, root, options, target, agent) {
  const prompt = promptFor(target);
  const { provider, model: modelId } = splitProvider(agent);
  const snapshot = await client.providers.snapshot({ cwd: root });
  const entry = snapshot.entries.find((candidate) => candidate.provider === provider && candidate.status === "ready" && candidate.enabled !== false);
  const model = entry?.models?.find((candidate) => candidate.id === modelId && candidate.isSelectable !== false);
  if (!entry || !model) fail(`Provider/model ${agent} is not ready on this Paseo host.`);
  if (options.mode && options.permission) fail("Use either --mode or --permission, not both.");
  const requestedMode = options.mode ?? options.permission ?? FULL_ACCESS_MODE;
  const discoveredModes = await client.providers.listModes(provider, { cwd: root });
  const permissionModes = discoveredModes.modes?.length ? discoveredModes.modes : entry.modes ?? [];
  const selectedMode = resolvePermissionMode(requestedMode, permissionModes, entry.defaultModeId);
  if (!selectedMode) {
    const available = permissionModes.map((mode) => mode.id + " (" + mode.label + ")").join(", ");
    const reason = discoveredModes.error ? " Paseo mode discovery failed: " + discoveredModes.error : "";
    fail("Permission mode " + requestedMode + " is unavailable for " + agent + "." + reason +
      (available ? " Choose one of: " + available + "." : " This provider exposes no permission modes."));
  }
  if (options.thinking && !model.thinkingOptions?.some((option) => option.id === options.thinking)) {
    fail(`Thinking option ${options.thinking} is unavailable for ${agent}.`);
  }
  const featuresResult = await client.providers.listFeatures({
    provider: agent,
    cwd: root,
    ...(options.thinking ? { thinkingOptionId: options.thinking } : {}),
  });
  const features = featuresResult.features ?? [];
  if ((options.speed || options.features.length) && featuresResult.error) {
    fail(`Paseo could not discover provider features: ${featuresResult.error}`);
  }
  const featureValues = parseFeatureValues(options.features);
  if (options.speed) {
    const feature = speedFeature(features);
    if (!feature) fail(`Provider/model ${agent} does not expose a speed setting.`);
    const selectedSpeed = speedValue(feature, options.speed);
    if (Object.hasOwn(featureValues, feature.id) && featureValues[feature.id] !== selectedSpeed) {
      fail(`--speed conflicts with --feature ${feature.id}=${String(featureValues[feature.id])}.`);
    }
    featureValues[feature.id] = selectedSpeed;
  }
  validateFeatureValues(features, featureValues);
  const config = {
    provider: agent,
    modeId: selectedMode.id,
    ...(options.thinking ? { thinkingOptionId: options.thinking } : {}),
    ...(Object.keys(featureValues).length ? { featureValues } : {}),
  };
  return { prompt, config };
}

/** Role launches are validated, ordered and composed by the plugin host; the CLI never copies its rules. */
function pluginIdFor(options) {
  const explicit = (options["plugin-id"] || process.env.LANES_PAESO_PLUGIN_ID || "").trim();
  if (explicit) return explicit;
  return JSON.parse(readFileSync(path.join(pluginRoot, "paseo-plugin.json"), "utf8")).id;
}

async function roleLaunch(driver, root, projectId, target, agent, options) {
  if (!driver?.invokePluginRpc) fail("Role launches need the Paseo daemon connection.");
  const featureValues = parseFeatureValues(options.features);
  const resolution = await driver.invokePluginRpc(pluginIdFor(options), "clips.agent-roles.resolve", {
    roleId: options.role,
    projectId,
    workPrompt: promptFor(target),
    ...(agent ? { agentConfig: {
      provider: agent,
      ...(options.thinking ? { thinkingOptionId: options.thinking } : {}),
      ...(options.mode || options.permission ? { modeId: options.mode ?? options.permission } : {}),
      featureValues,
    } } : {}),
    ...(options["approve-metered"] ? { approveMetered: true } : {}),
  });
  return { config: resolution.config, prompt: resolution.prompt, roleResolution: resolution };
}

async function startUnlocked(client, options, driver) {
  const root = path.resolve(options.project ?? process.cwd());
  const ref = options.ref;
  const agent = options.provider;
  if (!ref) fail("start requires --ref <lanes-ref>.");
  if (!options.role && !agent?.includes("/")) fail("start requires an exact --provider <provider/model> value, or --role <id>.");
  if (options.role && options.speed) fail("--speed is not supported with --role; pass the provider feature with --feature id=value.");

  const board = readBoard(root);
  const target = findTarget(board, ref);
  if (!target) fail(`Lanes reference ${ref} does not exist in ${root}.`);
  if (["closed", "not_planned", "duplicate"].includes(target.status)) {
    fail(`${ref} is ${target.status}; reopen it in Lanes before starting an agent.`);
  }
  const managerClaim = target.kind === "lane" ? managerCommand(root, "inspect", ref) : null;
  if (managerClaim) {
    assertUnclaimed(managerClaim);
    if (!options["host-id"]?.trim()) fail("Lane manager starts require --host-id <observed-host-id>, including --dry-run. Use the same observed Paseo host ID as the app, never a URL or hostname guess.");
  }
  const manual = options.role ? null : await manualLaunch(client, root, options, target, agent);
  const projectIds = await clipsProjectIds(client, root);
  const { config, prompt, roleResolution } = manual
    ? { ...manual, roleResolution: null }
    : await roleLaunch(driver, root, projectIds[0], target, agent, options);
  const [workspaces, agents] = await Promise.all([allWorkspaces(client), allAgents(client)]);
  let workspace;
  if (options.workspace) {
    workspace = workspaces.find((candidate) => candidate.id === options.workspace);
    if (!workspace || !projectIds.includes(workspace.projectId)) {
      fail("Choose a Paseo workspace that belongs to this Lanes project.");
    }
  } else {
    const matching = workspaces.filter((candidate) => matchesWorkspace(candidate, target, projectIds));
    if (matching.length > 1) {
      fail(`More than one Lanes workspace matches ${ref}. Pass --workspace <id> to choose one.`);
    }
    workspace = matching[0];
  }

  const current = executionFor(target, projectIds, workspaces, agents);
  const active = current.agents.filter(isActiveAgent);
  if (active.length || current.status === "attention") {
    fail(`Work ${ref} already has active or input-blocked execution: ${active.map((entry) => `${entry.id} in ${entry.workspaceId}`).join(", ") || current.workspaceId}. Go to that agent before launching again.`);
  }

  let branch = workspace?.branch || "";
  let action = workspace ? "start-agent-in-workspace" : "create-worktree-and-agent";
  if (!workspace) {
    const prefix = branchPrefix(target);
    const branches = git(root, ["branch", "--format=%(refname:short)"]).split("\n").filter(Boolean);
    const orphan = branches.find((candidate) => candidate === prefix || candidate.startsWith(`${prefix}-`));
    if (orphan) fail(`Branch ${orphan} exists without a Paseo workspace. Reattach or remove it before starting another agent.`);
    branch = branchName(target);
    const baseBranch = options.base || git(root, ["branch", "--show-current"]);
    if (!baseBranch) fail("The selected Lanes project checkout is detached from a Git branch.");
    workspace = { name: workspaceTitle(target), branch, projectId: projectIds[0] };
    workspace.baseBranch = baseBranch;
  }

  const plan = {
    action,
    project: root,
    ref,
    title: target.title,
    workspaceId: workspace.id ?? null,
    workspace: workspace.name,
    branch,
    ...(workspace.baseBranch ? { baseBranch: workspace.baseBranch } : {}),
    config,
    labels: { "clips.ref": ref, "clips.projectId": projectIds[0], "clips.kind": target.kind },
    prompt,
    ...(managerClaim ? { managerClaim, hostId: options["host-id"] } : {}),
    ...(roleResolution ? { role: {
      id: roleResolution.role.id, name: roleResolution.role.name, revision: roleResolution.role.revision,
      source: roleResolution.source, selectedIndex: roleResolution.selectedIndex,
      composition: roleResolution.composition, attempts: roleResolution.attempts,
    } } : {}),
  };
  if (options["dry-run"]) return plan;

  if (!workspace.id) {
    workspace = await client.workspaces.create({
      title: workspaceTitle(target),
      source: { kind: "worktree", cwd: root, action: "branch-off", branchName: branch, baseBranch: workspace.baseBranch },
    });
  } else {
    workspace = client.workspaces.ref(workspace.id);
  }
  try {
    const creation = { config, title: options.title || `Lanes ${ref}`, labels: plan.labels };
    const created = managerClaim
      ? await launchLaneManager({
        ref, hostId: options["host-id"], claim: managerClaim, prompt,
        createIdle: () => workspace.agents.create(creation),
        claimOwner: (request) => managerCommand(root, "claim", ref, request),
      })
      : await workspace.agents.create({ ...creation, prompt });
    return { ...plan, action: "started", workspaceId: created.workspaceId ?? workspace.id, agentId: created.id };
  } catch (error) {
    if (plan.action === "create-worktree-and-agent") {
      fail(`Workspace ${workspace.id} was created on ${branch}, but its agent could not start: ${error.message}`);
    }
    throw error;
  }
}

function print(value, json) {
  if (json || typeof value === "object") {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${value}\n`);
}

/** The authenticated plugin channel is available even while a manager is busy. */
export async function resourceCommand(driver, command, options) {
  if (!options.manager?.trim()) fail(`${command} requires --manager <observed-agent-id>.`);
  if (options["dry-run"]) fail("Resource commands do not support --dry-run; use resources --action status for a read-only observation.");
  if (options.watch && command !== "resources") fail("--watch supports resource status only.");
  let method, input;
  if (command === "resources") {
    const action = options.action || "status";
    if (options.watch && action !== "status") fail("--watch supports resource status only.");
    method = "clips.resources.channel";
    input = {
      managerId: options.manager, action,
      ...(options.count === undefined ? {} : { count: Number(options.count) }),
      ...(options["request-id"] ? { requestId: options["request-id"] } : {}),
      ...(options.reservation ? { reservationId: options.reservation } : {}),
      ...(options.agents ? { agentIds: options.agents.split(",").map((id) => id.trim()) } : {}),
    };
  } else {
    if (!options.agent?.trim()) fail(`${command} requires --agent <observed-dev-id>.`);
    input = { managerId: options.manager, agentId: options.agent,
      ...(options["handoff-id"] ? { handoffId: options["handoff-id"] } : {}) };
    if (command === "handoff") {
      if (!options["context-file"]) fail("handoff requires --context-file containing the developer's latest context.");
      const context = readFileSync(path.resolve(options["context-file"]), "utf8");
      if (!context.trim() || context.length > 64 * 1024) fail("Handoff context must contain 1–65,536 characters.");
      input = { ...input, context, reason: options.reason || "completed" };
      method = "clips.resources.handoff";
    } else method = "clips.resources.fold";
  }
  return driver.invokePluginRpc(runtimePluginId, method, input);
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === "help" || options.help) {
    process.stdout.write(help);
    return;
  }
  if (!["options", "start", "resources", "handoff", "fold"].includes(command)) fail(`Unknown command ${command}.\n\n${help}`);
  const root = path.resolve(options.project ?? process.cwd());
  const url = options.url || process.env.PASEO_WS_URL || "ws://127.0.0.1:6767/ws";
  const driver = new DaemonClient({ url, clientId: `lanes-cli-${randomUUID()}`, clientType: "cli",
    ...(process.env.PASEO_PASSWORD ? { password: process.env.PASEO_PASSWORD } : {}),
    reconnect: { enabled: false }, connectTimeoutMs: 10000 });
  const client = createPaseoApi(driver);
  await driver.connect();
  try {
    if (["resources", "handoff", "fold"].includes(command)) {
      let previous;
      do {
        const result = await resourceCommand(driver, command, options);
        const serialized = JSON.stringify(result);
        if (serialized !== previous) { print(result, true); previous = serialized; }
        if (!options.watch) return;
        await new Promise((resolve) => setTimeout(resolve, 15000));
      } while (true);
    }
    if (command === "options") {
      const result = await providerOptions(client, root, options.provider ?? "", options.thinking);
      print(result, true);
      return;
    }
    const result = await start(client, options, driver);
    if (options["dry-run"]) {
      print(result, true);
      return;
    }
    print(options.json ? result : `Started agent ${result.agentId} for ${result.ref} in workspace ${result.workspaceId}.`, options.json);
  } finally {
    client.dispose();
    await driver.close();
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
