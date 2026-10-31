import { describe, expect, it } from "vitest";
import { agentOptionsTarget } from "./agent-options";

describe("provider-specific option queries", () => {
  it("skips model-specific queries for Automatic instead of sending a provider-only ID", () => {
    expect(agentOptionsTarget("claude", "", "claude/sonnet")).toBe("");
  });

  it("queries options for an exact qualified model after selection", () => {
    expect(agentOptionsTarget("claude", "claude/sonnet", "claude/sonnet")).toBe("claude/sonnet");
    expect(agentOptionsTarget("opencode", "openai/gpt-6-luna", "codex/gpt-6-luna", ["openai/gpt-6-luna"]))
      .toBe("opencode/openai/gpt-6-luna");
  });

  it("ignores a stale selection belonging to another provider", () => {
    expect(agentOptionsTarget("claude", "codex/gpt-6-luna", "claude/sonnet", ["sonnet"])).toBe("");
  });

  it("retains the existing unscoped launch fallback", () => {
    expect(agentOptionsTarget(undefined, "", "codex/gpt-6-luna")).toBe("codex/gpt-6-luna");
  });
});
