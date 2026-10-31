import os from "node:os";
import type { PluginServerContext, PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  AgentRoleError, agentRolesSettings, builtInRoleIds, roleCatalogRpc, roleResolveRpc, rolesListRpc,
} from "../shared/agent-roles";
import { type AgentRole, type Preferences } from "../shared/contracts";
import { readProviderCatalog, type ConfigureOverride } from "./agent-roles";
import { setAgentRoleSource, type RolesReader } from "./agent-role-source";
import { roleLaunch } from "./backend";

type Paseo = PluginHandlerContext["paseo"];

/** Registers host-scoped role settings, the list/catalog/resolve RPCs and the launch role source. Returns a disposer. */
export function registerAgentRoles(server: PluginServerContext, options: {
  /** Current Lanes preference values (defaults already applied). Required for launch resolution. */
  readPreferences: () => Promise<Preferences>;
}): () => void {
  const settings = server.registerSettings(agentRolesSettings);
  const reader = settings as unknown as RolesReader;
  setAgentRoleSource(reader);
  server.handle(rolesListRpc, async () => {
    const state = await reader.read();
    if (state.status !== "ready") throw new AgentRoleError("unavailable", `Agent role settings are invalid: ${state.error}`);
    return { revision: state.revision, roles: state.values.roles, builtInIds: [...builtInRoleIds] };
  });
  server.handle(roleCatalogRpc, async (input, { paseo }) => readProviderCatalog(paseo, await cwdFor(paseo, input.projectId)));
  server.handle(roleResolveRpc, async (input, { paseo }) => {
    const state = await reader.read();
    if (state.status !== "ready") throw new AgentRoleError("unavailable", `Agent role settings are invalid: ${state.error}`);
    const prefs = await options.readPreferences();
    const root = await cwdFor(paseo, input.projectId);
    // The launch kind decides which role preference applies; a role resolution asked directly is a dev launch.
    const kind: AgentRole = "dev";
    const override: ConfigureOverride | undefined = input.agentConfig ? {
      provider: input.agentConfig.provider,
      ...(input.agentConfig.thinkingOptionId ? { thinkingOptionId: input.agentConfig.thinkingOptionId } : {}),
      featureValues: input.agentConfig.featureValues ?? {},
      ...(input.agentConfig.modeId ? { modeId: input.agentConfig.modeId } : {}),
    } : undefined;
    return roleLaunch(paseo, prefs, {
      root, projectId: input.projectId ?? "", kind, roleId: input.roleId, roles: state.values.roles,
      workPrompt: input.workPrompt ?? "", agentConfig: override, approveMetered: input.approveMetered,
    });
  });
  return () => { setAgentRoleSource(null); };
}

export async function cwdFor(paseo: Paseo, projectId?: string): Promise<string> {
  if (!projectId) return os.homedir();
  const { projects } = await paseo.projects.list();
  const project = projects.find((item) => item.projectId === projectId);
  return project?.projectRootPath ?? os.homedir();
}

