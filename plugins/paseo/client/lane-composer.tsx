import type { PluginClientContext, PluginComposerPillContribution, PluginButtonContentProps } from "@getpaseo/plugin/client";
import { createElement } from "react";
import { LaneComposerPopover } from "./lane-environment";

type AgentPage = Awaited<ReturnType<PluginClientContext["paseo"]["agents"]["list"]>>;
type Agent = AgentPage["entries"][number]["agent"];

function ComposerContent(props: PluginButtonContentProps) {
  if (props.context !== "agent") return null;
  return createElement(LaneComposerPopover, {
    theme: props.theme, host: props.host, workspaceId: props.workspaceId, agentId: props.agentId, close: props.close,
  });
}

function contribution(agent: Agent): PluginComposerPillContribution | null {
  if (!agent.workspaceId || agent.status === "closed") return null;
  return {
    id: "lanes-workspace",
    workspaceId: agent.workspaceId,
    agentId: agent.id,
    button: {
      title: "Lanes workspace controls",
      label: "Lanes",
      icon: "ListTodo",
      behavior: { kind: "popover", Content: ComposerContent },
    },
  };
}

/** Register one Lanes composer pill for each live agent, updating/removing exact registrations on host changes. */
export function registerLaneComposerPills(client: Pick<PluginClientContext, "paseo" | "addComposerPill">): () => void {
  const registrations = new Map<string, ReturnType<PluginClientContext["addComposerPill"]>>();
  let disposed = false;
  let releaseSubscription: (() => Promise<unknown>) | undefined;
  let refreshGeneration = 0;

  const refresh = async () => {
    const generation = ++refreshGeneration;
    try {
      const agents: Agent[] = [];
      let cursor: string | undefined;
      for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
        const page = await client.paseo.agents.list({ page: { limit: 200, cursor } });
        agents.push(...page.entries.map(({ agent }) => agent));
        if (!page.pageInfo.hasMore) break;
        cursor = page.pageInfo.nextCursor ?? undefined;
        if (!cursor) throw new Error("Paseo agent listing lost its pagination cursor.");
        if (pageIndex === 99) throw new Error("Paseo agent listing exceeds the supported page limit.");
      }
      if (disposed || generation !== refreshGeneration) return;
      const eligible = new Map(agents.flatMap((agent) => {
        const item = contribution(agent);
        return item ? [[agent.id, item] as const] : [];
      }));
      for (const [agentId, registration] of registrations) {
        if (!eligible.has(agentId)) { registration.remove(); registrations.delete(agentId); }
      }
      for (const [agentId, item] of eligible) {
        if (!registrations.has(agentId)) registrations.set(agentId, client.addComposerPill(item));
      }
    } catch {
      // Keep existing pills during a temporary host listing failure; never fall through to another host.
    }
  };

  void refresh();
  void (async () => {
    try {
      const observed = await client.paseo.agents.list({ subscribe: {}, page: { limit: 200 } });
      if (disposed) { await observed.subscription.release(); return; }
      releaseSubscription = () => observed.subscription.release();
      const invalidate = () => { if (!disposed) void refresh(); };
      observed.subscription.subscribe({ snapshot: invalidate, update: invalidate });
      void refresh();
    } catch {
      // Initial refresh still registers current sessions; workspace panels remain available as a fallback.
    }
  })();

  return () => {
    disposed = true;
    refreshGeneration += 1;
    for (const registration of registrations.values()) registration.remove();
    registrations.clear();
    if (releaseSubscription) void releaseSubscription();
  };
}
