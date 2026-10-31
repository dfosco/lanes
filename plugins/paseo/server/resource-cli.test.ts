import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resourceCommand } from "../cli.js";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
describe("Paseo resource CLI channel", () => {
  it("uses the plugin RPC transport for status, reservations and native launch reports", async () => {
    const driver = { invokePluginRpc: vi.fn(async () => ({ available: true })) };
    await resourceCommand(driver, "resources", { manager: "m" });
    expect(driver.invokePluginRpc).toHaveBeenLastCalledWith("lanes", "clips.resources.channel", { managerId: "m", action: "status" });
    await resourceCommand(driver, "resources", { manager: "m", action: "reserve", count: "8", "request-id": "launch-1" });
    expect(driver.invokePluginRpc).toHaveBeenLastCalledWith("lanes", "clips.resources.channel", { managerId: "m", action: "reserve", count: 8, requestId: "launch-1" });
    await resourceCommand(driver, "resources", { manager: "m", action: "report", reservation: "lease", agents: "d1,d2" });
    expect(driver.invokePluginRpc).toHaveBeenLastCalledWith("lanes", "clips.resources.channel", { managerId: "m", action: "report", reservationId: "lease", agentIds: ["d1", "d2"] });
  });

  it("delivers actual context file contents and acknowledges its receipt on fold", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "lanes-resource-cli-")); directories.push(directory);
    const file = path.join(directory, "context.md"); writeFileSync(file, "Exact latest context\nincluding checks.");
    const driver = { invokePluginRpc: vi.fn(async () => ({ handoffId: "receipt" })) };
    await resourceCommand(driver, "handoff", { manager: "m", agent: "d", "context-file": file, "handoff-id": "receipt" });
    expect(driver.invokePluginRpc).toHaveBeenLastCalledWith("lanes", "clips.resources.handoff", { managerId: "m", agentId: "d", handoffId: "receipt", context: "Exact latest context\nincluding checks.", reason: "completed" });
    await resourceCommand(driver, "fold", { manager: "m", agent: "d", "handoff-id": "receipt" });
    expect(driver.invokePluginRpc).toHaveBeenLastCalledWith("lanes", "clips.resources.fold", { managerId: "m", agentId: "d", handoffId: "receipt" });
  });

  it("rejects absent identities, missing context and mutation watch loops before RPC", async () => {
    const driver = { invokePluginRpc: vi.fn() };
    await expect(resourceCommand(driver, "fold", {})).rejects.toThrow("--manager");
    await expect(resourceCommand(driver, "fold", { manager: "m" })).rejects.toThrow("--agent");
    await expect(resourceCommand(driver, "handoff", { manager: "m", agent: "d" })).rejects.toThrow("--context-file");
    await expect(resourceCommand(driver, "fold", { manager: "m", agent: "d", watch: true })).rejects.toThrow("status only");
    await expect(resourceCommand(driver, "resources", { manager: "m", action: "reserve", watch: true })).rejects.toThrow("status only");
    expect(driver.invokePluginRpc).not.toHaveBeenCalled();
  });
});
