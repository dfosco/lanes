import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentRolesSettings, builtInRoles, roleMarker } from "./shared/agent-roles";
import { laneEnvironmentSettings } from "./shared/lane-environment";
import { preferences } from "./shared/contracts";
import contribute from "./index.server";

describe("server creation role integration", () => {
  let root = "";
  let priorLanesHome: string | undefined;
  let capturedLanesHome = false;
  const disposers: Array<() => void> = [];
  const roots: string[] = [];

  afterEach(async () => {
    while (disposers.length) disposers.pop()!();
    if (capturedLanesHome) {
      if (priorLanesHome === undefined) delete process.env.LANES_HOME;
      else process.env.LANES_HOME = priorLanesHome;
    }
    capturedLanesHome = false;
    priorLanesHome = undefined;
    for (const candidate of roots.splice(0)) await fs.rm(candidate, { recursive: true, force: true });
    root = "";
    vi.restoreAllMocks();
  });

  async function harness(options: { invalidRoles?: boolean; missingRoleSkill?: boolean; environmentFailure?: boolean; firstManager?: boolean } = {}) {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "lanes-server-create-"));
    const workspaceRoot = root;
    roots.push(workspaceRoot);
    if (!capturedLanesHome) {
      priorLanesHome = process.env.LANES_HOME;
      capturedLanesHome = true;
    }
    process.env.LANES_HOME = path.join(root, "lanes-home");
    const skillPath = path.join(workspaceRoot, ".agents", "skills", "lane-manager", "SKILL.md");
    await fs.mkdir(path.dirname(skillPath), { recursive: true });
    await fs.writeFile(skillPath, "ACTUAL LANE MANAGER SKILL BODY");

    const order: string[] = [];
    const before = new Map<string, (input: any, context: any) => Promise<unknown>>();
    const handlers = new Map<string, (input: any, context: any) => Promise<unknown>>();
    const server: any = {
      registerSettings(definition: { id: string; schema: { parse(value: unknown): unknown } }) {
        order.push(`settings:${definition.id}`);
        return {
          read: async () => {
            if (definition.id === "agent-roles" && options.invalidRoles) return { status: "invalid", revision: "2", error: "broken role settings" };
            if (definition.id === "preferences") return { status: "ready", revision: "1", values: preferences.schema.parse({}) };
            if (definition.id === "agent-roles") {
              const roles = builtInRoles().map((role) => role.id === "lane-manager" && options.missingRoleSkill
                ? { ...role, skills: ["lane-manager-required-skill-not-installed"] }
                : role);
              return { status: "ready", revision: "1", values: agentRolesSettings.schema.parse({ roles }) };
            }
            if (definition.id === "lane-environment") {
              if (options.environmentFailure) return { status: "invalid", revision: "1", error: "broken environment settings" };
              return {
                status: "ready", revision: "1",
                values: laneEnvironmentSettings.parse({
                  firstAgentManager: options.firstManager ?? true,
                  workspaces: { ws1: { enabled: true } },
                }),
              };
            }
            return { status: "ready", revision: "1", values: definition.schema.parse({}) };
          },
          subscribe: () => () => undefined,
        };
      },
      handle(contract: { name: string }, handler: (input: any, context: any) => Promise<unknown>) {
        handlers.set(contract.name, handler);
      },
      before(name: string, handler: (input: any, context: any) => Promise<unknown>) {
        order.push(`before:${name}`);
        before.set(name, handler);
        return () => before.delete(name);
      },
      on(name: string, handler: (event: any, context: any) => unknown) {
        return () => undefined;
      },
    };
    disposers.push(contribute(server));
    const paseo = {
      workspaces: {
        list: async () => ({ entries: [{ id: "ws1", workspaceDirectory: workspaceRoot }], pageInfo: { hasMore: false } }),
      },
    };
    return { before: before.get("agent.create")!, order, paseo, handlers, root: workspaceRoot };
  }

  it("registers role settings before the direct creation hook and composes actual manager skill content", async () => {
    const setup = await harness();
    expect(setup.order.indexOf("settings:agent-roles")).toBeLessThan(setup.order.indexOf("before:agent.create"));
    const request = { config: { cwd: setup.root, title: "Ship it", provider: "openai/gpt-6-luna", systemPrompt: "CALLER SYSTEM" } };
    const result = await setup.before({ request }, { paseo: setup.paseo });
    expect(result).toMatchObject({
      config: {
        title: "🧭 Ship it",
        provider: "openai/gpt-6-luna",
      },
    });
    const systemPrompt = (result as typeof request).config.systemPrompt!;
    expect(systemPrompt).toContain("CALLER SYSTEM");
    expect(systemPrompt).toContain("Act as the Lane Manager for this work.");
    expect(systemPrompt).toContain("ACTUAL LANE MANAGER SKILL BODY");
    expect(systemPrompt.match(/\[Lanes role: lane-manager r1\]/g)).toHaveLength(1);
    expect(request.config.systemPrompt).toBe("CALLER SYSTEM");
  });

  it("preserves an already composed manager marker exactly once", async () => {
    const setup = await harness();
    const existing = `CALLER\n\n${roleMarker(builtInRoles()[0])} Lane Manager\n\nSKILL ALREADY INCLUDED`;
    const result = await setup.before({ request: { config: { cwd: setup.root, title: "Ship it", systemPrompt: existing } } }, { paseo: setup.paseo });
    expect((result as { config: { systemPrompt: string } }).config.systemPrompt).toBe(existing);
    expect(existing.match(/\[Lanes role: lane-manager r1\]/g)).toHaveLength(1);
  });

  it("does not overwrite an explicit non-manager role or elect it as manager", async () => {
    const setup = await harness();
    const existing = "CALLER\n\n[Lanes role: lane-dev r4] Lane Dev";
    const result = await setup.before({ request: { config: { cwd: setup.root, title: "Implement", systemPrompt: existing } } }, { paseo: setup.paseo });
    expect(result).toBeUndefined();
  });

  it("fails visibly and rolls back the claim when role settings or a required skill are unavailable", async () => {
    const invalid = await harness({ invalidRoles: true });
    await expect(invalid.before({ request: { config: { cwd: invalid.root, title: "Ship it" } } }, { paseo: invalid.paseo }))
      .rejects.toThrow(/role settings are invalid: broken role settings/);

    const missingSkill = await harness({ missingRoleSkill: true });
    await expect(missingSkill.before({ request: { config: { cwd: missingSkill.root, title: "Ship it" } } }, { paseo: missingSkill.paseo }))
      .rejects.toThrow(/Required skill lane-manager-required-skill-not-installed could not be resolved/);
  });

  it("leaves direct creation in manual mode when manager election is disabled or settings are invalid", async () => {
    const disabled = await harness({ firstManager: false });
    const unchanged = { config: { cwd: disabled.root, title: "Manual", systemPrompt: "manual prompt" } };
    expect(await disabled.before({ request: unchanged }, { paseo: disabled.paseo })).toBeUndefined();

    const brokenSettings = await harness({ environmentFailure: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await brokenSettings.before({ request: { config: { cwd: brokenSettings.root, title: "Manual" } } }, { paseo: brokenSettings.paseo })).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Lanes manager election skipped"));
  });

  it("does not leave a pending manager claim when creation preparation fails", async () => {
    const setup = await harness({ invalidRoles: true });
    await expect(setup.before({ request: { config: { cwd: setup.root, title: "Ship it" } } }, { paseo: setup.paseo }))
      .rejects.toThrow(/broken role settings/);
    const status = await setup.handlers.get("clips.lane-environment.status")!({ workspaceId: "ws1" }, { paseo: setup.paseo });
    expect(status.workspace.pendingManager).toBeNull();
  });
});
