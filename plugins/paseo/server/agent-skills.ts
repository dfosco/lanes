import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentRoleError, SKILL_REF_PATTERN, type ResolvedSkillContent } from "../shared/agent-roles";

/** Bounded skill content: a skill file larger than this is rejected rather than truncated. */
export const MAX_SKILL_BYTES = 64 * 1024;

export type SkillRoot = { scope: "workspace" | "user"; dir: string };

/** The only roots searched: the project workspace's `.agents/skills` and the user's `~/.agents/skills`. */
export function defaultSkillRoots(cwd: string, home: string = os.homedir()): SkillRoot[] {
  return [
    { scope: "workspace", dir: path.join(cwd, ".agents", "skills") },
    { scope: "user", dir: path.join(home, ".agents", "skills") },
  ];
}

/**
 * Resolve each skill reference to its SKILL.md content, once. The first root wins for a name. Two references
 * that resolve to the same file, or to identical content, are included once. A missing required skill fails with
 * the searched locations; nothing is reported as loaded unless its content was read.
 */
export function resolveSkills(refs: readonly string[], roots: readonly SkillRoot[]): ResolvedSkillContent[] {
  const out: ResolvedSkillContent[] = [];
  const seenFiles = new Set<string>();
  const seenContent = new Set<string>();
  for (const id of new Set(refs)) {
    if (!SKILL_REF_PATTERN.test(id)) throw new AgentRoleError("invalid", `Invalid skill reference ${JSON.stringify(id)}; use a lowercase skill directory name.`);
    const searched: string[] = [];
    let found: ResolvedSkillContent | null = null;
    for (const root of roots) {
      const candidate = path.join(root.dir, id, "SKILL.md");
      searched.push(candidate);
      if (!fs.existsSync(candidate)) continue;
      const real = fs.realpathSync(candidate);
      const stat = fs.statSync(real);
      if (!stat.isFile()) throw new AgentRoleError("invalid", `Skill ${id} at ${real} is not a regular file.`);
      if (stat.size > MAX_SKILL_BYTES) throw new AgentRoleError("invalid", `Skill ${id} at ${real} is larger than ${MAX_SKILL_BYTES} bytes.`);
      const content = fs.readFileSync(real, "utf8");
      found = {
        id, scope: root.scope, path: real, bytes: Buffer.byteLength(content),
        sha256: createHash("sha256").update(content).digest("hex"), content,
      };
      break;
    }
    if (!found) {
      throw new AgentRoleError("skill_missing", `Required skill ${id} could not be resolved. Searched: ${searched.join(", ") || "no roots"}.`);
    }
    if (seenFiles.has(found.path) || seenContent.has(found.sha256)) continue;
    seenFiles.add(found.path);
    seenContent.add(found.sha256);
    out.push(found);
  }
  return out;
}
