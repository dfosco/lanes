// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentRoleDefinition, agentRolesSettings, builtInRoles } from "../shared/agent-roles";
import { AgentRolesSettings } from "./agent-roles";

const state = vi.hoisted(() => ({
  settings: undefined as any,
  save: vi.fn(),
  reload: vi.fn(),
}));

vi.mock("@getpaseo/plugin/client", () => ({
  useSettings: (definition: { id: string }) => definition.id === "agent-roles" ? state.settings : null,
}));

vi.mock("react-native", async () => {
  const { createElement: h } = await import("react");
  return {
    ActivityIndicator: () => h("span", {}, "Loading"),
    View: ({ children, accessibilityLabel, style }: any) => h("div", { "aria-label": accessibilityLabel, style }, children),
    Text: ({ children, accessibilityLabel, accessibilityRole, style }: any) =>
      h("span", { "aria-label": accessibilityLabel, role: accessibilityRole, style }, children),
    Pressable: ({ children, accessibilityRole, accessibilityLabel, disabled, onPress }: any) =>
      h("button", { role: accessibilityRole, "aria-label": accessibilityLabel, disabled, onClick: onPress }, children),
    TextInput: ({ accessibilityLabel, value, onChangeText, placeholder, multiline }: any) => h(multiline ? "textarea" : "input", {
      "aria-label": accessibilityLabel, value, placeholder, onInput: (event: any) => onChangeText(event.currentTarget.value),
    }),
  };
});

const sampleRole = agentRoleDefinition.parse({
  id: "qa-reviewer",
  name: "QA Reviewer",
  description: "Testing role",
  instructions: "Focus on tests.",
  skills: ["lane-dev"],
  revision: 1,
});

const theme = {
  colors: {
    foreground: "#111", foregroundMuted: "#666", border: "#aaa", accent: "#44f",
    accentForeground: "#fff", surface0: "#fff", statusWarning: "#a60", statusDanger: "#b00",
  },
} as any;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  state.settings = {
    status: "ready",
    values: { roles: [sampleRole, builtInRoles()[0]!] },
    revision: "roles-r4",
    saving: false,
    saveError: null,
    save: state.save,
    reload: state.reload,
  };
  state.save.mockResolvedValue(true);
  state.reload.mockResolvedValue(undefined);
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const render = () => act(async () => {
  root.render(createElement(AgentRolesSettings, { theme, host: { id: "selected-host", label: "Selected host" } as any }));
});

const button = (label: string) => {
  const result = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((item) => item.getAttribute("aria-label") === label || item.textContent === label);
  expect(result, label).toBeTruthy();
  return result!;
};

const input = (label: string) => {
  const result = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`);
  expect(result, label).toBeTruthy();
  return result!;
};

const changeInput = (label: string, value: string) => act(async () => {
  const element = input(label);
  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
});

describe("agent roles settings", () => {
  it("renders role list and allows switching between roles", async () => {
    await render();
    expect(container.textContent).toContain("QA Reviewer");
    expect(container.textContent).toContain("planner · Lane Manager");
    expect(input("Role name").value).toBe("QA Reviewer");
    expect(input("Description").value).toBe("Testing role");

    await act(async () => { button("planner · Lane Manager").click(); });
    expect(input("Role name").value).toBe("Lane Manager");
  });

  it("edits role fields and saves", async () => {
    await render();
    expect(button("Save roles").disabled).toBe(true);

    await changeInput("Description", "Updated testing role");
    await changeInput("Skill references", "lane-dev, lane-radar");

    expect(button("Save roles").disabled).toBe(false);
    await act(async () => { button("Save roles").click(); });

    expect(state.save).toHaveBeenCalledWith(expect.objectContaining({
      roles: expect.arrayContaining([
        expect.objectContaining({
          id: "qa-reviewer",
          description: "Updated testing role",
          skills: ["lane-dev", "lane-radar"],
          revision: 2,
        }),
      ]),
    }), "roles-r4");
  });

  it("creates a new custom role with validation", async () => {
    await render();
    await changeInput("Role ID", "security-auditor");
    await changeInput("New role name", "Security Auditor");
    await act(async () => { button("Create role").click(); });

    expect(input("Role name").value).toBe("Security Auditor");
    expect(button("Save roles").disabled).toBe(false);

    await act(async () => { button("Save roles").click(); });
    expect(state.save).toHaveBeenCalledWith(expect.objectContaining({
      roles: expect.arrayContaining([
        expect.objectContaining({
          id: "security-auditor",
          name: "Security Auditor",
          type: "worker",
          revision: 1,
        }),
      ]),
    }), "roles-r4");
  });

  it("prevents creating role with duplicate or invalid ID", async () => {
    await render();
    await changeInput("Role ID", "qa-reviewer");
    await changeInput("New role name", "Duplicate Role");
    await act(async () => { button("Create role").click(); });

    expect(container.textContent).toContain("Role IDs and names must be unique.");
    expect(state.save).not.toHaveBeenCalled();
  });

  it("removes a role and updates selection", async () => {
    await render();
    await act(async () => { button("Remove role").click(); });

    expect(input("Role name").value).toBe("Lane Manager");
    expect(button("Save roles").disabled).toBe(false);

    await act(async () => { button("Save roles").click(); });
    expect(state.save).toHaveBeenCalledWith(expect.objectContaining({
      roles: [expect.objectContaining({ id: "lane-manager" })],
    }), "roles-r4");
  });

  it("restores a modified built-in role to its default", async () => {
    await render();
    await act(async () => { button("planner · Lane Manager").click(); });
    await changeInput("Description", "Altered manager description");
    expect(input("Description").value).toBe("Altered manager description");

    await act(async () => { button("Restore built-in role").click(); });
    const defaultManager = builtInRoles().find((item) => item.id === "lane-manager")!;
    expect(input("Description").value).toBe(defaultManager.description);
  });

  it("allows custom roles to choose responsibility type without changing their identity or guidance", async () => {
    await render();
    await act(async () => { button("worker").click(); });
    await changeInput("Description", "Testing role");
    await act(async () => { button("planner").click(); });
    await act(async () => { button("Save roles").click(); });
    expect(state.save).toHaveBeenCalledWith(expect.objectContaining({
      roles: expect.arrayContaining([expect.objectContaining({
        id: "qa-reviewer", name: "QA Reviewer", type: "planner", description: "Testing role", instructions: "Focus on tests.",
      })]),
    }), "roles-r4");
  });
});
