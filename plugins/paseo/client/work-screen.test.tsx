// @vitest-environment jsdom
import { act, createElement, forwardRef, useImperativeHandle } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { WorkScreen } from "./work-screen";
import { branchName } from "../shared/work";

const state = vi.hoisted(() => ({
  projects: [] as any[],
  board: { lanes: [] as any[], goals: [] as any[], warnings: [] },
  reviews: [] as any[],
  openedReview: null as any,
  runtime: { workspaces: [] as any[], agents: [] as any[] },
  runtimeError: null as Error | null,
  mutation: undefined as any,
  invalidations: [] as any[],
  readAttachment: vi.fn(),
  scrollCalls: [] as any[],
  updateCollaboration: vi.fn(),
  openUrl: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: (rpc: { name?: string }) => rpc.name === "clips.attachment.read" ? state.readAttachment
    : rpc.name === "clips.collaboration.set" ? state.updateCollaboration
    : rpc.name === "clips.review.open" ? vi.fn(async () => state.openedReview) : vi.fn(),
  useSettings: () => ({ status: "ready", values: {} }),
}));
vi.mock("@getpaseo/plugin/client/ui", () => ({
  SettingsSection: ({ title, children }: any) => createElement("section", { "aria-label": title }, children),
  SettingsCard: ({ children }: any) => createElement("div", {}, children),
  SettingsAction: ({ actionLabel, disabled, onPress }: any) => createElement("button", { disabled, onClick: onPress }, actionLabel),
  SettingsSelect: ({ label, value, options, onValueChange }: any) => createElement("label", {}, label,
    createElement("select", { "aria-label": label, value, onChange: (event: any) => onValueChange(event.target.value) },
      options.map((option: any) => createElement("option", { key: option.value, value: option.value }, option.label)))),
}));
vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: () => null,
  Modal: Object.assign(({ children, open, title }: any) => open ? createElement("div", { "aria-label": title }, children) : null, {
    Content: ({ children }: any) => createElement("div", null, children),
  }),
  TextInput: ({ accessibilityLabel, placeholder }: any) => createElement("input", { "aria-label": accessibilityLabel, placeholder }),
  useToast: () => ({ show: state.toast }),
  ScrollView: forwardRef(({ children, accessibilityLabel, style, onScroll, scrollEventThrottle }: any, ref: any) => {
    useImperativeHandle(ref, () => ({ scrollTo: (args: any) => state.scrollCalls.push(args) }));
    return createElement("section", {
    "aria-label": accessibilityLabel,
    "data-max-height": style?.maxHeight == null ? undefined : String(style.maxHeight),
    "data-display": style?.display,
    "data-flex": style?.flex,
    onScroll: onScroll ? (event: any) => onScroll({ nativeEvent: { contentOffset: { y: event.currentTarget.scrollTop } } }) : undefined,
    "data-scroll-event-throttle": scrollEventThrottle,
  }, children);
  }),
}));
vi.mock("react-native", () => ({
  View: ({ children, accessibilityRole, accessibilityLabel, style }: any) => createElement("div", {
    role: accessibilityRole,
    "aria-label": accessibilityLabel,
    "data-position": style?.position,
    "data-max-width": style?.maxWidth == null ? undefined : String(style.maxWidth),
    "data-max-height": style?.maxHeight == null ? undefined : String(style.maxHeight),
  }, children),
  Text: ({ children, accessibilityRole, accessibilityLabel, onPress, style }: any) =>
    createElement("span", { role: accessibilityRole, "aria-label": accessibilityLabel, onClick: onPress, style }, children),
  Pressable: ({ children, accessibilityLabel, accessibilityRole, accessibilityState, disabled, onPress, ["aria-selected"]: ariaSelected }: any) => createElement("button", { "aria-label": accessibilityLabel, "aria-expanded": accessibilityState?.expanded, "aria-selected": ariaSelected, role: accessibilityRole, disabled, onClick: onPress }, children),
  TextInput: ({ accessibilityLabel, value, onChangeText }: any) => createElement("input", {
    "aria-label": accessibilityLabel, value, onInput: (event: any) => onChangeText?.(event.currentTarget.value),
  }),
  Switch: () => null,
  ActivityIndicator: () => null,
  Linking: { openURL: state.openUrl },
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: any) => ({ data: queryKey[0] === "clips.projects" ? { projects: state.projects }
    : queryKey[0] === "clips.board" ? state.board
    : queryKey[0] === "clips.review.list" ? { reviews: state.reviews }
    : queryKey[0] === "clips.review.open" ? state.openedReview : undefined }),
  useQueryClient: () => ({
    invalidateQueries: async ({ queryKey }: any) => { state.invalidations.push(queryKey); },
    setQueryData: (queryKey: any[], value: any) => {
      if (queryKey[0] === "clips.board") state.board = value;
    },
  }),
  useMutation: (options: any) => {
    if (!state.mutation) state.mutation = options;
    return { isPending: false, mutate: vi.fn() };
  },
}));
vi.mock("./runtime", async (importOriginal) => ({
  ...await importOriginal<typeof import("./runtime")>(),
  useRuntime: () => ({ data: state.runtime, isError: Boolean(state.runtimeError), error: state.runtimeError }),
}));
vi.mock("./agent-configuration", () => ({ AgentLaunchDialog: () => null }));
vi.mock("./review-inbox", () => ({ ReviewInbox: ({ initialProjectId }: { initialProjectId?: string }) =>
  createElement("div", { "aria-label": "Review inbox content", "data-project-id": initialProjectId }) }));

const base = { description: "", status: "open", scope: "", plan: "", decisions: "", acceptanceCriteria: [] };
const lane = { ...base, kind: "lane", ref: "#l001", title: "Publish releases", goalRefs: ["#g001", "#g002"], productGoals: [] };
const task = { ...base, kind: "task", ref: "#g001#t01", title: "Ship package" };
const goal = { ...base, kind: "goal", ref: "#g001", title: "Package publishing", type: "building", laneId: "l001", tasks: [task] };
const outside = { ...goal, ref: "#g003", title: "Unrelated goal", tasks: [] };
const props = { host: { id: "host" }, layout: { compact: false }, theme: { colors: new Proxy({}, { get: () => "#333333" }) } } as unknown as PluginSurfaceProps;
function render(focused = true) {
  return renderToStaticMarkup(createElement(WorkScreen, { ...props, ...(focused ? { currentWorkspaceId: "w1", currentWorkspaceProjectId: "p1" } : {}) }));
}
async function mountScreen(extra: Record<string, unknown> = {}) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const previousAct = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const renderView = () => root.render(createElement(WorkScreen, {
    ...props,
    preferredProjectId: "p1",
    currentWorkspaceId: undefined,
    currentWorkspaceProjectId: undefined,
    ...extra,
  }));
  await act(async () => { renderView(); });
  return {
    container,
    rerender: async () => { await act(async () => { renderView(); }); },
    unmount: async () => {
      await act(async () => { root.unmount(); });
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = previousAct;
    },
  };
}

beforeEach(() => {
  state.projects = [
    { projectId: "p1", projectIds: ["p1"], label: "Project 1" },
    { projectId: "p2", projectIds: ["p2"], label: "Project 2" },
  ];
  state.board = { lanes: [lane], goals: [goal, outside], warnings: [] };
  state.reviews = [];
  state.openedReview = null;
  state.runtime = { workspaces: [{ id: "w1", projectId: "p1", name: "Lane work", branch: branchName(lane), status: "ready" }], agents: [] };
  state.mutation = undefined;
  state.runtimeError = null;
  state.invalidations = [];
  state.scrollCalls = [];
  state.readAttachment.mockReset();
  state.updateCollaboration.mockReset();
  state.openUrl.mockReset();
  state.toast.mockReset();
});

describe("attachments and collaboration", () => {
  it("opens pinned review as a full view with the CR body primary and restores the work surface on Back", async () => {
    const review = {
      id: "rev-11111111-1111-4111-8111-111111111111", ref: "#g001", title: "Change request",
      status: "awaiting_review", attachment_id: "cr", reviewer: "reviewer",
      candidate: { base: "base-commit", head: "head-commit", base_ref: "main", head_ref: "feature" },
      covers: ["#g001"], covered_refs: ["#g001", "#g001#t01"], summary: "Review this candidate.", validation: {},
    };
    state.reviews = [review];
    state.openedReview = {
      review: { ...review, stale: true, stale_reasons: ["candidate_head_moved"] },
      requested_ref: "#g001", path: "/project/.lanes/reviews/opened/rev-11111111-1111-4111-8111-111111111111.md",
      content_identity: { sha256: "hash" },
      markdown: "# Change request\n\n- Review ID: rev-11111111-1111-4111-8111-111111111111\n- Candidate base: base-commit\n\n---\n\n## Pinned change request\n\nPinned body. [Preview](https://example.com/preview) [Unsafe](javascript:alert(1))",
    };
    const screen = await mountScreen({ layout: { compact: true, platform: "web" } });
    try {
      await act(async () => {
        screen.container.querySelector<HTMLButtonElement>('[aria-label="Expand goal #g001"]')!.click();
      });
      expect(screen.container.querySelectorAll('button[aria-label="Review"]')).toHaveLength(2);
      const boardView = screen.container.querySelector<HTMLElement>('[aria-label="Lanes work surface"]');
      expect(boardView).not.toBeNull();
      boardView!.scrollTop = 237;
      await act(async () => { boardView!.dispatchEvent(new Event("scroll", { bubbles: true })); });

      await act(async () => {
        screen.container.querySelectorAll<HTMLButtonElement>('button[aria-label="Review"]')[0].click();
      });
      expect(screen.container.querySelector('[aria-label="Review · #g001"]')).not.toBeNull();
      expect(screen.container.querySelector('[role="dialog"]')).toBeNull();
      expect(boardView!.getAttribute("data-display")).toBe("none");
      expect(screen.container.textContent).toContain("Pinned CR snapshot · Stale · candidate_head_moved");
      expect(screen.container.textContent).not.toContain("Review ID: rev-11111111");
      expect(screen.container.textContent).not.toContain("Candidate base: base-commit");
      expect(screen.container.textContent).toContain("Pinned body.");
      expect(screen.container.textContent).not.toContain("**Pinned body.");
      expect(screen.container.textContent).not.toContain("Record review decision");
      expect(screen.container.querySelector('[aria-label="Pinned review Markdown"]')?.getAttribute("data-flex")).toBe("1");
      const details = screen.container.querySelector<HTMLButtonElement>('[aria-label="Show review details"]');
      expect(details).not.toBeNull();
      expect(screen.container.textContent).not.toContain("File: /project/.lanes/reviews/opened/");
      await act(async () => { details!.click(); });
      expect(screen.container.textContent).toContain("Candidate base: base-commit (main)");
      expect(screen.container.textContent).toContain("Assigned reviewer: reviewer");
      expect(screen.container.textContent).toContain("File: /project/.lanes/reviews/opened/rev-11111111-1111-4111-8111-111111111111.md");
      await act(async () => { screen.container.querySelector<HTMLButtonElement>('[aria-label="Hide review details"]')!.click(); });
      const preview = screen.container.querySelector('[role="link"]');
      expect(preview?.textContent).toBe("Preview");
      expect(screen.container.querySelectorAll('[role="link"]')).toHaveLength(1);
      await act(async () => { (preview as HTMLElement).click(); });
      expect(state.openUrl).toHaveBeenCalledWith("https://example.com/preview");
      await act(async () => { screen.container.querySelector<HTMLButtonElement>('[aria-label="Back to work"]')!.click(); });
      expect(screen.container.querySelector('[aria-label="Review · #g001"]')).toBeNull();
      expect(boardView!.getAttribute("data-display")).toBe("flex");
      expect(screen.container.querySelector('[aria-label="Collapse goal #g001"]')?.getAttribute("aria-expanded")).toBe("true");
      expect(state.scrollCalls.at(-1)).toEqual({ y: 237, animated: false });
    } finally {
      await screen.unmount();
    }
  });

  it("does not offer a Goal review to a Task added after the pinned coverage", async () => {
    state.board = { lanes: [], goals: [{ ...goal, tasks: [task, { ...task, ref: "#g001#t02", title: "Added later" }] }], warnings: [] };
    state.reviews = [{ id: "rev-old", ref: "#g001", status: "awaiting_review", covered_refs: ["#g001", "#g001#t01"] }];
    const screen = await mountScreen();
    try {
      await act(async () => {
        screen.container.querySelector<HTMLButtonElement>('[aria-label="Expand goal #g001"]')!.click();
      });
      expect(screen.container.querySelectorAll('button[aria-label="Review"]')).toHaveLength(2);
    } finally {
      await screen.unmount();
    }
  });

  it("keeps an actionable Lane review visible after focusing the Lane and refreshes its review list", async () => {
    state.reviews = [{ id: "rev-lane", ref: "#g001", status: "awaiting_review", covered_refs: ["#l001"] }];
    state.openedReview = {
      review: { id: "rev-lane", ref: "#g001", status: "awaiting_review", reviewer: "reviewer",
        candidate: { base: "base", head: "head" }, stale: false, stale_reasons: [] },
      requested_ref: "#l001", path: "/project/.lanes/reviews/opened/rev-lane.md",
      content_identity: { sha256: "hash" }, markdown: "## Pinned change request\nLane CR",
    };
    const screen = await mountScreen();
    try {
      await act(async () => { screen.container.querySelector<HTMLButtonElement>('[aria-label="More actions for lane #l001"]')!.click(); });
      await act(async () => { [...screen.container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Focus lane")!.click(); });
      expect(screen.container.querySelector('[aria-label="Review pinned CR for #l001"]')).not.toBeNull();
      await act(async () => { screen.container.querySelector<HTMLButtonElement>('[aria-label="Review pinned CR for #l001"]')!.click(); });
      expect(screen.container.querySelector('[aria-label="Review · #l001"]')).not.toBeNull();
      expect(screen.container.textContent).toContain("Lane CR");
      await act(async () => { screen.container.querySelector<HTMLButtonElement>('[aria-label="Refresh Lanes and Paseo"]')!.click(); });
      expect(state.invalidations).toContainEqual(["clips.review.list", "p1"]);
    } finally {
      await screen.unmount();
    }
  });

  it("opens Reviews on the selected project, hides board controls, and returns to that project", async () => {
    const screen = await mountScreen();
    try {
      await act(async () => {
        [...screen.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
          .find((button) => button.textContent === "Project 2")!.click();
      });
      await act(async () => { screen.container.querySelector<HTMLButtonElement>('[aria-label="Open review inbox"]')!.click(); });
      const inbox = screen.container.querySelector<HTMLElement>('[aria-label="Review inbox content"]');
      expect(inbox?.dataset.projectId).toBe("p2");
      expect(screen.container.querySelector('[aria-label="Project lanes"]')).toBeNull();
      expect(screen.container.querySelector('[aria-label="Search Lanes work"]')).toBeNull();
      expect(screen.container.querySelector('[role="tab"]')).toBeNull();

      await act(async () => { screen.container.querySelector<HTMLButtonElement>('[aria-label="Back to Lanes work"]')!.click(); });
      expect(screen.container.querySelector('[aria-label="Review inbox content"]')).toBeNull();
      expect(screen.container.querySelector('[aria-label="Project lanes"]')).not.toBeNull();
      expect([...screen.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
        .find((button) => button.textContent === "Project 2")?.getAttribute("aria-selected")).toBe("true");
    } finally {
      await screen.unmount();
    }
  });

  it("opens live CR attachment Markdown in a full view and returns to the same focused Lane", async () => {
    state.reviews = [{ ref: "#l001", id: "rev-lane", status: "awaiting_review", covered_refs: ["#l001"] }];
    const attachment = { id: "lane-md", type: "markdown", purpose: "cr", title: "Runbook", status: "available" };
    state.board = { lanes: [{ ...lane, attachments: [attachment] }], goals: [goal, outside], warnings: [] };
    state.readAttachment.mockResolvedValue({ ref: "#l001", revision: 4, attachment: {
      ...attachment, content: "# Live runbook\n**Status:** Current attachment body. `runbook` *note*. [Docs](https://example.com/docs)",
      content_semantics: "current_file",
    } });
    state.openedReview = {
      review: { ref: "#l001", id: "rev-lane", title: "Lane CR", status: "awaiting_review", reviewer: "Daniel",
        candidate: { base: "base", head: "head" }, stale: false, stale_reasons: [] },
      requested_ref: "#l001", path: "/project/.lanes/reviews/opened/rev-lane.md", content_identity: { sha256: "hash" },
      markdown: "# Lane CR\n\n- Review ID: rev-lane\n\n## Pinned change request\n\nPinned snapshot body.",
    };
    const screen = await mountScreen();
    try {
      await act(async () => { screen.container.querySelector<HTMLButtonElement>('[aria-label="More actions for lane #l001"]')!.click(); });
      const focus = [...screen.container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Focus lane");
      await act(async () => { focus!.click(); });
      expect(screen.container.querySelector('[aria-label="Attachments for #l001"]')).not.toBeNull();
      const boardView = screen.container.querySelector<HTMLElement>('[aria-label="Lanes work surface"]')!;
      boardView.scrollTop = 237;
      await act(async () => { boardView.dispatchEvent(new Event("scroll", { bubbles: true })); });
      expect(screen.container.textContent).not.toContain("Current attachment body.");
      await act(async () => { screen.container.querySelector<HTMLButtonElement>('[aria-label="Open current Markdown for #l001: Runbook"]')!.click(); });
      expect(state.readAttachment).toHaveBeenCalledWith({ projectId: "p1", ref: "#l001", attachmentId: "lane-md" });
      expect(screen.container.querySelector('[aria-label="Current attachment · #l001 · lane-md"]')).not.toBeNull();
      expect(screen.container.textContent).toContain("Current attached Markdown · #l001 · lane-md");
      expect(screen.container.textContent).toContain("This is the current attachment file.");
      expect(screen.container.textContent).toContain("Current attachment body.");
      const boldStatus = [...screen.container.querySelectorAll<HTMLElement>("span")].find((node) => node.textContent === "Status:");
      expect(boldStatus?.style.fontWeight).toBe("700");
      expect(screen.container.querySelector('[aria-label="Current attachment Markdown"]')?.getAttribute("data-flex")).toBe("1");
      const docs = [...screen.container.querySelectorAll<HTMLElement>('[role="link"]')].find((link) => link.textContent === "Docs");
      expect(docs).not.toBeNull();
      await act(async () => { docs!.click(); });
      expect(state.openUrl).toHaveBeenCalledWith("https://example.com/docs");
      boardView.scrollTop = 0;
      await act(async () => { boardView.dispatchEvent(new Event("scroll", { bubbles: true })); });
      await act(async () => { screen.container.querySelector<HTMLButtonElement>('[aria-label="Open pinned Review for #l001"]')!.click(); });
      expect(screen.container.textContent).toContain("Pinned snapshot body.");
      expect(screen.container.textContent).not.toContain("Current attachment body.");
      await act(async () => { screen.container.querySelector<HTMLButtonElement>('[aria-label="Back to work"]')!.click(); });
      expect(screen.container.querySelector('[aria-label="Attachments for #l001"]')).not.toBeNull();
      expect(screen.container.textContent).not.toContain("Current attachment body.");
      expect(screen.container.textContent).toContain("#l001 · Goals and Tasks");
      expect(state.scrollCalls.at(-1)).toEqual({ y: 237, animated: false });
    } finally {
      await screen.unmount();
    }
  });

  it("shows live Markdown loading and read errors in the full attachment view", async () => {
    const attachment = { id: "lane-md", type: "markdown", title: "Runbook", status: "available" };
    state.board = { lanes: [{ ...lane, attachments: [attachment] }], goals: [goal, outside], warnings: [] };
    let finishRead!: (value: any) => void;
    state.readAttachment.mockImplementation(() => new Promise((resolve) => { finishRead = resolve; }));
    const screen = await mountScreen();
    try {
      await act(async () => { screen.container.querySelector<HTMLButtonElement>('[aria-label="More actions for lane #l001"]')!.click(); });
      const focus = [...screen.container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Focus lane");
      await act(async () => { focus!.click(); });
      await act(async () => { screen.container.querySelector<HTMLButtonElement>('[aria-label="Open current Markdown for #l001: Runbook"]')!.click(); });
      expect(screen.container.querySelector('[aria-label="Current attachment · #l001 · lane-md"]')).not.toBeNull();
      expect(screen.container.textContent).toContain("Reading current attachment…");
      await act(async () => {
        finishRead({ ref: "#l001", revision: 1, attachment: { ...attachment, content: "Loaded document" } });
      });
      expect(screen.container.textContent).toContain("Loaded document");
      state.readAttachment.mockRejectedValueOnce(new Error("Access denied"));
      await act(async () => { screen.container.querySelector<HTMLButtonElement>('[aria-label="Refresh current attachment"]')!.click(); });
      expect(screen.container.textContent).toContain("Could not read current Markdown: Access denied");
    } finally {
      await screen.unmount();
    }
  });

  it("keeps live attachment loading, missing, identity errors and project switching scoped", async () => {
    const attachment = { id: "lane-md", type: "markdown", title: "Runbook", status: "available" };
    state.board = { lanes: [{ ...lane, attachments: [attachment] }], goals: [goal, outside], warnings: [] };
    const projectProps: Record<string, unknown> = { preferredProjectId: "p1" };
    state.readAttachment.mockResolvedValue({ ref: "#l001", revision: 1, attachment: {
      ...attachment, status: "missing", content: null, error: "File no longer exists.",
    } });
    const screen = await mountScreen(projectProps);
    try {
      await act(async () => { screen.container.querySelector<HTMLButtonElement>('[aria-label="Open current Markdown for #l001: Runbook"]')!.click(); });
      expect(screen.container.textContent).toContain("File no longer exists.");
      await act(async () => { screen.container.querySelector<HTMLButtonElement>('[aria-label="Refresh current attachment"]')!.click(); });
      expect(state.readAttachment).toHaveBeenCalledTimes(2);
      state.readAttachment.mockResolvedValueOnce({ ref: "#g003", revision: 2, attachment: { ...attachment, content: "wrong record" } });
      await act(async () => { screen.container.querySelector<HTMLButtonElement>('[aria-label="Refresh current attachment"]')!.click(); });
      expect(screen.container.textContent).toContain("Could not read current Markdown: Lanes returned a different record or attachment.");
      projectProps.preferredProjectId = "p2";
      await screen.rerender();
      expect(screen.container.querySelector('[aria-label="Current attachment · #l001 · lane-md"]')).toBeNull();
      expect(screen.container.textContent).toContain("Project 2");
    } finally {
      await screen.unmount();
    }
  });

  it("keeps project collaboration controls in Settings instead of the work board", async () => {
    state.board = {
      lanes: [lane], goals: [goal, outside], warnings: [],
      collaboration: { enabled: false, state: "disabled", scope: "project", automatic_mutation_sync: false },
    };
    const screen = await mountScreen();
    try {
      await act(async () => {
        screen.container.querySelector<HTMLButtonElement>('[aria-label="More actions for lane #l001"]')!.click();
      });
      const focus = [...screen.container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Focus lane");
      await act(async () => { focus!.click(); });
      expect(screen.container.textContent).toContain("Publish releases");
      expect(screen.container.textContent).not.toContain("GitHub collaboration:");
      expect(screen.container.textContent).toContain("Publish releases");
      expect(state.updateCollaboration).not.toHaveBeenCalled();
    } finally {
      await screen.unmount();
    }
  });
});

describe("focused lane rendering", () => {
  it("counts active agents from the selected project and focused Lane in the rendered Running chip", async () => {
    const projectId = "prj_4a7ad5e04079f99a";
    const workspaceId = "wks_e3999fd72170a8c8";
    const managerId = "527ca796-8b37-4a47-903c-249f92286a34";
    const goalAgentId = "2c72b6a5-873a-4c79-ac7f-f854c37a3652";
    const secondGoalAgentId = "f296f17b-2256-4fdb-9e5b-f1cbe8bb1607";
    const focusedLane = {
      ...lane, ref: "#l006", title: "Launch Hypercanvas demo", goalRefs: ["#g146", "#g144"],
      managerClaim: { owners: [{ host: "host", runtime: "paseo", session_id: managerId }] },
    };
    const focusedGoal = { ...goal, ref: "#g146", title: "Extend autoplace and multi-selection controls", laneId: "l006", tasks: [] };
    const secondGoal = { ...goal, ref: "#g144", title: "Repair Notebook selection, recent-list management, and first-open setup", laneId: "l006", tasks: [] };
    const otherGoal = { ...goal, ref: "#g999", title: "Other project Goal", laneId: null, tasks: [] };
    state.projects = [{ projectId, projectIds: [projectId], label: "Hypercanvas" }];
    state.board = { lanes: [focusedLane], goals: [focusedGoal, secondGoal, otherGoal], warnings: [] };
    state.runtime.workspaces = [
      { id: workspaceId, projectId, name: "Focused Lane", branch: branchName(focusedLane), status: "ready" },
      { id: "foreign-workspace", projectId: "prj_other", name: "Foreign", branch: "", status: "ready" },
    ];
    const agent = (id: string, ref: string, workspace: string, ownerProject: string, status = "running") => ({
      id, workspaceId: workspace, status, requiresAttention: false, attentionReason: null,
      labels: { "clips.ref": ref, "clips.kind": ref.startsWith("#l") ? "lane" : "goal", "clips.projectId": ownerProject },
      title: id,
    });
    state.runtime.agents = [
      agent(goalAgentId, "#g146", workspaceId, projectId),
      { ...agent(managerId, "#l006", workspaceId, projectId, "idle"), labels: {} },
      agent("foreign-active", "#g999", "foreign-workspace", "prj_other"),
      agent(secondGoalAgentId, "#g144", workspaceId, projectId),
    ];

    const container = document.createElement("div");
    const root = createRoot(container);
    const previousAct = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const renderView = async () => root.render(createElement(WorkScreen, {
      ...props, preferredProjectId: projectId, currentWorkspaceId: workspaceId,
      currentWorkspaceProjectId: projectId,
    }));
    const runningChip = () => [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.startsWith("Running"))?.textContent;
    try {
      await act(async () => { await renderView(); });
      expect(container.querySelector('[aria-label="Lane goals"]')).not.toBeNull();
      expect(container.textContent).not.toContain("Other project Goal");
      expect(runningChip()).toBe("Running · 2");
      await act(async () => {
        [...container.querySelectorAll<HTMLButtonElement>("button")]
          .find((button) => button.textContent?.startsWith("Running"))!.click();
      });
      expect(container.textContent).toContain("Extend autoplace and multi-selection controls");
      expect(container.textContent).toContain("Repair Notebook selection, recent-list management, and first-open setup");

      // The screenshot shows only #g146 while the full Lane includes #g144 too.
      // Search narrows the rendered view and its count; clearing search restores both.
      const search = container.querySelector<HTMLInputElement>('[aria-label="Search Lanes work"]')!;
      await act(async () => {
        search.value = "#g146";
        search.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(container.textContent).toContain("Extend autoplace and multi-selection controls");
      expect(container.textContent).not.toContain("Repair Notebook selection, recent-list management, and first-open setup");
      expect(runningChip()).toBe("Running · 1");

      await act(async () => {
        search.value = "";
        search.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(container.textContent).toContain("Repair Notebook selection, recent-list management, and first-open setup");
      expect(runningChip()).toBe("Running · 2");
    } finally {
      await act(async () => { root.unmount(); });
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = previousAct;
    }
  });

  it("keeps the Goal action menu over the card, without inserting space after a long description", async () => {
    const description = `Goal summary. ${"Long Goal context remains in the card. ".repeat(12)}Goal final sentence.`;
    state.board.goals = [{ ...goal, description }];
    const container = document.createElement("div");
    const root = createRoot(container);
    const previousAct = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => { root.render(createElement(WorkScreen, { ...props, layout: { ...props.layout, compact: true }, currentWorkspaceId: "w1", currentWorkspaceProjectId: "p1" })); });
      expect(container.textContent).not.toContain("Goal final sentence.");
      await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Expand Goal description #g001"]')!.click(); });
      expect(container.textContent).toContain("Goal final sentence.");
      await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="More actions for goal #g001"]')!.click(); });

      const menu = container.querySelector<HTMLElement>('[role="menu"]');
      expect(menu).not.toBeNull();
      // The menu must overlay its Goal card instead of joining RecordContext in normal flow.
      expect(["absolute", "fixed"]).toContain(menu!.dataset.position);
      expect(menu!.dataset.maxWidth).toBe("100%");
      expect(menu!.dataset.maxHeight).toBe("240");
      expect(container.textContent).toContain("Goal summary.");
      expect(container.textContent).toContain("Goal final sentence.");
      expect(container.querySelector('[aria-label="More actions for goal #g001"]')!.getAttribute("aria-expanded")).toBe("true");

      await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="More actions for goal #g001"]')!.click(); });
      expect(container.querySelector('[role="menu"]')).toBeNull();
      expect(container.textContent).toContain("Goal final sentence.");
    } finally {
      await act(async () => { root.unmount(); });
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = previousAct;
    }
  });

  it("selecting Close goal dismisses the menu and opens the existing close dialog", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const previousAct = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => { root.render(createElement(WorkScreen, { ...props, currentWorkspaceId: "w1", currentWorkspaceProjectId: "p1" })); });
      await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="More actions for goal #g001"]')!.click(); });
      const close = [...container.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === "Close goal");
      expect(close).toBeDefined();
      await act(async () => { close!.click(); });
      expect(container.querySelector('[role="menu"]')).toBeNull();
      expect(container.querySelector('[aria-label="Close goal"]')).not.toBeNull();
      expect(container.querySelector('[aria-label="More actions for goal #g001"]')!.getAttribute("aria-expanded")).toBe("false");
    } finally {
      await act(async () => { root.unmount(); });
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = previousAct;
    }
  });

  it("keeps workspace choices in an overlay scroll container in compact layout", async () => {
    state.runtime.workspaces = Array.from({ length: 12 }, (_, index) => ({
      id: `workspace-${index}`, projectId: "p1", name: `Workspace ${index}`, branch: "feature/example", status: "ready",
    }));
    const container = document.createElement("div");
    const root = createRoot(container);
    const previousAct = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => { root.render(createElement(WorkScreen, { ...props, layout: { ...props.layout, compact: true } })); });
      await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Run in workspace"]')!.click(); });
      const menu = container.querySelector<HTMLElement>('[role="menu"]');
      expect(menu).not.toBeNull();
      expect(menu!.dataset.position).toBe("absolute");
      expect(menu!.querySelector("[data-max-height]")?.getAttribute("data-max-height")).toBe("220");
      expect(menu!.querySelectorAll('[role="menuitem"]')).toHaveLength(12);
    } finally {
      await act(async () => { root.unmount(); });
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = previousAct;
    }
  });

  it.each([false, true])("shows Tasks only for expanded Goals and retains expansion through Back (compact: %s)", async (compact) => {
    const secondTask = { ...task, ref: "#g002#t01", title: "Second Task" };
    const secondGoal = { ...goal, ref: "#g002", title: "Second Goal", tasks: [secondTask] };
    state.board.goals = [goal, secondGoal, outside];
    const container = document.createElement("div");
    const root = createRoot(container);
    const previousAct = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const click = async (label: string) => {
      const button = container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
      expect(button).not.toBeNull();
      await act(async () => { button.click(); });
    };
    try {
      await act(async () => { root.render(createElement(WorkScreen, { ...props, layout: { ...props.layout, compact }, currentWorkspaceId: "w1", currentWorkspaceProjectId: "p1" })); });
      expect(container.textContent).not.toContain("Ship package");
      expect(container.textContent).not.toContain("Second Task");
      expect(container.querySelector('[aria-label="Show Goal details #g001"]')!.getAttribute("aria-expanded")).toBe("false");
      await click("Show Goal details #g001");
      expect(container.textContent).toContain("Ship package");
      expect(container.textContent).not.toContain("Second Task");
      expect(container.querySelector('[aria-label="Run in Paseo"]')).not.toBeNull();
      expect(container.querySelector('[aria-label="Hide Goal details #g001"]')!.getAttribute("aria-expanded")).toBe("true");
      await click("Show Goal details #g002");
      await click("Hide Goal details #g001");
      expect(container.textContent).not.toContain("Ship package");
      expect(container.textContent).toContain("Second Task");
      await click("Back to Lanes");
      expect(container.querySelector('[aria-label="Project lanes"]')).not.toBeNull();
      expect(container.textContent).not.toContain("Ship package");
      expect(container.textContent).toContain("Second Task");
      await click("More actions for lane #l001");
      const focus = [...container.querySelectorAll("button")].find((button) => button.textContent === "Focus lane")!;
      await act(async () => { focus.click(); });
      expect(container.querySelector('[aria-label="Lane goals"]')).not.toBeNull();
      expect(container.textContent).not.toContain("Ship package");
      expect(container.textContent).toContain("Second Task");
    } finally {
      await act(async () => { root.unmount(); });
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = previousAct;
    }
  });

  it.each(["search", "running"])("reveals matching Tasks by default for %s and honors explicit collapse", async (filter) => {
    state.board.goals = [{ ...goal, tasks: [task, { ...task, ref: "#g001#t02", title: "Nonmatching Task" }] }];
    state.runtime.agents = [{ id: "worker", workspaceId: "w1", status: "running", requiresAttention: false,
      attentionReason: null, labels: { "clips.ref": task.ref, "clips.projectId": "p1" }, title: "Worker" }];
    const container = document.createElement("div");
    const root = createRoot(container);
    const previousAct = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => { root.render(createElement(WorkScreen, { ...props, currentWorkspaceId: "w1", currentWorkspaceProjectId: "p1" })); });
      await act(async () => {
        if (filter === "search") {
          const input = container.querySelector<HTMLInputElement>('[aria-label="Search Lanes work"]')!;
          input.value = "Ship package";
          input.dispatchEvent(new Event("input", { bubbles: true }));
        } else {
          [...container.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Running"))!.click();
        }
      });
      expect(container.textContent).toContain("Ship package");
      expect(container.textContent).not.toContain("Nonmatching Task");
      const collapse = container.querySelector<HTMLButtonElement>('[aria-label="Hide Goal details #g001"]')!;
      expect(collapse.getAttribute("aria-expanded")).toBe("true");
      await act(async () => { collapse.click(); });
      expect(container.textContent).not.toContain("Ship package");
      const expand = container.querySelector<HTMLButtonElement>('[aria-label="Show Goal details #g001"]')!;
      expect(expand.getAttribute("aria-expanded")).toBe("false");
      await act(async () => { expand.click(); });
      expect(container.textContent).toContain("Ship package");
      expect(container.textContent).not.toContain("Nonmatching Task");
    } finally {
      await act(async () => { root.unmount(); });
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = previousAct;
    }
  });

  it.each([false, true])("hides Task-area empty states while collapsed (filtered: %s)", async (filtered) => {
    state.board.goals = [{ ...goal, tasks: filtered ? [{ ...task, status: "closed" }] : [] }];
    const emptyMessage = filtered ? "No Tasks match the current filter." : "No Tasks in this Goal yet.";
    const container = document.createElement("div");
    const root = createRoot(container);
    const previousAct = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => { root.render(createElement(WorkScreen, { ...props, currentWorkspaceId: "w1", currentWorkspaceProjectId: "p1" })); });
      expect(container.textContent).not.toContain(emptyMessage);
      await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Show Goal details #g001"]')!.click(); });
      expect(container.textContent).toContain(emptyMessage);
      await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Hide Goal details #g001"]')!.click(); });
      expect(container.textContent).not.toContain(emptyMessage);
    } finally {
      await act(async () => { root.unmount(); });
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = previousAct;
    }
  });

  it.each([false, true])("expands Lane and Goal context independently from details (compact: %s)", async (compact) => {
    const laneDescription = `Lane context. ${"Strategic scope and constraints. ".repeat(12)}Lane final sentence.`;
    const goalDescription = `Goal context. ${"Implementation outcome and boundaries. ".repeat(12)}Goal final sentence.`;
    state.board = { lanes: [{ ...lane, description: laneDescription }], goals: [{ ...goal, description: goalDescription }], warnings: [] };
    const container = document.createElement("div");
    const root = createRoot(container);
    const previousAct = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => { root.render(createElement(WorkScreen, { ...props, layout: { ...props.layout, compact }, currentWorkspaceId: "w1", currentWorkspaceProjectId: "p1" })); });
      expect(container.textContent).toContain("Lane context.");
      expect(container.textContent).toContain("Goal context.");
      expect(container.textContent).not.toContain("Lane final sentence.");
      expect(container.textContent).not.toContain("Goal final sentence.");
      expect(container.textContent!.indexOf("Lane context.")).toBeLessThan(container.textContent!.indexOf("Running now"));
      expect(container.textContent).not.toContain("Ship package");
      const details = container.querySelector('[aria-label="Show Goal details #g001"]')!;
      for (const [kind, ref, fullText] of [["Lane", "#l001", laneDescription], ["Goal", "#g001", goalDescription]]) {
        const expand = container.querySelector<HTMLButtonElement>(`[aria-label="Expand ${kind} description ${ref}"]`)!;
        expect(expand.getAttribute("aria-expanded")).toBe("false");
        await act(async () => { expand.click(); });
        expect(container.textContent).toContain(fullText);
        const collapse = container.querySelector<HTMLButtonElement>(`[aria-label="Collapse ${kind} description ${ref}"]`)!;
        expect(collapse.getAttribute("aria-expanded")).toBe("true");
        expect(details.getAttribute("aria-expanded")).toBe("false");
        await act(async () => { collapse.click(); });
        expect(container.textContent).not.toContain(kind + " final sentence.");
      }
      expect(container.querySelector('[aria-label="More actions for lane #l001"]')).not.toBeNull();
      expect(container.querySelector('[aria-label="Labels for #l001"]')).toBeNull();
      expect(container.querySelector('[aria-label="Back to Lanes"]')).not.toBeNull();
      expect(container.querySelector('[aria-label="Run"]')).not.toBeNull();
      expect(container.textContent).not.toContain("Ship package");
    } finally {
      await act(async () => { root.unmount(); });
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = previousAct;
    }
  });

  it("shows short descriptions once and omits empty context without expansion controls", () => {
    state.board = { lanes: [{ ...lane, description: "Lane summary." }], goals: [{ ...goal, description: "Goal summary." }], warnings: [] };
    const html = render();
    expect(html.split("Lane summary.")).toHaveLength(2);
    expect(html.split("Goal summary.")).toHaveLength(2);
    expect(html).not.toContain("Expand Lane description");
    expect(html).not.toContain("Expand Goal description");
    state.board = { lanes: [{ ...lane, description: "  " }], goals: [{ ...goal, description: "\n" }], warnings: [] };
    const empty = render();
    expect(empty).not.toContain("Show more");
    expect(empty).not.toContain("Collapse Goal description");
  });

  it("chooses the exact agent across workspaces and restores launches after execution ends", async () => {
    state.board = { lanes: [], goals: [{ ...goal, laneId: null, tasks: [] }], warnings: [] };
    state.runtime.workspaces = [
      { id: "w1", projectId: "p1", name: "First workspace", branch: "", status: "ready" },
      { id: "w2", projectId: "p1", name: "Second workspace", branch: "", status: "ready" },
    ];
    state.runtime.agents = [
      { id: "first", workspaceId: "w1", status: "running", requiresAttention: false, attentionReason: null, labels: { "clips.ref": goal.ref, "clips.projectId": "p1" }, title: "First worker" },
      { id: "second", workspaceId: "w2", status: "attention", requiresAttention: true, attentionReason: "permission", labels: { "clips.ref": goal.ref, "clips.projectId": "p1" }, title: "Second worker" },
    ];
    const calls: string[] = [];
    const navigation = {
      openWorkspace: ({ workspaceId }: { workspaceId: string }) => { calls.push(`workspace:${workspaceId}`); },
      openAgent: ({ agentId }: { agentId: string }) => { calls.push(`agent:${agentId}`); },
    };
    const container = document.createElement("div");
    const root = createRoot(container);
    const previousAct = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const renderScreen = () => root.render(createElement(WorkScreen, { ...props, navigation }));
    try {
      await act(async () => { renderScreen(); });
      const go = container.querySelector<HTMLButtonElement>('button[aria-label="Go to agent"]')!;
      expect(go).not.toBeNull();
      await act(async () => { go.click(); });
      expect(calls).toEqual([]);
      const choice = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Second worker · attention · w2"));
      expect(choice).toBeDefined();
      await act(async () => { choice!.click(); });
      expect(calls).toEqual(["workspace:w2", "agent:second"]);
      expect(container.querySelector('[role="menu"]')).toBeNull();
      expect(container.querySelector('[aria-label="Run in workspace"]')).toBeNull();
      state.runtime = { ...state.runtime, agents: [] };
      await act(async () => { renderScreen(); });
      expect(container.querySelector('[aria-label="Go to agent"]')).toBeNull();
      expect(container.querySelector('[aria-label="Run in workspace"]')).not.toBeNull();
    } finally {
      await act(async () => { root.unmount(); });
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = previousAct;
    }
  });

  it("keeps idle-agent and workspace choice menus mutually exclusive", async () => {
    state.board = { lanes: [], goals: [{ ...goal, laneId: null, tasks: [] }], warnings: [] };
    state.runtime.workspaces = [
      { id: "w1", projectId: "p1", name: "First workspace", branch: "", status: "ready" },
      { id: "w2", projectId: "p1", name: "Second workspace", branch: "", status: "ready" },
    ];
    state.runtime.agents = ["first", "second"].map((id, index) => ({
      id, workspaceId: index ? "w2" : "w1", status: "idle", requiresAttention: false, attentionReason: null,
      labels: { "clips.ref": goal.ref, "clips.projectId": "p1" }, title: `${id} idle worker`,
    }));
    const container = document.createElement("div");
    const root = createRoot(container);
    const previousAct = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      const navigation = { openWorkspace: vi.fn(), openAgent: vi.fn() };
      await act(async () => { root.render(createElement(WorkScreen, { ...props, navigation, layout: { ...props.layout, compact: true } })); });
      await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Go to agent"]')!.click(); });
      expect(container.querySelector('[role="menu"]')?.textContent).toContain("first idle worker");
      expect(container.querySelector('[role="menu"]')?.textContent).not.toContain("First workspace");
      await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Run in workspace"]')!.click(); });
      expect(container.querySelectorAll('[role="menu"]')).toHaveLength(1);
      expect(container.querySelector('[role="menu"]')?.textContent).toContain("First workspace");
      expect(container.querySelector('[role="menu"]')?.textContent).not.toContain("first idle worker");
      await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Go to agent"]')!.click(); });
      expect(container.querySelectorAll('[role="menu"]')).toHaveLength(1);
      expect(container.querySelector('[role="menu"]')?.textContent).toContain("first idle worker");
    } finally {
      await act(async () => { root.unmount(); });
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = previousAct;
    }
  });

  it("shows Go to agent for a valid idle associated agent and opens it without starting another", async () => {
    state.board = { lanes: [], goals: [{ ...goal, laneId: null, tasks: [] }], warnings: [] };
    state.runtime.agents = [{ id: "idle-worker", workspaceId: "w1", status: "idle", requiresAttention: false,
      attentionReason: null, labels: { "clips.ref": goal.ref, "clips.projectId": "p1" }, title: "Idle worker" }];
    const calls: string[] = [];
    const navigation = {
      openWorkspace: ({ workspaceId }: { workspaceId: string }) => { calls.push(`workspace:${workspaceId}`); },
      openAgent: ({ agentId }: { agentId: string }) => { calls.push(`agent:${agentId}`); },
    };
    const container = document.createElement("div");
    const root = createRoot(container);
    const previousAct = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => { root.render(createElement(WorkScreen, { ...props, navigation, currentWorkspaceId: "w1", currentWorkspaceProjectId: "p1" })); });
      expect(container.textContent).toContain("Workspace idle");
      expect(container.textContent).not.toContain("● Running ·");
      const go = container.querySelector<HTMLButtonElement>('button[aria-label="Go to agent"]');
      expect(go).not.toBeNull();
      await act(async () => { go!.click(); });
      expect(calls).toEqual(["workspace:w1", "agent:idle-worker"]);
    } finally {
      await act(async () => { root.unmount(); });
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = previousAct;
    }
  });

  it.each(["missing workspace", "foreign project", "finished agent"]) (
    "does not offer Go to agent for a %s target", (caseName) => {
      state.board = { lanes: [], goals: [{ ...goal, laneId: null, tasks: [] }], warnings: [] };
      const agent = { id: "stale", workspaceId: "w1", status: "idle", requiresAttention: false,
        attentionReason: null, labels: { "clips.ref": goal.ref, "clips.projectId": "p1" }, title: "Stale worker" };
      if (caseName === "missing workspace") agent.workspaceId = "missing";
      if (caseName === "foreign project") {
        agent.workspaceId = "foreign";
        agent.labels["clips.projectId"] = "p2";
        state.runtime.workspaces = [...state.runtime.workspaces,
          { id: "foreign", projectId: "p2", name: "Foreign workspace", branch: "", status: "ready" }];
      }
      if (caseName === "finished agent") agent.attentionReason = "finished" as any;
      state.runtime.agents = [agent];
      const html = renderToStaticMarkup(createElement(WorkScreen, { ...props,
        navigation: { openWorkspace: vi.fn(), openAgent: vi.fn() }, currentWorkspaceId: "w1", currentWorkspaceProjectId: "p1" }));
      expect(html).not.toContain('aria-label="Go to agent"');
      if (caseName === "missing workspace") expect(html).not.toContain('aria-label="Open workspace"');
    });

  it("places Back above lane title and exposes collapsed goal columns", () => {
    const html = render();
    expect(html.indexOf("Back to Lanes")).toBeLessThan(html.indexOf("Publish releases"));
    expect(html).toContain('aria-label="Lane goals"');
    expect(html).toContain("Package publishing");
    expect(html).not.toContain("Ship package");
    expect(html).not.toContain("Unrelated goal");
    expect(html).not.toContain('aria-label="Project lanes"');
    expect(html).toContain('aria-label="More actions for goal #g001"');
    expect(html).toContain('aria-label="Show Goal details #g001"');
    expect(html).toContain('aria-label="Run"');
  });

  it("shows assigned Lane labels and a kebab action in the workspace-focused header", () => {
    state.board.lanes = [{ ...lane, labels: [{ id: "review", name: "Ready to review", color: "#8b5cf6" }] }];
    const html = render();
    expect(html).toContain("Ready to review");
    expect(html).toContain('aria-label="More actions for lane #l001"');
    expect(html).not.toContain('aria-label="Labels for #l001"');
  });

  it("opens the focused Lane label manager from its kebab menu", async () => {
    const review = { id: "review", name: "Ready to review", color: "#8b5cf6" };
    state.board.lanes = [{ ...lane, labels: [review] }];
    state.board.labels = [review];
    const container = document.createElement("div");
    const root = createRoot(container);
    const previousAct = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => { root.render(createElement(WorkScreen, { ...props, currentWorkspaceId: "w1", currentWorkspaceProjectId: "p1" })); });
      const kebab = container.querySelector<HTMLButtonElement>('button[aria-label="More actions for lane #l001"]');
      expect(kebab).not.toBeNull();
      await act(async () => { kebab!.click(); });
      const labels = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
        .find((button) => button.textContent === "Labels");
      expect(labels).toBeDefined();
      await act(async () => { labels!.click(); });
      expect(container.querySelector('[aria-label="Labels · #l001"]')).not.toBeNull();
      expect(container.querySelector('[aria-label="Assign Ready to review to #l001"]')).not.toBeNull();
    } finally {
      await act(async () => { root.unmount(); });
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = previousAct;
    }
  });

  it.each([
    { kind: "lane", ref: "#l001" },
    { kind: "goal", ref: "#g001" },
    { kind: "task", ref: "#g001#t01" },
  ])("keeps Labels accessible from the $kind kebab menu", async ({ kind, ref }) => {
    const review = { id: "review", name: "Ready to review", color: "#8b5cf6" };
    state.board = {
      lanes: [{ ...lane, labels: [review] }],
      goals: [{ ...goal, labels: [review], tasks: [{ ...task, labels: [review] }] }, outside],
      labels: [review], warnings: [],
    };
    const container = document.createElement("div");
    const root = createRoot(container);
    const previousAct = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => { root.render(createElement(WorkScreen, props)); });
      if (kind === "task") {
        await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Expand goal #g001"]')!.click(); });
      }
      expect(container.querySelector(`[aria-label="Labels for ${ref}"]`)).toBeNull();
      await act(async () => { container.querySelector<HTMLButtonElement>(`[aria-label="More actions for ${kind} ${ref}"]`)!.click(); });
      const labels = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
        .find((button) => button.textContent === "Labels");
      expect(labels).toBeDefined();
      await act(async () => { labels!.click(); });
      expect(container.querySelector(`[aria-label="Labels · ${ref}"]`)).not.toBeNull();
      expect(container.querySelector(`[aria-label="Assign Ready to review to ${ref}"]`)).not.toBeNull();
    } finally {
      await act(async () => { root.unmount(); });
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = previousAct;
    }
  });

  it("retains the project home view without inferred workspace context", () => {
    const html = render(false);
    expect(html).toContain('aria-label="Project lanes"');
    expect(html).toContain("Unrelated goal");
    expect(html).not.toContain("Back to Lanes");
  });

  it("offers Show closed goals for an all-closed lane and names empty lanes", () => {
    state.board.goals = [{ ...goal, status: "closed" }];
    let html = render();
    expect(html).toContain("Show closed goals");
    expect(html).toContain("All goals are closed.");
    expect(html).not.toContain("Package publishing");
    state.board.goals = [];
    html = render();
    expect(html).toContain("No Goals in this lane yet.");
    expect(html).not.toContain("Show closed goals");
  });

  it("keeps compact focus content and theme tokens available", () => {
    const html = renderToStaticMarkup(createElement(WorkScreen, { ...props, layout: { ...props.layout, compact: true }, currentWorkspaceId: "w1" }));
    expect(html).toContain("Package publishing");
    expect(html).not.toContain("Ship package");
    expect(html).toContain("Back to Lanes");
  });

  it.each(["running", "initializing", "attention"])("replaces goal launch and workspace actions while %s", (status) => {
    state.board = { lanes: [lane], goals: [{ ...goal, tasks: [] }], warnings: [] };
    state.runtime.agents = [{ id: "a1", workspaceId: "w1", status, requiresAttention: status === "attention",
      attentionReason: status === "attention" ? "permission" : null,
      labels: { "clips.ref": goal.ref, "clips.projectId": "p1" }, title: "Goal agent" }];
    const html = renderToStaticMarkup(createElement(WorkScreen, { ...props,
      navigation: { openWorkspace: vi.fn(), openAgent: vi.fn() }, currentWorkspaceId: "w1", currentWorkspaceProjectId: "p1" }));
    const goalMarkup = html.slice(html.indexOf('aria-label="Hide Goal details #g001"') >= 0
      ? html.indexOf('aria-label="Hide Goal details #g001"') : html.indexOf('aria-label="Show Goal details #g001"'));
    expect(goalMarkup).toContain('aria-label="Go to agent"');
    expect(goalMarkup).not.toContain('aria-label="Run"');
    expect(goalMarkup).not.toContain('aria-label="Open workspace"');
    expect(goalMarkup).not.toContain('aria-label="Run in workspace"');
    expect(goalMarkup).not.toContain('aria-label="Workspace only"');
  });

  it.each(["idle", "unavailable", "foreign"])("preserves manager ownership when %s", (stateName) => {
    const manager = { host: stateName === "foreign" ? "other-host" : "host", runtime: "paseo", session_id: "manager", contact: "Contact manager" };
    state.board = { lanes: [{ ...lane, managerClaim: { revision: 1, owners: [manager] } }], goals: [], warnings: [] };
    state.runtime.agents = stateName === "unavailable" ? [] : [{ id: "manager", workspaceId: "w1", status: "idle", requiresAttention: false, attentionReason: null, labels: {}, title: "Manager" }];
    const html = renderToStaticMarkup(createElement(WorkScreen, { ...props, navigation: { openWorkspace: vi.fn(), openAgent: vi.fn() } }));
    expect(html).toContain("Contact manager");
    if (stateName === "idle") expect(html).toContain('aria-label="Go to agent"');
    else expect(html).toContain("Agent unavailable; contact the manager");
    expect(html).not.toContain('aria-label="Run in workspace"');
    expect(html).not.toContain('aria-label="Open workspace"');
    expect(html).toContain(stateName === "idle" ? "Manager idle" : "Manager unavailable");
  });

  it("fails closed when manager ownership cannot be read", () => {
    state.board = { lanes: [{ ...lane, managerClaim: null, managerClaimError: "Invalid claim state" }], goals: [], warnings: [] };
    const html = render(false);
    expect(html).toContain("Ownership unavailable");
    expect(html).toContain("Invalid claim state");
    expect(html).not.toContain('aria-label="Run in workspace"');
  });

  it("suppresses launches when runtime refresh fails with cached idle data", () => {
    state.runtimeError = new Error("Runtime disconnected");
    for (const focused of [true, false]) {
      const html = render(focused);
      expect(html).toContain("Cannot verify live execution: Runtime disconnected");
      expect(html).not.toContain('aria-label="Run"');
      expect(html).not.toContain('aria-label="Run in workspace"');
      expect(html).not.toContain('aria-label="Run in Paseo"');
      expect(html).not.toContain('aria-label="Workspace only"');
    }
    state.runtimeError = null;
    expect(render()).toContain('aria-label="Run"');
  });

  it("refreshes runtime on a partial creation failure without repeating the successful refresh", async () => {
    render(false);
    const request = state.mutation.onMutate({ ref: lane.ref });
    state.mutation.onSettled(undefined, new Error("agent start failed after creation"), {}, request);
    expect(state.invalidations).toContainEqual(["clips-runtime", "host"]);
    state.invalidations = [];
    state.mutation.onSettled({}, null, {}, request);
    expect(state.invalidations).not.toContainEqual(["clips-runtime", "host"]);
    expect(state.invalidations).toContainEqual(["clips.board", "host", "p1"]);
  });
});
