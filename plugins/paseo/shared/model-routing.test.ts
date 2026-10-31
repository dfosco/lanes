import { describe, expect, it } from "vitest";
import { orderedRoleRoutes } from "./model-routing";
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
