
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createResourceManager } from "./server/resource-manager";
import { resourceManagerPreferences, resourceManagerStatusRpc } from "./shared/resource-manager";
import {
  agentOptionsRpc, attachmentReadRpc, boardRpc, collaborationRpc, labelUsesRpc, labelsRpc,
  roleModelDefaultsRpc, saveRoleModelDefaultsRpc, reviewListRpc, reviewOpenRpc, reviewShowRpc, reviewDecideRpc, reviewImportRpc,
  closeRpc, preferences, projectsRpc, startRpc,
} from "./shared/contracts";
import {
  closeWork, changeProjectLabels, projectList, readAgentOptions, readProjectAttachment,
  readProjectBoard, readProjectLabelUses, setProjectCollaboration, startWork,
  readRoleModelDefaults, saveRoleModelDefaults, readProjectReviews, readProjectReview, openProjectReview, decideProjectReview, importProjectReviewDecision,
} from "./server/backend";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(preferences);
  const resourceSettings = server.registerSettings(resourceManagerPreferences);
  const resources = createResourceManager({ readSettings: async () => {
    const state = await resourceSettings.read();
    if (state.status !== "ready") throw new Error(`Resource manager settings are invalid: ${state.error}`);
    return state.values;
  } });
  const unsubscribeSettings = resourceSettings.subscribe(() => resources.settingsChanged());
  // SDK 0.11.2 first supplies its subprocess-owned API through a hook or RPC.
  // Sampling starts immediately; notification discovery waits for that context.
  const releases = [
    server.before("agent.session_open", (_input, { paseo }) => { resources.bind(paseo); }),
    ...(["agent.created", "agent.closed", "agent.turn_started", "agent.turn_ended", "agent.permission_requested",
      "agent.permission_resolved", "agent.archived", "workspace.created", "workspace.archived"] as const)
      .map((event) => server.on(event, (_event, { paseo }) => { resources.bind(paseo); })),
  ];
  const handle: PluginServerContext["handle"] = (contract, handler) => server.handle(contract, (input, context) => {
    resources.bind(context.paseo);
    return handler(input, context);
  });
  handle(resourceManagerStatusRpc, () => resources.status());
  handle(projectsRpc, (_input, { paseo }) => projectList(paseo));
  handle(boardRpc, (input, { paseo }) => readProjectBoard(paseo, input.projectId));
  handle(attachmentReadRpc, (input, { paseo }) => readProjectAttachment(paseo, input));
  handle(collaborationRpc, (input, { paseo }) => setProjectCollaboration(paseo, input));
  handle(agentOptionsRpc, (input, { paseo }) => readAgentOptions(paseo, input));
  handle(roleModelDefaultsRpc, async (input, { paseo }) => {
    const state = await settings.read();
    const values = state.status === "ready" ? state.values : preferences.schema.parse({});
    return readRoleModelDefaults(paseo, input.role, values, {
      projectId: input.projectId, legacyDisabled: input.legacyDisabled || values.roles[input.role].legacyModelMigrated,
    });
  });
  handle(saveRoleModelDefaultsRpc, (input, { paseo }) => saveRoleModelDefaults(paseo, input));
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
    resources.dispose();
    unsubscribeSettings();
    for (const release of releases) release();
  };
}
