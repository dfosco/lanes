
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { composeRoleSystemPrompt, hasRoleMarker, roleHasGuidance } from "./shared/agent-roles";
import { loadAgentRoles } from "./server/agent-role-source";
import { defaultSkillRoots, resolveSkills } from "./server/agent-skills";
import { registerAgentRoles } from "./server/agent-roles-register";
import { createResourceManager } from "./server/resource-manager";
import { resourceManagerPreferences, resourceManagerStatusRpc } from "./shared/resource-manager";
import { resourceChannelRpc, resourceFoldRpc, resourceHandoffRpc } from "./shared/resource-channel";
import { createResourceFolding } from "./server/resource-folding";
import {
  laneEnvironmentAssignManagerRpc, laneEnvironmentContinueRpc, laneEnvironmentPreferences, laneEnvironmentStatusRpc,
  type LaneEnvironmentSettings,
} from "./shared/lane-environment";
import { createLaneEnvironment } from "./server/lane-environment";
import { createLaneEnvironmentStore, laneEnvironmentStateFile } from "./server/lane-environment-store";
import {
  agentOptionsRpc, attachmentReadRpc, boardRpc, collaborationRpc, labelUsesRpc, labelsRpc,
  roleModelDefaultsRpc, saveRoleModelDefaultsRpc, modelRoutingPolicyRpc, saveModelRoutingPolicyRpc,
  reviewListRpc, reviewOpenRpc, reviewShowRpc, reviewDecideRpc, reviewImportRpc,
  closeRpc, preferences, projectsRpc, startRpc,
} from "./shared/contracts";
import {
  closeWork, changeProjectLabels, projectList, readAgentOptions, readProjectAttachment,
  readProjectBoard, readProjectLabelUses, setProjectCollaboration, startWork,
  readRoleModelDefaults, saveRoleModelDefaults, readModelRoutingPolicy, saveModelRoutingPolicy,
  readProjectReviews, readProjectReview, openProjectReview, decideProjectReview, importProjectReviewDecision,
} from "./server/backend";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(preferences);
  // Register the role settings/source before the create hook can attempt to elect and compose a manager.
  const disposeAgentRoles = registerAgentRoles(server, {
    readPreferences: async () => {
      const state = await settings.read();
      if (state.status !== "ready") throw new Error(`Lanes preferences are invalid: ${state.error}`);
      return state.values;
    },
  });
  const resourceSettings = server.registerSettings(resourceManagerPreferences);
  const resources = createResourceManager({ readSettings: async () => {
    const state = await resourceSettings.read();
    if (state.status !== "ready") throw new Error(`Resource manager settings are invalid: ${state.error}`);
    return state.values;
  } });
  const folding = createResourceFolding({ target: (id) => resources.target(id), critical: () => resources.critical() });
  const unsubscribeSettings = resourceSettings.subscribe(() => resources.settingsChanged());
  const environmentSettings = server.registerSettings(laneEnvironmentPreferences);
  const laneEnvironment = createLaneEnvironment({
    store: createLaneEnvironmentStore(laneEnvironmentStateFile()),
    // Invalid saved preferences fail closed: no activation and no manager claim until they are fixed.
    settings: async (): Promise<LaneEnvironmentSettings> => {
      const state = await environmentSettings.read();
      if (state.status !== "ready") throw new Error(`Lanes environment settings are invalid: ${state.error}`);
      return state.values;
    },
    managerSystemPrompt: async (config) => {
      const existing = config.systemPrompt;
      if (existing && hasRoleMarker(existing, { id: "lane-manager" })) return existing;
      const { roles } = await loadAgentRoles();
      const role = roles.find((item) => item.id === "lane-manager");
      if (!role) throw new Error("The built-in lane-manager role is missing from host role settings; restore it before creating a manager.");
      if (!roleHasGuidance(role)) throw new Error("The lane-manager role has no instructions or skills; restore its guidance before creating a manager.");
      const skills = resolveSkills(role.skills, defaultSkillRoots(config.cwd));
      return composeRoleSystemPrompt(role, skills, existing);
    },
  });
  // SDK 0.11.2 first supplies its subprocess-owned API through a hook or RPC.
  // Sampling starts immediately; notification discovery waits for that context.
  const releases = [
    server.before("agent.session_open", (_input, { paseo }) => { resources.bind(paseo); }),
    // Lanes environment: create-before may claim the first manager; after-hooks only confirm or observe.
    server.before("agent.create", async ({ request }, { paseo }) => laneEnvironment.beforeAgentCreate(request, paseo)),
    server.on("agent.created", (event) => laneEnvironment.onAgentCreated(event.agent)),
    server.on("workspace.created", (event) => laneEnvironment.onWorkspaceCreated(event.workspace)),
    ...(["agent.created", "agent.closed", "agent.turn_started", "agent.turn_ended", "agent.permission_requested",
      "agent.permission_resolved", "agent.archived", "workspace.created", "workspace.archived"] as const)
      .map((event) => server.on(event, (payload, { paseo }) => {
        resources.bind(paseo);
        if (event === "agent.turn_started" && "agent" in payload) folding.turnStarted(payload.agent.id);
      })),
  ];
  const handle: PluginServerContext["handle"] = (contract, handler) => server.handle(contract, (input, context) => {
    resources.bind(context.paseo);
    return handler(input, context);
  });
  handle(laneEnvironmentStatusRpc, (input) => laneEnvironment.status(input.workspaceId));
  handle(laneEnvironmentAssignManagerRpc, (input, { paseo }) => laneEnvironment.assignManager(paseo, input));
  handle(laneEnvironmentContinueRpc, (input, { paseo }) => laneEnvironment.continueManager(paseo, input));
  handle(resourceManagerStatusRpc, () => resources.status());
  handle(resourceChannelRpc, async (input) => ({ ...await resources.channel(input), pendingHandoffs: folding.pending(input.managerId) }));
  handle(resourceHandoffRpc, (input, { paseo }) => folding.handoff(paseo, input));
  handle(resourceFoldRpc, (input, { paseo }) => folding.fold(paseo, input));
  handle(projectsRpc, (_input, { paseo }) => projectList(paseo));
  handle(boardRpc, (input, { paseo }) => readProjectBoard(paseo, input.projectId));
  handle(attachmentReadRpc, (input, { paseo }) => readProjectAttachment(paseo, input));
  handle(collaborationRpc, (input, { paseo }) => setProjectCollaboration(paseo, input));
  handle(agentOptionsRpc, (input, { paseo }) => readAgentOptions(paseo, input));
  handle(roleModelDefaultsRpc, async (input, { paseo }) => {
    const state = await settings.read();
    const values = state.status === "ready" ? state.values : preferences.schema.parse({});
    return readRoleModelDefaults(paseo, input.role, values, {
      provider: input.provider, projectId: input.projectId, legacyDisabled: input.legacyDisabled || values.roles[input.role].legacyModelMigrated,
    });
  });
  handle(saveRoleModelDefaultsRpc, (input, { paseo }) => saveRoleModelDefaults(paseo, input));
  handle(modelRoutingPolicyRpc, (_input, { paseo }) => readModelRoutingPolicy(paseo));
  handle(saveModelRoutingPolicyRpc, (input, { paseo }) => saveModelRoutingPolicy(paseo, input));
  handle(reviewListRpc, (input, { paseo }) => readProjectReviews(paseo, input.projectId));
  handle(reviewOpenRpc, (input, { paseo }) => openProjectReview(paseo, input));
  handle(reviewShowRpc, (input, { paseo }) => readProjectReview(paseo, input));
  handle(reviewDecideRpc, (input, { paseo }) => decideProjectReview(paseo, {
    ...input, expectedRevision: input.expectedRevision,
  }));
  handle(reviewImportRpc, (input, { paseo }) => importProjectReviewDecision(paseo, input));
  handle(closeRpc, async (input, { paseo }) => {
    let agentDefaults = preferences.schema.parse({});
    if (input.autoCompleteClosure) {
      try {
        const state = await settings.read();
        if (state.status === "ready") agentDefaults = state.values;
      } catch (error) {
        console.warn(`[paseo] Could not read Lanes agent defaults for lane retrospective: ${String(error)}`);
      }
    }
    return closeWork(paseo, agentDefaults, input);
  });
  handle(labelsRpc, (input, { paseo }) => changeProjectLabels(paseo, input));
  handle(labelUsesRpc, (input, { paseo }) => readProjectLabelUses(paseo, input));
  handle(startRpc, async (input, { paseo }) => {
    resources.bind(paseo, input.hostId);
    const state = await settings.read();
    const agentDefaults = state.status === "ready"
      ? state.values
      : preferences.schema.parse({});
    return startWork(paseo, agentDefaults, input);
  });
  return () => {
    folding.dispose();
    resources.dispose();
    unsubscribeSettings();
    disposeAgentRoles();
    for (const release of releases) release();
  };
}
