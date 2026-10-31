import fs from "node:fs";
import path from "node:path";
import { execCommand, type PluginHandlerContext } from "@getpaseo/plugin/server";

type Paseo = PluginHandlerContext["paseo"];
export type ClipsCommand = { bin: string; prefix: string[] };

/** Server bundles are evaluated as CommonJS, without a source-file URL. Resolve
 * the installed checkout through the public SDK, after Paseo moves staging. */
export async function findClips(paseo: Paseo): Promise<ClipsCommand> {
  const override = (process.env.LANES_CLI_PATH || process.env.CLIPS_CLI_PATH)?.trim();
  let binary = override;
  if (!binary) {
    const { config } = await paseo.config.get();
    const roots = new Set<string>();
    for (const source of Object.values(config.plugins ?? {})) {
      if (source.source !== "directory" || source.enabled === false) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(source.path, "paseo-plugin.json"), "utf8"));
        // Keep locating installations made before the runtime ID was renamed.
        if (manifest.id === "lanes" || manifest.id === "clips-workspaces") roots.add(fs.realpathSync(source.path));
      } catch {
        // Other plugins and stale directories cannot identify this installation.
      }
    }
    if (roots.size !== 1) {
      throw new Error(`Cannot identify the Lanes plugin checkout (${roots.size} enabled sources). Set LANES_CLI_PATH explicitly when the source is missing or ambiguous.`);
    }
    binary = path.resolve([...roots][0], "../../src/cli.js");
  }
  const candidate = binary.endsWith(".js")
    ? { bin: process.execPath, prefix: [path.resolve(binary)] }
    : { bin: binary, prefix: [] };
  try {
    await execCommand(candidate.bin, [...candidate.prefix, "--version"], { timeout: 60_000 });
  } catch (error) {
    const detail = (error as { stderr?: string })?.stderr?.trim() || String(error);
    throw new Error(`${override ? "LANES_CLI_PATH/CLIPS_CLI_PATH" : "The plugin checkout's Lanes CLI"} cannot run: ${detail}. Ensure the full repository and its locked production dependencies are installed.`);
  }
  return candidate;
}
