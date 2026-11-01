import { describe, expect, it } from "vitest";
import { entryReasoningEffort, orderedRoleRoutes, roleRouteAgents } from "./model-routing";
import type { ModelRoutingPolicy } from "./contracts";

const policy: ModelRoutingPolicy = {
  version: 1,
  providerOrder: ["claude", "opencode"],
  modelOrder: {
    manager: ["opencode/openai/gpt-6.1-sol", "claude/sonnet"],
    dev: ["opencode/openai/gpt-6-luna", "opencode/openai/gpt-6-terra", "codex/gpt-6-luna"],
  },
  reasoningEffortOrder: ["low", "medium", "high"],
  warningThresholds: [80, 90],
  handoffThreshold: 95,
};

describe("ordered provider/model routing", () => {
  it("uses provider priority first and role model order within each provider", () => {
    expect(orderedRoleRoutes(policy, "dev")).toEqual([
      { provider: "claude", models: [] },
      { provider: "opencode", models: ["openai/gpt-6-luna", "openai/gpt-6-terra"] },
      { provider: "codex", models: ["gpt-6-luna"] },
    ]);
  });

  it("derives provider priority from model order when no provider order was saved", () => {
    expect(orderedRoleRoutes({ ...policy, providerOrder: [] }, "manager")).toEqual([
      { provider: "opencode", models: ["openai/gpt-6.1-sol"] },
      { provider: "claude", models: ["sonnet"] },
    ]);
  });
});

describe("per-entry reasoning effort", () => {
  const withEffort: ModelRoutingPolicy = { ...policy, modelEffort: { manager: { "claude/sonnet": "high" }, dev: {} } };
  const efforts = ["low", "medium", "high"];
  it("prefers the effort chosen on the ranked entry when the model still offers it", () => {
    expect(entryReasoningEffort(withEffort, "manager", "claude", "sonnet", efforts, "low", "medium")).toBe("high");
  });
  it("ignores an entry effort the model no longer offers and falls back to the role default", () => {
    expect(entryReasoningEffort(withEffort, "manager", "claude", "sonnet", ["low", "medium"], "low", "medium")).toBe("low");
  });
  it("only applies an entry effort to the role and model it was saved for", () => {
    expect(entryReasoningEffort(withEffort, "dev", "claude", "sonnet", efforts, "medium", "low")).toBe("medium");
    expect(entryReasoningEffort(withEffort, "manager", "opencode", "sonnet", efforts, "medium", "low")).toBe("medium");
  });
  it("keeps custom role routes and efforts isolated from Lane Dev", () => {
    const custom: ModelRoutingPolicy = {
      ...policy,
      modelOrder: { ...policy.modelOrder, reviewer: ["claude/sonnet"] },
      modelEffort: { dev: { "claude/sonnet": "high" }, reviewer: { "claude/sonnet": "low" } },
    };
    expect(roleRouteAgents(custom, "reviewer")).toEqual([{ agent: "claude/sonnet", effort: "low" }]);
    expect(roleRouteAgents({ ...custom, modelEffort: { dev: { "claude/sonnet": "high" } } }, "reviewer"))
      .toEqual([{ agent: "claude/sonnet" }]);
    expect(roleRouteAgents(custom, "unranked-role")).toEqual([]);
  });
  it("treats valid prototype-named custom roles as ordinary isolated keys", () => {
    expect(roleRouteAgents(policy, "constructor")).toEqual([]);
    const custom: ModelRoutingPolicy = {
      ...policy,
      modelOrder: { ...policy.modelOrder, constructor: ["claude/sonnet"] },
      modelEffort: { constructor: { "claude/sonnet": "high" } },
    };
    expect(roleRouteAgents(custom, "constructor")).toEqual([{ agent: "claude/sonnet", effort: "high" }]);
    expect(roleRouteAgents({ ...custom, modelEffort: {} }, "constructor")).toEqual([{ agent: "claude/sonnet" }]);
    expect(roleRouteAgents(custom, "dev")).toEqual(roleRouteAgents(policy, "dev"));
  });
  it("keeps the previous default resolution when no entry effort is saved", () => {
    expect(entryReasoningEffort(policy, "dev", "codex", "m", ["low", "high"], "medium", "low")).toBe("low");
    expect(entryReasoningEffort(policy, "dev", "codex", "m", ["max"], "ultra", "max")).toBe("max");
    expect(entryReasoningEffort(policy, "dev", "codex", "m", [], "high", null)).toBe("");
  });
});
