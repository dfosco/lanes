import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { findClips } from "./clips-cli";

const command = vi.hoisted(() => vi.fn(async () => ({ stdout: "1.8.0" })));
vi.mock("@getpaseo/plugin/server", () => ({ execCommand: command }));
let root: string;
let previous: string | undefined;
let previousCanonical: string | undefined;
beforeEach(() => {
  previous = process.env.CLIPS_CLI_PATH;
  previousCanonical = process.env.LANES_CLI_PATH;
  delete process.env.CLIPS_CLI_PATH;
  delete process.env.LANES_CLI_PATH;
  command.mockClear();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "clips-cli-source-"));
});
afterEach(() => {
  if (previous === undefined) delete process.env.CLIPS_CLI_PATH;
  else process.env.CLIPS_CLI_PATH = previous;
  if (previousCanonical === undefined) delete process.env.LANES_CLI_PATH;
  else process.env.LANES_CLI_PATH = previousCanonical;
  fs.rmSync(root, { recursive: true, force: true });
});
function source(name: string, id = "lanes", enabled = true) {
  const directory = path.join(root, name, "plugins/paseo");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "paseo-plugin.json"), JSON.stringify({ id }));
  return { source: "directory" as const, path: directory, enabled };
}
function sdk(plugins = {}) {
  return { config: { get: async () => ({ config: { plugins } }) } } as Parameters<typeof findClips>[0];
}
it("uses the configured relocated checkout and ignores disabled or unrelated sources", async () => {
  const installed = source("final-location");
  const result = await findClips(sdk({ customRuntimeId: installed, old: source("old", "clips-workspaces", false), other: source("other", "different") }));
  expect(result).toEqual({ bin: process.execPath, prefix: [path.resolve(fs.realpathSync(installed.path), "../../src/cli.js")] });
  expect(command).toHaveBeenCalledWith(result.bin, [...result.prefix, "--version"], { timeout: 60_000 });
});
it("still recognizes an enabled installation using the previous runtime ID", async () => {
  const installed = source("legacy-install", "clips-workspaces");
  const result = await findClips(sdk({ legacy: installed }));
  expect(result.prefix).toEqual([path.resolve(fs.realpathSync(installed.path), "../../src/cli.js")]);
});
it("rejects missing and ambiguous configured sources without trying PATH", async () => {
  await expect(findClips(sdk())).rejects.toThrow("0 enabled sources");
  await expect(findClips(sdk({ a: source("a"), b: source("b") }))).rejects.toThrow("2 enabled sources");
  expect(command).not.toHaveBeenCalled();
});
it("honors explicit overrides even without config discovery", async () => {
  process.env.CLIPS_CLI_PATH = path.join(root, "explicit.js");
  expect(await findClips({} as Parameters<typeof findClips>[0])).toEqual({ bin: process.execPath, prefix: [process.env.CLIPS_CLI_PATH] });
});
it("prefers canonical CLI overrides over legacy ones without falling back after failure", async () => {
  process.env.CLIPS_CLI_PATH = path.join(root, "legacy.js");
  process.env.LANES_CLI_PATH = path.join(root, "canonical.js");
  expect(await findClips(sdk())).toEqual({ bin: process.execPath, prefix: [process.env.LANES_CLI_PATH] });
  command.mockRejectedValueOnce(new Error("invalid canonical executable"));
  await expect(findClips(sdk())).rejects.toThrow("invalid canonical executable");
  expect(command).toHaveBeenCalledTimes(2);
});
it("reports a broken root dependency closure without falling back to PATH", async () => {
  command.mockRejectedValueOnce({ stderr: "ERR_MODULE_NOT_FOUND: Cannot find package 'skillshop'" } as never);
  await expect(findClips(sdk({ only: source("broken") }))).rejects.toThrow("skillshop");
  expect(command).toHaveBeenCalledTimes(1);
});

it("runs the standalone CLI through a symlink or platform path alias", () => {
  const entry = path.join(root, "session-cli.js");
  fs.symlinkSync(fileURLToPath(new URL("../cli.js", import.meta.url)), entry);
  expect(execFileSync(process.execPath, [entry, "--help"], { encoding: "utf8" })).toContain("Lanes Paseo CLI");
}, 30_000);
