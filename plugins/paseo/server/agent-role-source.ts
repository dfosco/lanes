import { AgentRoleError, type AgentRoleDefinition } from "../shared/agent-roles";

/** Minimal read contract satisfied by the SDK settings handle for the `agent-roles` settings. */
export type RolesReader = {
  read(): Promise<
    | { status: "ready"; revision: string; values: { roles: AgentRoleDefinition[] } }
    | { status: "invalid"; revision: string; error: string }
  >;
};

let registered: RolesReader | null = null;
export function setAgentRoleSource(reader: RolesReader | null): void {
  registered = reader;
}

/** Launch roles come only from the registered host settings; a missing or invalid store fails the role request. */
export async function loadAgentRoles(reader: RolesReader | null = registered): Promise<{ revision: string; roles: AgentRoleDefinition[] }> {
  if (!reader) throw new AgentRoleError("unavailable", "Agent roles are not registered on this host.");
  const state = await reader.read();
  if (state.status !== "ready") throw new AgentRoleError("unavailable", `Agent role settings are invalid: ${state.error}`);
  return { revision: state.revision, roles: state.values.roles };
}
