# Lanes

## 2.2.0

### Resource management and developer folding

- Add a host resource manager to the Paseo plugin with available-memory and CPU
  measurements, configurable sustained warning/critical/recovery thresholds,
  deduplicated manager notices and a Resources settings panel.
- Keep a two-way channel with observed Lane Managers. Managers can watch current
  capacity, reserve shared host headroom, report native launches and release
  unused reservations. Reservations expire, avoid double grants across managers,
  and become invalid when measurements or associations are stale or unsafe.
- Use measured resource capacity when the resource manager is available.
  `lane_max_active_agents` remains a configurable fallback (default five) only
  when the resource manager is unavailable, stale or disabled. Explicit user
  ceilings and native harness quotas still apply, including in the cloud.
- Add `lanes handoff record` to persist developer context as an immutable Markdown
  attachment on the corresponding Goal. Task references attach to their parent
  Goal; namespaces, worktrees, exact retries and failed writes are preserved.
- Add Paseo `resources`, `handoff` and `fold` commands. Normal folds require the
  manager to acknowledge the latest attached context and wait for the dev's
  checkpoint. Native activity, reassignment and pending context writes invalidate
  stale handoffs. Critical pressure closes the dev immediately, then records
  available context as an explicitly incomplete emergency handoff.
- Define folding consistently across all harnesses: close the native agent or
  sub-agent, its tab and its owned runtime process. Paseo uses archive plus native
  readback; stop, detach, idle status and Task closure do not release capacity.
- Always fold finished developers promptly after their normal handoff, even while
  human Goal review is pending. Preserve worktrees, source, transcripts and work
  records; interrupted work does not become accepted completion.
- Document explicit provider-specific continuation handoffs for managed Lane Dev
  sessions across Codex, Claude and OpenCode, including checkpointing, quiescence,
  capacity and recovery.
- Retain archived-but-still-live Paseo runtimes when provider shutdown fails so
  they stay visible, counted and retryable. Critical instructions can reach busy
  managers without waiting for an idle turn.

### Packaging

- Prepare `@dfosco/lanes` 2.2.0 and the bundled private Paseo plugin 0.2.0.
- Repair the plugin dependency lockfile for reproducible `npm ci` installations.
- Refresh packaged Lane Manager, Lane Dev and Lanes skills and release guidance.

## 2.0.0

Plan, coordinate and verify work through linked Lanes, Goals and Tasks. Lane
Manager owns continued delivery across agents, while Clips Dev plans and builds
an outcome in its own session. This major version removes the legacy local web
board; the CLI and work records remain.

### Breaking changes

- Remove `clips web`, its server, UI, packaged assets and frontend build commands.
  Use `clips view`, `clips goal`, `clips lane` and `clips task` to inspect and
  manage the retained work records. Existing records are not deleted or migrated.
- Rename the Loopz skill to `clips-dev`, including its directory and invocation.
  The `skill:loopz` import remains a compatibility alias for `skill:clips-dev`;
  it does not install a second skill. Existing installed copies are not
  automatically refreshed.

### Features

- Ship `lane-manager` for comprehensive planning, task breakdown, delegated
  development and continued delivery, with explicit plan-only and scope controls.
- Ship `clips-dev` as an autonomous staff-developer workflow that plans,
  implements and verifies in its own session. Keep `clips` as the shared
  work-record and acceptance skill.
- Add a default of five concurrently active workers per Lane, excluding its
  manager. Set the project default with `clips config --lane-max-active-agents N`
  and read it with `clips config lane_max_active_agents`. Lane Manager announces
  the effective budget and honors per-Lane user overrides and tighter limits.
- Define host-specific delegation: direct coordinated child sessions in Copilot,
  top-level dev agents in Paseo, native sub-agents on other supported hosts, and
  linear implementation only where delegation is unavailable.
- Add the optional Clips Workspaces Paseo plugin and read-only `clips board --json` interface.
- Include the current Clips Work Copilot canvas with its Primer renderer,
  advisory coordination metadata, exact-current-session sends and checked
  source/build manifest. Ship the complete SDK/installer closure in the package.
- Add `clips init --store-only` for local current-directory initialization without
  skill installation, editor settings, network access or synchronization.
- Ask on every interactive `clips init` whether to install exported Clips skills
  in the project or user account, using Skillshop 2.1.0.
- Accept `clips init --global` as the direct user-scope skill installation option.
- Add persistent system components with responsibility, contract, source references,
  dependencies, named sections, and project-defined metadata.
- Add task scope, component references, ownership, result records, and work
  dependencies. Goals now carry their plan and architectural decisions.
- Give acceptance criteria stable nested IDs and record structured acceptance
  receipts with evidence, artifact identity, and the request that was accepted.
- Add recoverable goal, task, and component revisions, history inspection, and
  JSON views for agents. Preserve prior agreements and acceptance history.
- Support optional named Markdown sections and JSON extensions without requiring
  another artifact type for each project-specific need.

### Changes

- Remove mandatory planning-goal ADRs and building-goal task gates. Existing type
  labels, attached ADRs, and independent CR/ADR records remain supported.
- Replace the separate-task-and-CR workflow with a task that preserves both its
  request and actual result. Administrative closure remains distinct from evidence
  and acceptance.
- Update the Clips skill and repository guidance to avoid repeated confirmations
  for authorized work and to coordinate shared workflow state through one writer
  by default.
- Keep ownership and management metadata advisory without removing authentication,
  acceptance attribution, revision checks or journal protections.
- Lead the README with installation, onboarding and practical Lane Manager use.
  Include the linked technical reference in the npm package.
- Preserve shared goal discovery, installation switching, GitHub synchronization
  and core test coverage while removing web-only dependencies and tooling.
- Ship `npm-shrinkwrap.json` so extracted npm packages retain the installer's
  locked root dependency checks. Both setup and live-skill installation use the
  canonical skills without materializing a duplicate legacy alias.

The worker budget is an agent dispatch policy, not a native process limiter.
Reducing it does not terminate existing workers. GitHub collaboration remains
opt-in, and publication or other external updates still require authorization.

## 1.5.0

Organize related goals into tracks, switch between a local development checkout and a saved npm installation, and return to a single Clips agent skill.

### Features

- Add tracks for grouping goals, reporting progress, and mirroring workstreams to GitHub when collaboration is enabled.
- Add goal dependencies and show track membership and blockers in the CLI and board.
- Add `clips dev` and `clips prod` to switch locally between the development checkout and the saved npm package, refreshing project skills in either mode.

### Changes

- Replace the routed workflow skill pack with the single Clips skill from 1.3.2. Remove the Poteto-derived guidance and extra installed skills.

## 1.4.0-beta.0

Make Clips planning more rigorous while reducing agent ceremony. This beta introduces typed goal outcomes, shared record lifecycles, and a selectively loaded workflow skill pack grounded in evidence and real verification.

### Features

- **Rigorous workflow router**: Route goal framing, decision planning, task breakdown, development, verification, review, and resume work through focused CLI-backed skills with the adapted pstack principles kept inline (`0053934`)
- **Typed goal outcomes**: Separate planning goals that produce ADRs from building goals that deliver tasks and CR-backed changes (`924b16f`)
- **Record lifecycle management**: Manage CR and ADR status and archive transitions through one CLI workflow (`924b16f`)
- **Complete skill installation**: Install and update the router, routed skills, CLI reference, and third-party notice through `clips init` (`0053934`)

### Fixes

- **Dashboard readability**: Improve goal and record presentation in the local board (`d3b1bbe`)
- **Publishing command**: Prevent the explicit npm publish command from recursively invoking itself (`4dc4747`)

### Developer workflow

- Generate observable behavior by default for building goals while planning goals use decision criteria (`d0b4468`)
- Add a repository-local command for running the current Clips CLI during development (`3921ce3`)

## 1.3.0

Improve local web workflows and simplify local-only planning. This release adds npm-packaged web assets, unlinking goals from GitHub, Markdown task checkboxes, reliable project selection, and corrected dark-mode styling.

### Features

- **Packaged web board**: Build and ship the web UI with the npm package so `clips web` works from installed releases (`2899c9e`)
- **Local-only goals**: Unlink goals from GitHub while preserving their local planning state (`696fa1a`)
- **Markdown task lists**: Render task-list items as read-only checkboxes in change records (`7bf89d6`)

### Fixes

- **Theme styling**: Apply semantic theme tokens consistently in dark mode (`7826738`)
- **Project selection**: Keep the project selector visible for single-project boards (`4b4d0c2`)

## 1.2.3

One board for every Clips project. This release adds a global multi-project view with project discovery, filtering, qualified references, and packaged web assets that run outside a repository.

### Features

- **Multi-project board**: Add a global read-only board with project registration, selection, and workspace-qualified goal and task references (`97c1cbb`)

### Chores

- Release version 1.2.3 (`cd35405`)
