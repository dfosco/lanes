
# Lanes Workspaces for Paseo

A Paseo-native, local-first UI for [@dfosco/lanes](https://github.com/dfosco/lanes).
Browse **Lanes → Goals → Tasks** and start work in an isolated Paseo Git worktree,
with or without an agent. Inspired by
[ajma/paseo-issues-workspaces](https://github.com/ajma/paseo-issues-workspaces),
but **Lanes is the work system**, not GitHub Issues.

## What it does

- **Project labels:** Colored chips on Lane, Goal, and Task rows. Open the row's
  Labels action to assign or remove existing labels, search the catalog, or create
  a label with a name and palette color. Each label's Edit action opens rename,
  recolor, and deletion controls. Catalog edits affect this project; deleting an
  assigned label is refused with the record refs that still use it. Labels are
  independent of Lanes status, acceptance, and Paseo runtime activity. The picker
  uses Paseo's dialog on wide layouts and bottom sheet on compact layouts.

- **Project selector:** Finds Git projects on the connected Paseo daemon whose
  main checkout has an initialized `.lanes/` or compatible `.clips/` store. Linked worktrees are grouped
  with the main project.
- **Planning hierarchy:** Lane strategic framing, Goal engineering outcome,
  and each Task's work request. Expand records for scope, plan, decisions,
  and acceptance criteria. Search by title, ref, and description.
- **Attachments:** Lane, Goal, and Task rows retain attachment titles and types.
  Safe HTTP(S) links open only when selected. Markdown content is read on demand
  through the exact record and attachment reference, so edits and missing files
  stay visible without storing snapshots. Rendering treats content as text;
  HTML is not executed and remote content is not fetched.
- **GitHub collaboration:** A project-local On/Off control changes only the
  selected project's configuration. Toggling does not publish. When enabled,
  later supported Lanes record mutations may sync automatically.
- **Run in Paseo:** Starts an agent in a new Git worktree branch for that exact
  Lanes reference. **Workspace only** creates the worktree without starting
  an agent. **Open workspace** returns to an existing one; **Start agent** starts
  another agent there when none is actively running or waiting for input.
- **Running now:** Reads the actual Paseo agent directory, not the Lanes
  `in_progress` field. Running and initializing agents count as active.
  A task with an idle agent shows **Workspace idle**, while permission
  requests show **Needs input**. The **Running** filter includes Lanes,
  Goals, or Tasks with active agents, plus parent groupings for active children.
- **Resource manager:** Observes the daemon host's memory and CPU, then asks
  Lane Managers to retire old idle dev agents or safely wind down current work
  when pressure persists. **Lanes settings → Resources** shows measurements,
  notification state, and editable host thresholds.
- **Safe identity:** Workspace titles embed the complete Lanes ref; worktree
  branches carry a stable namespace-aware identity even when titles change.
  Agent labels provide a second identity path if a workspace is renamed.
  Creation checks the live workspace list, preexisting branches, and an
  in-flight guard before launching.
- **Preserves ownership:** Lanes journals and acceptance remain under
  the resolved Lanes store; the collaboration toggle does not publish and
  there are no automatic status updates, closures, or approvals. With
  collaboration enabled, supported Lanes record mutations may sync to GitHub.
  Paseo owns agent sessions, workspace lifecycle, and worktree creation.

## Install

Requires Paseo **0.11.2+** on both daemon and app, Git, and Node.js
**22.18+** with npm on the **daemon host**. Enable plugins in Paseo settings
before installing. A ready provider is needed to start agents, but not to browse
planning records. Plugins and their preparation commands run with the daemon
user's filesystem and process privileges.

Install this plugin directly from the Lanes monorepo:

```sh
paseo plugin add git:dfosco/lanes:plugins/paseo --ref main
paseo plugin ls clips-workspaces --json
```

The runtime ID is `clips-workspaces`. The explicit `git:` prefix selects the
repository rather than a registry listing. Paseo keeps the full monorepo checkout,
including the canonical Lanes CLI and skills. Preparation runs these exact commands
from `plugins/paseo` before Paseo moves and activates the candidate:

```sh
npm ci --prefix ../.. --omit=dev --ignore-scripts
npm ci --omit=dev --ignore-scripts
```

The root lock installs the canonical CLI's dependencies, including `skillshop`;
the plugin lock installs `@getpaseo/client` and its transitive dependencies for
the standalone session CLI. Paseo supplies the plugin SDK, React and Zod to its
compiled entries. No global Lanes installation, npm publication, `npm link`,
web-board build, or developer-specific path is needed for the native plugin.

For a local directory install, prepare the **full checkout** yourself first.
Directory install/reload does not run the Git preparation commands:

```sh
git clone https://github.com/dfosco/lanes.git
cd lanes/plugins/paseo
npm ci --prefix ../.. --omit=dev --ignore-scripts
npm ci --omit=dev --ignore-scripts
paseo plugin install "$PWD"
```

Do not copy only this subdirectory. The CLI eagerly imports other repository
modules and uses the canonical skill library. Initialize each planning repository
with that matching CLI, using the installed checkout path returned by `plugin ls`
or your own full checkout:

```sh
cd /path/to/planning-repository
node /path/to/lanes/src/cli.js init --skills-scope project
```

With a remote daemon, put `--host <target>` before `plugin` and ensure Git, npm,
Node, the source directory, and planning repositories exist on that daemon host.
The client does not upload a local source directory or install dependencies there.

### Update and rollback

Save the current Git revision from `paseo plugin ls clips-workspaces --json`
before updating. Review the proposed revision, then apply it:

```sh
paseo plugin update clips-workspaces --check
paseo plugin update clips-workspaces
paseo plugin ls clips-workspaces --json
paseo plugin logs clips-workspaces
```

An ordinary Git update proposes the remote's default HEAD. The initial `--ref`
does **not** pin future updates. Select a reviewed commit explicitly to update
or roll back without a second CLI prompt:

```sh
paseo plugin update clips-workspaces --ref <reviewed-commit-sha>
```

Install/update runs both locked preparation commands before validation and
activation. Failed preparation or activation retains the previous installation.
A successful update must be rolled back explicitly to the saved commit; there is
no automatic persistent version pin. Directory sources are skipped by `update`:
restore the desired full checkout revision, rerun preparation, then use
`paseo plugin reload clips-workspaces`. Reload itself does not install dependencies.
An existing runtime ID is rejected by install. Switching an existing directory
installation to a Git source requires an explicit remove and add; do not use that
as an update or discard a development checkout unintentionally.

The native Paseo integration does not need retired web-board assets. Distribution
checks do not claim native UI rendering or agent-provider parity.

Run **Lanes** from the Paseo sidebar or Command Center. Configure a ready
provider in Paseo to start agents. **Lanes settings** selects launch defaults.

**CLI resolution:** The backend reads public `paseo.config.get()` plugin sources.
It selects the single enabled source whose manifest ID is exactly
`clips-workspaces`, then runs that full checkout's `src/cli.js` with the server's
Node executable. It uses the final installed path, including after staging moves.
A missing or ambiguous source fails with guidance instead of choosing an arbitrary
`lanes` from `PATH`. Multiple enabled copies need an explicit `LANES_CLI_PATH`
in the **daemon host's environment**. That override takes precedence and may name
a JavaScript CLI file or executable. It must implement the matching board, labels,
Lane manager and work-contract commands. A broken checkout/dependency install is
reported without falling back to an older global CLI. `CLIPS_CLI_PATH` remains a
fallback when `LANES_CLI_PATH` is unset.

The same checkout's CLI can be invoked from external shells and agent sessions
with `node /path/to/lanes/src/cli.js`; the plugin does not alter their `PATH`.

The plugin's server process reads Lanes data by invoking
`lanes paths --json` and `lanes board --json` in the selected Git repository.
Project directories, config filenames and user directories can independently use
old or new naming. Conflicting populated stores are reported, not silently
selected. No extra database, GitHub authentication, or issue sync is required.
The `clips-workspaces` runtime ID and persisted record/session keys remain stable.

## CLI for configured sessions

The plugin includes a small CLI for Lane Managers and other callers that need
to start an agent with explicit settings. From a Lanes checkout with the
Paseo plugin production dependencies installed:

```sh
node plugins/paseo/cli.js options --project . --provider codex
node plugins/paseo/cli.js options --project . --provider codex/gpt-6.1-sol
node plugins/paseo/cli.js start --project . --ref '#g001#t01' \
  --provider codex/gpt-6.1-sol --thinking high --speed fast \
  --permission restricted --dry-run --json
```

The first `options` command lists ready providers, models, thinking levels and
permission modes. The model-specific command also lists provider features and
their valid values. `--permission full-access` and `--permission restricted`
select the matching live provider mode; full access is the default. Use
`--mode <id>` to select an exact mode ID from discovery. Add `--thinking <id>`
when feature availability depends on the chosen thinking level. `--speed fast`
resolves to the selected provider's discovered Fast value; `--speed normal`
chooses its default or Normal value. Use repeatable `--feature id=value` flags
for other discovered provider features.

Permission modes vary by provider. If the requested access level is not
available, session creation reports that instead of silently falling back to
the provider's default mode.

`--dry-run` prints the target, workspace action, full Lanes context prompt and
resolved Paseo config without creating a workspace or agent. Remove it to
create the session. If more than one Lanes workspace matches the ref, pass
`--workspace <id>`. With no match, the CLI creates an isolated worktree from
the current branch, or from `--base <branch>` when provided. The project must
be registered in Paseo. `--url`, `PASEO_WS_URL` and `PASEO_PASSWORD` select an
alternate or authenticated daemon. `LANES_CLI_PATH` (legacy `CLIPS_CLI_PATH`) can select the Lanes CLI
explicitly. The checkout-local CLI is the default; a plugin-only copy is unsupported.

The CLI runs on Node.js 22.18 or later. From `plugins/paseo`, install
locked production dependencies with `npm ci --omit=dev --ignore-scripts`
and the root preparation command above; then use:

```sh
npm run lanes-paseo -- options --project ../.. --provider codex
npm run lanes-paseo -- start --project ../.. --ref '#g001#t01' \
  --provider codex/gpt-6.1-sol --thinking high --speed fast \
  --permission full-access --dry-run --json
```

## Running a record

The action appears on every Lane, Goal, and Task that is not administratively
closed, not-planned, or duplicate. The generated branch looks like:

```
clips/task/alice-g001-t01-cbf3a4ef-write-tests
```

The ref identity is stable; the title suffix is only for readability.
The worktree branches from the selected checkout's current `HEAD`, **not**
necessarily the remote's latest default branch. Update the checkout's
base before launching when you need the newest upstream revision.

An agent receives a prompt to read `AGENTS.md`, the Lanes record,
the associated skill, and the relevant source; then it works within
that record's contract. A Lane prompt emphasizes strategic coordination,
a Goal prompt emphasizes outcomes and Tasks, and a Task prompt emphasizes
bounded change, tests, and evidence. No agent can self-grant human approval
merely by setting status to closed.

Because worktrees share the same Lanes store through Git's common root,
**concurrent agents can touch the same journals**. Lanes recommends one
coordinator for shared records and separately owned source changes;
short file locks do not implement a distributed task lease.

## Reading execution status

Status is derived from the current Paseo host's workspace and agent
directories (with subscriptions and a 15-second backstop refresh).
**Running** means a matching agent is `running` or `initializing`;
it is not inferred from Lanes planning status. **Needs input** means an
agent requires a response. **Idle** means the work has a workspace but
no active agent. The counts for Goals and Lanes are for agents started
*on those specific records*; a Running filter also displays ancestor
groups around directly running Task records.

Workspaces on other Paseo hosts are not read by this first integration:
install the plugin on each relevant daemon host to view its local
Lanes projects and executions. Do not interpret a missing local
workspace as proof no work is running on another host.

## Resource management

The resource manager runs once in the plugin's daemon-side process, including
when the Lanes screen is closed. It is enabled by default. Configure or disable
it in **Lanes settings → Resources**; settings apply to this Paseo host and are
independent of model defaults and each Lane's worker budget.

| Setting | Default |
|---|---|
| Sample interval | 15 seconds |
| Sustained pressure or recovery | 3 consecutive observations for the same resource |
| Memory warning / critical | 85% / 95% used |
| CPU warning / critical | 90% / 98% busy across host CPUs |
| Memory / CPU recovery | Below 80% / 80% used |
| Repeated notice cooldown | 120 seconds per manager |
| Old idle priority | At least 5 minutes since the native agent's last update |

Memory uses Linux `MemAvailable`, macOS's query-only `memory_pressure -Q`
kernel availability percentage, or Windows available physical memory. Linux
reclaimable cache is included in available memory. CPU is measured from changes
in host CPU counters; its first observation is unknown. Missing or unsupported
measurements stay **Unknown** and cannot trigger pressure or claim recovery.
These are machine-level observations; they do not estimate individual agent
costs or account for container-specific CPU/memory quotas.

Warning and critical pressure need consecutive samples, so short spikes do not
produce cleanup requests. A critical signal remains latched until its resource
stays below the lower recovery threshold. Escalation can bypass the repeated
notice cooldown. Resource sampling continues during cooldown; directory/CLI
discovery is limited to at most once every 30 seconds under stable pressure
(or the sample interval when longer), with immediate eligibility on a measured
pressure transition. Checks do not overlap.

### What Lane Managers receive

The plugin reads the central `lanes lane manager list --all --json` projection
and reconciles it with the current daemon's agent/workspace directory and
project boards. It also supports verified legacy claims and labeled managers.
Canonical registrations can associate a local manager with several projects;
the manager's own workspace need not be in each managed repository. A stopped
association is respected. Missing, archived, closed, conflicting, and remote
sessions are excluded. Registrations and claims alone never prove liveness.

Dev candidates must have coherent `lanes.ref/projectId/kind` or
`clips.ref/projectId/kind` labels that agree with their actual workspace project
and exact Goal/Task membership. Conflicting or incomplete labels are excluded.
Sharing a workspace, branch name, or title does not make an agent a Lane Dev.
Live developers on historical closed records are still eligible candidates.
Managers are protected from being suggested as devs, and a manager receives one
combined request for its relevant Lanes.

The request asks the manager to:

1. Pause new dev dispatch while resources remain constrained.
2. Review old idle devs first, then other idle devs. Age and status are hints;
   verify a durable handoff and absence of ongoing writes before retirement.
3. If more capacity is needed, ask current developers to checkpoint and hand
   back their refs, exact candidate, changed paths, checks, decisions, blockers,
   and remaining work, then retire them at a safe boundary.
4. Use supported non-destructive close/archive actions, preserve source,
   worktrees, transcripts and association history, and verify native readback.
   Process retirement does not close or accept a Goal or Task.

The plugin sends requests to managers; it never directly stops or archives
agents. Pending human review does not require keeping an otherwise idle worker
alive. Shared managers are asked to coordinate. A recovery notice goes only to
previously advised managers that are still observed and associated; it allows
them to reassess already-authorized work within their existing budget.

### Delivery and lifecycle limits

Before each send, the plugin refreshes the manager and requires an idle,
unarchived, available session with no active turn or pending input and unchanged
workspace/identity labels. Busy managers are deferred to later checks. Sends use
explicit `activeTurnBehavior: "steer"`, with no retry using the interrupting
default. Paseo 0.11.2 has no atomic send-if-idle or queue-if-busy operation:
a manager can become busy between refresh and send, and providers without
steering support can replace that intervening turn. Messages therefore ask
managers to recheck current resources and session state before acting.

Cooldown is reserved before sending because a timed-out request may already
have arrived. Failures remain visible in Resources and do not prevent other
managers from being notified. Invalid settings fail closed; the monitor does
not silently enable default policy. Disabling monitoring or unloading the
plugin cancels pending future sends and releases timers, hooks and settings
listeners; an already submitted send cannot be recalled.

The 0.11.2 SDK supplies its daemon API on lifecycle hooks or RPC invocation.
Sampling starts on plugin activation, and notification discovery begins after
the first such callback. After a reload on a completely quiet host, open Lanes
or wait for native agent activity to bind that context. The Resources panel
reports **Waiting for Paseo connection** until it is available. Monitoring does
not create a replacement manager or an extra daemon connection.

The separate host settings document is `resource-manager`; the read-only
`clips.resource-manager.status` RPC returns its monitor state, latest sample,
pressure reasons, successfully notified manager count for the current episode,
deferred-manager count, last notice time, and latest error. Disabling the
monitor stops further advice; managers should still recheck actual resources
before resuming any paused dispatch.

## Development

From the plugin directory, install its development and standalone CLI dependencies:

```sh
cd plugins/paseo
npm ci --ignore-scripts
npm run typecheck
npm test
paseo plugin install "$PWD"
paseo plugin reload clips-workspaces
paseo plugin logs clips-workspaces
```

Paseo supplies host SDK, React and Zod modules to compiled entries and compiles the
TypeScript source itself. The plugin never requires bundling a second
React, a daemon, or a Lanes journal parser.

- `shared/`: RPC contracts, stable work identity, running-state mapping.
- `server/`: Lanes CLI adapter, safe project/worktree lookup, agent launch.
- `client/`: React Native-compatible hierarchy, live directory observation,
  project selection, filters, launch/open actions and agent settings.

Trusted plugins run daemon-side commands with the user's account privileges.
Install only reviewed code; external work-record text should also be
treated as instructions to review rather than unconditional authority.

Installation/update behavior follows Paseo's [plugin source and CLI reference](https://paseo.sh/docs/plugins/reference#plugin-sources)
and [Git preparation guidance](https://paseo.sh/docs/plugins/publishing#share-through-github-or-git).
