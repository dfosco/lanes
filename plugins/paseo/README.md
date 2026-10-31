
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
- **GitHub collaboration:** In a repository workspace's Lanes panel, the
  repository collaboration control changes only that repository's configuration.
  Sync targets its Git origin, not the plugin repository. Toggling does not publish.
  When enabled, later supported Lanes record mutations may sync automatically.
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
paseo plugin ls lanes --json
```

The runtime ID is `lanes`. The explicit `git:` prefix selects the
repository rather than a registry listing. Paseo keeps the full monorepo checkout,
including the canonical Lanes CLI and skills. Preparation runs these exact commands
from `plugins/paseo` before Paseo moves and activates the candidate:

Installations from before the rename used the ID `clips-workspaces`. Remove that
old plugin entry before adding `lanes`; keeping both enabled makes CLI source
discovery ambiguous. The rename does not change the Lanes data store.

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

Save the current Git revision from `paseo plugin ls lanes --json`
before updating. Review the proposed revision, then apply it:

```sh
paseo plugin update lanes --check
paseo plugin update lanes
paseo plugin ls lanes --json
paseo plugin logs lanes
```

An ordinary Git update proposes the remote's default HEAD. The initial `--ref`
does **not** pin future updates. Select a reviewed commit explicitly to update
or roll back without a second CLI prompt:

```sh
paseo plugin update lanes --ref <reviewed-commit-sha>
```

Install/update runs both locked preparation commands before validation and
activation. Failed preparation or activation retains the previous installation.
A successful update must be rolled back explicitly to the saved commit; there is
no automatic persistent version pin. Directory sources are skipped by `update`:
restore the desired full checkout revision, rerun preparation, then use
`paseo plugin reload lanes`. Reload itself does not install dependencies.
An existing runtime ID is rejected by install. Switching an existing directory
installation to a Git source requires an explicit remove and add; do not use that
as an update or discard a development checkout unintentionally.

The native Paseo integration does not need retired web-board assets. Distribution
checks do not claim native UI rendering or agent-provider parity.

Run **Lanes** from the Paseo sidebar or Command Center. Configure a ready
provider in Paseo to start agents. **Lanes settings** selects launch defaults.

**CLI resolution:** The backend reads public `paseo.config.get()` plugin sources.
It selects the single enabled source whose manifest ID is `lanes` (and recognizes
the former `clips-workspaces` ID for existing installations), then runs that full checkout's `src/cli.js` with the server's
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
The current runtime ID is `lanes`; existing Lanes records and session keys are unchanged.

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

The resource manager runs once in the plugin's daemon process, including when
Lanes is closed. It is enabled by default. Configure it in **Lanes settings →
Resources**. Settings apply to this host independently of model defaults.

| Setting | Default |
|---|---|
| Sample interval | 15 seconds |
| Sustained pressure or recovery | 3 consecutive observations for the same resource |
| Memory warning / critical | 85% / 95% used |
| CPU warning / critical | 90% / 98% busy across host CPUs |
| Memory / CPU recovery | Below 80% / 80% used |
| Repeated notice cooldown | 120 seconds per manager |
| Old idle priority | At least 5 minutes since the native agent's last update |
| Memory allowance per additional dev | 1,024 MiB |
| CPU allowance per additional dev | 10% of total host CPU |
| Launch reservation | 120 seconds |

Memory uses Linux `MemAvailable`, macOS's query-only `memory_pressure -Q`, or
Windows available physical memory. CPU uses changes in host CPU counters; its
first observation is unknown. Unsupported measurements stay **Unknown**.
Measurements are host-wide; they do not attribute resource use to individual
agents or account for container-specific quotas. Per-dev allowances are tunable
admission estimates, not measured per-process costs or enforced resource limits.

Warning/critical notices require sustained pressure; lower recovery thresholds
avoid flapping. Critical escalation bypasses the repeated-notice cooldown. A
fresh measurement at a critical threshold also permits immediate emergency
folding without waiting for the advisory streak. Directory discovery runs every
30 seconds (or the sample interval when longer) during both healthy and pressured
operation, and refreshes on pressure transitions and launch reports. Sampling and
discovery do not overlap themselves.

### The manager capacity channel

The plugin reconciles central `lanes lane manager list --all --json`
registrations, verified legacy claims and coherent labels with current native
agents, workspaces and project boards. Explicit registrations support central or
cross-project managers. Stored associations alone never establish liveness.
Remote, stopped, ambiguous and closed managers are excluded. Dev attribution
requires coherent `lanes.ref/projectId/kind` or `clips.ref/projectId/kind` labels,
actual workspace identity, and exact Goal/Task membership. An archive marker
without confirmed native closure keeps a dev visible and counted for retry.

Every observed manager has a bidirectional channel, including while it is busy.
Healthy capacity changes and pressure instructions are sent to eligible managers;
status/watch reads also expose fresh numerical headroom, reservations and the
manager's handoff inbox without sending an interrupting chat message.

```sh
node plugins/paseo/cli.js resources --manager <native-manager-id> --action status
node plugins/paseo/cli.js resources --manager <native-manager-id> --watch
node plugins/paseo/cli.js resources --manager <native-manager-id> \
  --action reserve --count 3 --request-id <unique-batch-id>
node plugins/paseo/cli.js resources --manager <native-manager-id> \
  --action report --reservation <returned-id> --agents <dev-id-1,dev-id-2>
node plugins/paseo/cli.js resources --manager <native-manager-id> \
  --action release --reservation <returned-id>
```

The watch prints status every 15 seconds. Use the installed plugin's absolute
CLI path when outside its checkout. The existing `--url`, `PASEO_WS_URL` and
`PASEO_PASSWORD` connection options apply. The pinned SDK's exported
`internal/daemon-client` adapter supplies plugin RPC transport, as it does for
Paseo's native CLI; the public `createPaseoApi` supplies native actions.

Additional capacity is the smaller of available memory headroom divided by the
memory allowance and CPU headroom divided by the CPU allowance, minus all
outstanding host reservations. Headroom stops at the warning thresholds. Unknown
metrics or pressure grant zero; an available manager with zero capacity is not a
reason to use the fallback. Observations expire after the larger of 60 seconds
and three sample intervals. Incomplete discovery, disabled monitoring and stale
observations explicitly return `available: false`.

Reserve before launching, use only the granted count while `valid` is true, and
report the exact observed native IDs after launch. `count` is the original grant;
`agentIds` identifies reported starts. Recheck status before each launch. Reuse a
request ID only for the same request; retries never issue a second grant. Reported
capacity stays held until a newer sample and directory observation account for
those agents. Expired grants cannot launch; accounting holds persist until fresh
observations cross expiry. Release returns only unused slots. Managers share one
synchronous ledger, so they cannot independently reserve the same headroom.

Fresh live capacity replaces the stored `lane_max_active_agents` limit. That
setting's default of five applies only when resource management is unavailable,
stale or disabled. Explicit user ceilings and native quotas always apply. Idle
and finished-but-unclosed sessions still occupy capacity. Reservations and the
inbox are plugin-process caches: after reload, reread native state and acquire a
new grant; prior reservation IDs are not permission to launch.

### Context-preserving folds

**Always fold finished devs promptly**, even while their Goals await human
review. Normally a dev returns its latest context as its final work action; the
manager reads and acknowledges the Goal attachment before shutdown.

```sh
node plugins/paseo/cli.js handoff --manager <native-manager-id> \
  --agent <native-dev-id> --context-file /absolute/latest-context.md \
  --reason completed --handoff-id <unique-uuid>
node plugins/paseo/cli.js resources --manager <native-manager-id> --action status
node plugins/paseo/cli.js fold --manager <native-manager-id> \
  --agent <native-dev-id> --handoff-id <returned-uuid>
```

The handoff goes through `lanes handoff record`, which writes immutable Markdown
in the shared repository store and attaches it to the exact namespaced Goal.
Task assignments attach to their parent Goal. Include refs/revisions, the
worktree and candidate, changes, checks, decisions, blockers, unfinished work and
external effects. Multiple assigned Goals each need their own attachment. The
channel's `pendingHandoffs` includes context and attachment receipts so the actual
manager can read them before acknowledging the ID. Artifacts survive plugin
reload; restore an inbox entry with the same context and ID only after verifying
that it remains current. Further work requires a new handoff.

Normal folding requires an idle dev and its latest complete receipt. New turns,
changed assignments, changed idle-session state, and context writes still in
flight invalidate old acknowledgments. The handoff's own turn may finish before
archiving. Treat submitting context as the final work action, and submit a new
handoff after further substantive work. Handoff IDs support exact retries, not
updates. The core command is also available on other harnesses:

```sh
lanes handoff record '#g001#t01' --file handoff.json
```

**Critical pressure closes first.** The manager can run `fold` without a handoff
ID; the plugin confirms current attribution and invokes native archive without
waiting for context, acknowledgment, a checkpoint or a file write. After closure
it attaches the last available context or an emergency note with
`reason: resource_critical` and `incomplete: true`. A failed attachment is reported
for recovery; it does not delay or undo the native shutdown. Unfinished Tasks
remain unfinished. Preserve any late developer context with the core handoff
command and inspect the retained worktree/transcript before resuming.

Paseo archive closes the provider runtime and prunes the agent's tabs. Stop only
cancels a turn; detach only removes parent linkage. The plugin reads back
`archivedAt` plus `status: closed` before reporting a successful fold. If archive
fails, it still checks native state: a runtime closed before a later archive
error can retain its emergency context; a still-live or unknown runtime remains
unconfirmed and counted. The SDK archive path can retry an archived-but-live
runtime. No source, worktree, transcript, Goal or Task is deleted by folding.

### Delivery and lifecycle limits

Ordinary notices require a freshly observed idle, unarchived manager with no
pending input and unchanged workspace/identity. Critical notices can reach a
running manager immediately. Sends explicitly request `activeTurnBehavior:
"steer"`; providers without steering support can interrupt the current turn,
which is intentional for critical relief. The SDK has no atomic send-if-idle or
close-if-unchanged operation, so a native state change can race the final
readback/action. Managers must recheck assignments and resources before acting.
Process exit behavior is provider-owned; the plugin verifies the native lifecycle
acknowledgment rather than claiming independent OS proof for every descendant.

Cooldown is reserved before send because a timed-out request may already have
arrived. One failed manager does not stop other notices. Invalid settings fail
closed. Disabling monitoring or unloading the plugin cancels future advice;
already submitted native actions cannot be recalled. Normal completion folding
still applies when monitoring is disabled; use core handoff plus native archive
if the plugin channel itself is unavailable.

The SDK first supplies its daemon API through a hook or RPC. Sampling starts at
activation; open Lanes, call the resource CLI, or wait for native activity to bind
a quiet reloaded host. The Resources panel reports this waiting state. Monitoring
does not create a replacement manager. Host settings use `resource-manager`;
`clips.resource-manager.status` exposes diagnostics, while `clips.resources.channel`,
`clips.resources.handoff` and `clips.resources.fold` implement coordination.

## Development

From the plugin directory, install its development and standalone CLI dependencies:

```sh
cd plugins/paseo
npm ci --ignore-scripts
npm run typecheck
npm test
paseo plugin install "$PWD"
paseo plugin reload lanes
paseo plugin logs lanes
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
