import { describe, expect, it } from "vitest";
import {
  AgentRoleError, agentRoleDefinition, applyRoleChange, builtInRoleIds, builtInRoles,
  composeRoleSystemPrompt, hasRoleMarker, roleMarker, saveRoleChange, agentRolesSettings, responsibilityType,
  type AgentRolesValues, type RolesStore, type RolesStoreState, type RolesStoreWrite,
} from "./agent-roles";

const base = (): AgentRolesValues => ({ roles: builtInRoles() });
const custom = {
  id: "reviewer", name: "Reviewer", description: "", instructions: "Review carefully.",
  skills: ["lane-dev"],
};

describe("role schema", () => {
  it("accepts optional instructions and skills and deduplicates skill references", () => {
    const parsed = agentRoleDefinition.parse({ id: "x", name: "X", skills: ["a", "a", "b"] });
    expect(parsed.instructions).toBe("");
    expect(parsed.skills).toEqual(["a", "b"]);
    expect(parsed.revision).toBe(1);
  });

  it("rejects invalid IDs and control-character names", () => {
    expect(() => agentRoleDefinition.parse({ id: "Bad_ID", name: "x" })).toThrow();
    expect(() => agentRoleDefinition.parse({ id: "ok", name: "bad\u0007name" })).toThrow();
    expect(() => agentRoleDefinition.parse({ id: "manager", name: "Reserved" })).toThrow(/reserved/);
    expect(() => agentRoleDefinition.parse({ id: "dev", name: "Reserved" })).toThrow(/reserved/);
  });

  it("settings default to the built-in roles and tolerate unrelated keys", () => {
    const parsed = agentRolesSettings.schema.parse({ other: 1 });
    expect(parsed.roles.map((role) => role.id)).toEqual(builtInRoleIds);
    expect(parsed).toMatchObject({ other: 1 });
  });

  it("reads legacy role settings with guidance intact and strips retired launch-policy fields in memory", () => {
    const parsed = agentRolesSettings.schema.parse({ roles: [{
      id: "legacy-role", name: "Legacy role", description: "Keep this", revision: 3,
      instructions: "Preserve this guidance.", skills: ["lane-dev"],
      candidates: [{ agent: "claude/old-model", metered: true }],
      quota: { maxUsagePct: 92, maxAgeMinutes: 30, whenUnknown: "allow" },
    }] });
    expect(parsed.roles[0]).toMatchObject({ id: "legacy-role", description: "Keep this", revision: 3,
      instructions: "Preserve this guidance.", skills: ["lane-dev"] });
    expect(parsed.roles[0]).not.toHaveProperty("candidates");
    expect(parsed.roles[0]).not.toHaveProperty("quota");
  });

  it("infers planner/worker responsibility for legacy role data without rewriting it", () => {
    const legacyManager = { id: "lane-manager", name: "Old Manager" };
    const legacyCustom = { id: "constructor", name: "Constructor" };
    expect(agentRoleDefinition.parse(legacyManager).type).toBeUndefined();
    expect(responsibilityType(legacyManager)).toBe("planner");
    expect(responsibilityType(legacyCustom)).toBe("worker");
    expect(agentRoleDefinition.parse({ ...legacyCustom, type: "planner" }).type).toBe("planner");
    expect(() => agentRoleDefinition.parse({ ...legacyCustom, type: "coordinator" })).toThrow();
  });
});

describe("built-in roles", () => {
  it("ship the required roles with instruction-free presets", () => {
    expect(builtInRoleIds).toEqual(["lane-manager", "lane-dev", "design-engineer", "deep-reasoning", "fast-implementation"]);
    const byId = Object.fromEntries(builtInRoles().map((role) => [role.id, role]));
    expect(byId["lane-manager"].type).toBe("planner");
    expect(byId["lane-dev"].type).toBe("worker");
    expect(byId["design-engineer"].name).toBe("UX Engineer");
    expect(byId["design-engineer"].id).toBe("design-engineer");
    expect(byId["design-engineer"].type).toBe("worker");
    expect(byId["design-engineer"].instructions).toContain("design engineer");
    expect(byId["deep-reasoning"].instructions).toBe("");
    expect(byId["deep-reasoning"].skills).toEqual([]);
    expect(byId["fast-implementation"].instructions).toBe("");
    expect(byId["lane-manager"].skills).toEqual(["lane-manager"]);
    expect(byId["lane-dev"].skills).toEqual(["lane-dev"]);
  });
});

describe("CRUD transitions", () => {
  it("creates a role and leaves every other role unchanged", () => {
    const before = base();
    const next = applyRoleChange(before, { action: "create", role: custom });
    expect(next.roles).toHaveLength(before.roles.length + 1);
    expect(next.roles.find((role) => role.id === "reviewer")).toMatchObject({ revision: 1, skills: ["lane-dev"] });
    expect(next.roles.filter((role) => role.id !== "reviewer")).toEqual(before.roles);
  });

  it("rejects duplicate IDs and duplicate names, case-insensitively", () => {
    expect(() => applyRoleChange(base(), { action: "create", role: { ...custom, id: "lane-dev" } }))
      .toThrow(AgentRoleError);
    expect(() => applyRoleChange(base(), { action: "create", role: { ...custom, name: "LANE DEV" } }))
      .toThrow(/Duplicate role name/);
  });

  it("advances revision only for changed content and preserves unrelated settings keys", () => {
    const start = applyRoleChange({ ...base(), extra: "kept" } as AgentRolesValues, { action: "create", role: custom });
    const same = applyRoleChange(start, { action: "update", role: { ...custom } });
    expect(same.roles.find((role) => role.id === "reviewer")?.revision).toBe(1);
    expect((same as Record<string, unknown>).extra).toBe("kept");
    const changed = applyRoleChange(start, { action: "update", role: { ...custom, instructions: "Different." } });
    expect(changed.roles.find((role) => role.id === "reviewer")?.revision).toBe(2);
  });

  it("removes and resets roles with explicit not-found errors", () => {
    const removed = applyRoleChange(base(), { action: "remove", id: "design-engineer" });
    expect(removed.roles.map((role) => role.id)).not.toContain("design-engineer");
    expect(() => applyRoleChange(base(), { action: "remove", id: "missing" })).toThrow(/does not exist/);
    expect(() => applyRoleChange(base(), { action: "update", role: custom })).toThrow(/does not exist/);
    const reset = applyRoleChange(removed, { action: "reset", id: "design-engineer" });
    expect(reset.roles.find((role) => role.id === "design-engineer")).toBeDefined();
    expect(() => applyRoleChange(base(), { action: "reset", id: "reviewer" })).toThrow(/not a built-in/);
  });
});

/** An in-memory settings store with SDK-style revisions, conflicts and readback. */
function memoryStore(initial: AgentRolesValues, options: { dropOnWrite?: boolean } = {}) {
  let values: AgentRolesValues = initial;
  let revision = 1;
  const store: RolesStore & { current: () => AgentRolesValues; bump: () => void } = {
    async read(): Promise<RolesStoreState> {
      return { status: "ready", revision: String(revision), values };
    },
    async write(next, expected): Promise<RolesStoreWrite> {
      if (expected !== String(revision)) return { status: "conflict", error: "Roles changed elsewhere." };
      values = options.dropOnWrite ? { ...next, roles: next.roles.slice(1) } : next;
      revision += 1;
      return { status: "saved", revision: String(revision) };
    },
    current: () => values,
    bump: () => { revision += 1; },
  };
  return store;
}

describe("revision-safe persistence", () => {
  it("writes, reads back and returns the persisted collection", async () => {
    const store = memoryStore(base());
    const result = await saveRoleChange(store, { action: "create", role: custom });
    expect(result.roles.map((role) => role.id)).toContain("reviewer");
    expect(store.current().roles.map((role) => role.id)).toContain("reviewer");
  });

  it("rejects stale writes instead of overwriting newer roles", async () => {
    const store = memoryStore(base());
    store.bump();
    await expect(saveRoleChange(store, { action: "create", role: custom }, { expectedRevision: "1" }))
      .rejects.toMatchObject({ code: "stale" });
    expect(store.current().roles.map((role) => role.id)).not.toContain("reviewer");
  });

  it("surfaces readback mismatches as explicit errors", async () => {
    const store = memoryStore(base(), { dropOnWrite: true });
    await expect(saveRoleChange(store, { action: "create", role: custom })).rejects.toMatchObject({ code: "readback" });
  });

  it("reports invalid persisted state without guessing", async () => {
    const store: RolesStore = {
      read: async () => ({ status: "invalid", revision: "2", error: "corrupt" }),
      write: async () => ({ status: "saved", revision: "3" }),
    };
    await expect(saveRoleChange(store, { action: "remove", id: "x" })).rejects.toMatchObject({ code: "unavailable" });
  });
});

describe("system prompt composition", () => {
  const role = agentRoleDefinition.parse(custom);
  const skill = { id: "lane-dev", scope: "user" as const, path: "/home/me/.agents/skills/lane-dev/SKILL.md", sha256: "x", bytes: 9, content: "LANE DEV BODY" };

  it("creates a system prompt from instructions and actual skill content, never a names-only claim", () => {
    const composed = composeRoleSystemPrompt(role, [skill]);
    expect(composed).toContain(roleMarker(role));
    expect(composed).toContain("Review carefully.");
    expect(composed).toContain("LANE DEV BODY");
    expect(composed).toContain(skill.path);
  });

  it("preserves an existing caller systemPrompt by composing after it", () => {
    const composed = composeRoleSystemPrompt(role, [skill], "Caller policy stays first.");
    expect(composed?.startsWith("Caller policy stays first.")).toBe(true);
    expect(composed).toContain("LANE DEV BODY");
  });

  it("is idempotent when the role block is already present", () => {
    const once = composeRoleSystemPrompt(role, [skill], "Caller");
    expect(composeRoleSystemPrompt(role, [skill], once)).toBe(once);
    expect(once?.split(roleMarker(role))).toHaveLength(2);
  });

  it("returns the caller value unchanged for instruction-free presets and no value when none is given", () => {
    const preset = agentRoleDefinition.parse({ id: "fast", name: "Fast" });
    expect(composeRoleSystemPrompt(preset, [])).toBeUndefined();
    expect(composeRoleSystemPrompt(preset, [], "Caller")).toBe("Caller");
  });

  it("marker detection is specific to the role and revision-independent", () => {
    expect(hasRoleMarker("[Lanes role: reviewer r7] text", { id: "reviewer" })).toBe(true);
    expect(hasRoleMarker("[Lanes role: reviewer-2 r1]", { id: "reviewer" })).toBe(false);
  });
});
