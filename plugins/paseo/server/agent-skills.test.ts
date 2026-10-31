import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultSkillRoots, MAX_SKILL_BYTES, resolveSkills } from "./agent-skills";

let base = "";
beforeEach(() => { base = fs.mkdtempSync(path.join(os.tmpdir(), "lanes-skills-")); });
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

function writeSkill(root: string, id: string, body: string) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), body);
  return path.join(dir, "SKILL.md");
}

describe("bounded skill resolution", () => {
  it("includes actual file content once, preferring the workspace root over the user root", () => {
    const workspace = path.join(base, "repo", ".agents", "skills");
    const user = path.join(base, "home", ".agents", "skills");
    writeSkill(workspace, "lanes", "WORKSPACE lanes");
    writeSkill(user, "lanes", "USER lanes");
    writeSkill(user, "lane-dev", "USER lane-dev");
    const resolved = resolveSkills(["lanes", "lane-dev", "lanes"], [
      { scope: "workspace", dir: workspace }, { scope: "user", dir: user },
    ]);
    expect(resolved.map((skill) => [skill.id, skill.scope, skill.content])).toEqual([
      ["lanes", "workspace", "WORKSPACE lanes"], ["lane-dev", "user", "USER lane-dev"],
    ]);
    expect(resolved[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("deduplicates references that resolve to the same file or to identical content", () => {
    const root = path.join(base, "skills");
    writeSkill(root, "shared", "same body");
    fs.mkdirSync(path.join(root, "alias"));
    fs.symlinkSync(path.join(root, "shared", "SKILL.md"), path.join(root, "alias", "SKILL.md"));
    writeSkill(root, "copy", "same body");
    const resolved = resolveSkills(["shared", "alias", "copy"], [{ scope: "workspace", dir: root }]);
    expect(resolved.map((skill) => skill.id)).toEqual(["shared"]);
  });

  it("fails clearly with the searched locations when a required skill is missing", () => {
    const root = path.join(base, "skills");
    fs.mkdirSync(root, { recursive: true });
    let error: unknown;
    try { resolveSkills(["absent"], [{ scope: "workspace", dir: root }, { scope: "user", dir: path.join(base, "home") }]); }
    catch (caught) { error = caught; }
    expect(error).toMatchObject({ code: "skill_missing" });
    expect((error as Error).message).toContain("absent");
    expect((error as Error).message).toContain(path.join(root, "absent", "SKILL.md"));
    expect((error as Error).message).toContain(path.join(base, "home", "absent", "SKILL.md"));
  });

  it("rejects traversal-shaped identifiers and oversized skill files instead of reading them", () => {
    const root = path.join(base, "skills");
    writeSkill(root, "huge", "x".repeat(MAX_SKILL_BYTES + 1));
    expect(() => resolveSkills(["../escape"], [{ scope: "workspace", dir: root }])).toThrow(/Invalid skill reference/);
    expect(() => resolveSkills(["huge"], [{ scope: "workspace", dir: root }])).toThrow(/larger than/);
  });

  it("uses the workspace and user roots by default", () => {
    expect(defaultSkillRoots("/repo", "/home/me")).toEqual([
      { scope: "workspace", dir: path.join("/repo", ".agents", "skills") },
      { scope: "user", dir: path.join("/home/me", ".agents", "skills") },
    ]);
  });
});
