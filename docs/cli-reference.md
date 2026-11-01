# Lanes command and workflow reference

For installation, onboarding, and everyday use cases, start with the
[README](../README.md). This reference covers manual commands, record formats,
coordination rules, and maintenance.

`lanes` keeps local work contracts for agents and people. A goal holds the
outcome and plan. A task starts as an atomic change request and becomes the
record of what changed and was accepted. System components give related tasks
stable boundaries to rely on.

Workflow state stays under `.lanes/`, outside repository history. GitHub
collaboration is available after explicit opt-in.

> This reference describes Lanes 2.0.0. Earlier
> releases can have a different command set; the 1.6.0 baseline did not include
> the component, acceptance, and revision capabilities below. Check
> `lanes --help` for installed commands, or use
> `node /path/to/lanes/src/cli.js` to run this checkout.

## Work model

| Record | Purpose | Example |
|---|---|---|
| Lane | Strategic, conceptual frame spanning related goals; closes with a product/system retrospective rather than engineering acceptance | `#l1` Workspace experience |
| Goal | Engineering outcome, scope, plan, architectural decisions, and outcome acceptance | `#g1` Restore the last workspace |
| Task | One independently assignable and acceptable change; request before, record afterward | `#g1#t1` Persist the selected workspace ID |
| System component | Persistent responsibility with a behavioral boundary and implementation references | `#c1` Workspace preference storage |

A Lane is the strategic frame above goals. It explains the product direction and
groups outcomes that make sense together over time. It deliberately does not
carry technical acceptance criteria or verification receipts. Closing a Lane
records what product goals were achieved, the decisions made across its goals,
the resulting system/component overview, and useful product media such as
screenshots.

A goal's plan describes how to reach one engineering outcome; its decisions
explain why the approach was chosen. They can evolve in the same record. An
independent ADR is optional when a decision needs a separate lifecycle.

A component is a unit of responsibility that other system parts or tasks can
depend on. It describes its interface or observable behavior, constraints, and
source or specification references. It can span files or live inside a larger
package. Its identity survives a move or internal refactor while its
responsibility remains coherent.

Task scope selects components and states what will change and what constraints
apply. Contracts, constraints, and decisions use named Markdown sections or
authoritative source links. Ordinary implementation steps are lists. Add a task
when a change can be owned and accepted independently.

Use as much structure as the work needs. Optional `sections` and `extensions`
let agents add named Markdown, project metadata, or relationships. There is no
mandatory parallel CR, execution note, or extra identifier for every interface
or invariant.

Read [the precise work model and JSON fields](work-contracts.md) or
[the complete small-feature example](work-contract-example.md).

### Agent execution policy

For authorized delivery, the execution skills use comprehensive plans within one coherent Lane,
detailed Goals with observable acceptance criteria, meaningful Tasks and real
dependencies, followed by implementation and verification. Reuse existing
records and preserve selected-Task or atomic scope. Comprehensive means complete
coverage, not filler work. Explicit brainstorming, plan-only, defer, queue or
narrower-output requests override that default. A plan or launch preview is not
implementation. Lane Manager plans and coordinates continued delivery through
the current harness's execution path. Lane Dev plans, implements and verifies
an outcome in its own session, either directly for the user or as a delegated
dev owner. Lanes supplies the durable work contracts and acceptance mechanics.
Lane Manager continues through the agreed outcome without requiring another
skill or a routine "go" between tasks.

For new scope without an explicit user-selected mode, Lane Manager asks:
1. Run planning + breakdown + implementation (default).
2. Run planning + breakdown and ask for validation.

The default is a displayed recommendation, not consent by silence. Plan-validation
stops before implementation or worker launch. Explicit and prior authorization
are reused without repeated task-by-task prompts. Lane Radar separately handles
on-demand external intake, PR preparation and proposed routing. It does not
delegate work or continue delivery; third-party requests do not authorize
execution or external actions.

Host identity, Lane claims, management roles, and previous session associations
are not prerequisites for authorized work. The canonical CLI does not require a
host ID or a manager claim. Work `owner` fields are advisory responsibility
metadata, not execution locks. Preserve attribution and coordinate actual
overlapping edits rather than clearing owners or history to proceed.

Agents use the CLI for records and their host's supported tools for session
steering and communication. An existing dev owner needs no extra session just
for an identity or role. Per-agent
instructions cannot disable hardcoded checks in a host integration. The packaged
Copilot canvas sends only to its actual joined session; native App tools still
provide direct-child creation and cross-session steering.

In GitHub Copilot App, dev sessions delegated by a Lane Manager are its direct,
coordinated children. There is no intermediate coordinator, Squad Leader or dev-lead
App session. The manager creates any useful sibling workers; the dev owner
retains technical integration responsibility without spawning nested workers.
Native readback checks both creator fields, repository and workspace; native
messages preserve manager contact and user steering throughout execution.
Paseo instead keeps its verified top-level manager-to-dev path. A standalone
Lane Dev session does not need a manager or a new parent. These are
host-specific instructions, not a new runtime launcher or scheduler. On other
harnesses, Lane Manager must invoke available native sub-agents even if they
are not user-steerable. If no delegation primitive exists, the manager implements and
verifies authorized Tasks itself, linearly in dependency/dispatch order. That
fallback does not bypass denied authorization or missing tools/files.

Authentication, external-action approval, exact action targets, acceptance
attribution, atomic writes, journal locks, and stale-revision checks remain
separate safeguards. See [coordination policy](work-contracts.md#management-policy).

Dispatch follows a visible contract: preserve the selected mode; persist or reuse
full Goal/Task requests, coverage and real prerequisites; read them back; show the
refs and worker mapping; mark ready Tasks `in_progress` before launch or resume;
then dispatch exact refs, request revisions and write boundaries. Attach observed
session identity after creation. Missing, failed or stale writes and true blockers
stop the affected dispatch. Amend the request before redirecting work, and assess
returned evidence against that request. This is agent policy, not a native scheduler.

## Lane worker budget

Lane Manager keeps two-way contact with the live resource manager: read fresh
capacity at planning boundaries and before dispatch, reserve grants, and report
actual launches, handoffs, folds and failures. Fresh enabled resource-manager
capacity replaces the stored `lane_max_active_agents` value. That value is
**only the fallback when the resource manager is unavailable, stale or disabled**,
not an extra ceiling on live grants. Explicit user ceilings and native host
quotas apply in both cases, on local and cloud harnesses.

The fallback defaults to **5 workers per Lane**, excluding the Lane Manager.
Each Lane has its own fallback; it is not a project-wide pool or lifetime quota.
Read or change it with:

```bash
lanes config lane_max_active_agents          # Read the fallback; absent means 5
lanes config --lane-max-active-agents 3       # Store the per-Lane fallback
lanes config lane_max_active_agents 3        # Equivalent key/value syntax
lanes config --help
```

Values must be positive safe integers written as decimal digits. Invalid values
or flag forms fail without writing configuration. Invalid stored limits fail
readback instead of becoming unlimited; a valid setter can repair that field.
Malformed configuration is not overwritten by a limit update. Unrelated
settings are preserved.

Announce the effective allocation and its source before dispatch. An explicit
instruction such as "use at most two workers for this Lane" remains a ceiling
without changing the stored project fallback. Reserve before launch and count
starting, running, idle and finished-but-unclosed sessions, including permitted
nested helpers. Release capacity only after native session/process closure is
verified. Unknown or ambiguous activity is not free capacity. Always fold
finished developers promptly; do not keep idle sessions for future work or
pending human review. When capacity is full, keep new work pending.

The CLI validates configuration; the resource manager and harness provide actual
capacity and closure. **Lanes configuration alone is not an OS process limit or
cross-session scheduler.** A stored fallback change does not itself terminate
workers. Copilot still uses direct children without nested workers; other
harnesses retain their supported delegation paths. Cloud metadata does not
create an unlimited-capacity exception. A harness with no delegation primitive
uses the existing linear fallback; a full budget does not make an available
primitive disappear.

## Developer handoffs and folding

A fold closes the actual native agent/sub-agent/session or tab **and its owned
runtime process**, while preserving source, worktrees, transcripts and history.
A completed Task, idle session, detached child, hidden tab or interrupted turn
is not a fold. Verify native closure and runtime effects before releasing
capacity; report missing host capabilities rather than inventing a successful
close.

Always fold a developer promptly when its bounded assignment ends. For normal
completion, reassignment or warning-level resource pressure, get its latest
context to the manager, persist it on each respective Goal, have the manager
read and acknowledge the attachment, then close. Human Goal review and
hypothetical follow-up never justify keeping finished developers open.

```bash
lanes handoff record '#g1#t1' --file handoff.json
lanes handoff record '#g1' --stdin
```

`handoff.json` contains `context`, the observed `agent_id` and `manager_id`, and
`reason`: `completed` (default), `resource_warning`, `resource_critical`, or `reassignment`.
Optional fields are `incomplete` and `handoff_id` (a UUID for idempotent retries).
A Task ref resolves to its parent Goal. The command writes immutable Markdown
and attaches it to that Goal; read back the returned attachment before normal
closure. Repeat with a distinct ID for each Goal covered by a worker; changed
context also needs a new ID. Keep exact request refs and revisions,
artifact/changed paths, checks/results, decisions, blockers and remaining work,
and active side effects in the context. This local command does not deliver the
context to a manager, close a session, accept work or grant human approval;
manager acknowledgment and closure use the host's actual communication/runtime
interfaces.

**Critical resource pressure closes immediately**, without waiting for fresh
context, manager acknowledgment, attachment, checkpoint or quiescence. Retain
already available context; after closure, attach it using
`reason: resource_critical` and `incomplete: true`, recording interrupted work,
unresolved effects and any closure/persistence failures. If no context was
available, this reason with `incomplete: true` permits an empty `context`; the
command creates an explicit missing-context emergency note. The emergency path
changes the order, not the obligation to preserve available context.

The [packaged Paseo procedure](../.agents/skills/lanes/references/paseo.md#resource-coordination-and-folding)
describes its resource channel and verified archive path. On other harnesses,
use discovered native close operations with the same normal/critical policy;
do not assume a stop command closes a session or process.

## Delivery configuration

Project delivery preferences bound Lane Dev assignments and define validation,
commit and pull request handling defaults:

| Key | Default | Accepted values |
|---|---|---|
| `lane_dev_max_tasks` | `3` | Any positive safe integer |
| `lane_validation_mode` | `human` | `human`, `agent` |
| `lane_commit_mode` | `after_validation` | `after_validation`, `manual` |
| `lane_pr_mode` | `none` | `none`, `prepare`, `draft`, `ready` |

Read or set a preference with `lanes config <key> [value]`. For example:

```bash
lanes config lane_dev_max_tasks
lanes config lane_dev_max_tasks 2
lanes config lane_validation_mode human
lanes config lane_commit_mode manual
lanes config lane_pr_mode prepare
```

The Task limit caps the number of Tasks assigned to one Lane Dev session. Its
assignment ends when those Tasks finish, even if it handled fewer than the cap;
the cap does not authorize indefinite worker reuse. `human` is the default
mode for requested Goal review, but it does not require human review for every
Goal. A completed Goal may be accepted and closed without Goal-level review
with the `not-reviewed` label; review may happen at Lane level or manually
later. An authorized agent can accept engineering Tasks when their own gate is
satisfied. Neither validation mode overrides an explicit human gate. Commit mode describes
the handoff: `after_validation` means after automated dev checks and before
manager analysis or user validation; the dev may commit its checked, scoped
changes when the task contract authorizes it. `manual` leaves an explicit
commit handoff. The setting alone does not grant commit authority.

PR mode describes the desired result (`none`, prepared material, a draft PR, or
a ready PR). It never authorizes creating or changing a PR, posting messages,
requesting reviewers, or taking any other external action. Those actions still
require explicit user authorization. These preferences guide Lane Manager and
Lane Dev procedures; the CLI does not enforce scheduler, validation, commit, or
publication gates. Invalid delivery values and malformed stored delivery
settings fail visibly. A rejected update leaves the stored file unchanged.

## Lane execution model preferences

Model preferences resolve from project configuration, then user configuration,
then built-in defaults. New Lane Managers use `gpt-6.1-sol` with `high` effort;
new Lane Dev workers use `gpt-6-luna` with `high` effort. The preference is a
request to the execution host, not a guarantee that the model is available.
Opaque model identifiers are stored without a catalog check; fallback belongs
to dispatch policy.

These values configure new sessions only. In particular, applying a saved
manager preference must not change an existing, resumed, or reused Lane
Manager's selected model or effort. Explicit user choices for a particular Lane
or worker take precedence over configured defaults. Before launch, the host
must confirm supported model/effort values through its actual catalog, help or
tool schema. A fallback is disclosed and does not rewrite preferences; the
requested value, launch value and host-reported effective value are distinct.
See the [Lane Manager model policy](../.agents/skills/lane-manager/SKILL.md#resolve-model-preferences-and-fallbacks)
for host-specific handling and ambiguous-launch reconciliation.

```bash
lanes config lane_manager_model                         # Read the effective value
lanes config lane_manager_reasoning_effort high         # Set a project override
lanes config --user lane_dev_model gpt-6-luna           # Set a user preference; works outside Git
lanes config --user lane_dev_model                      # Read that user preference outside Git
lanes config lane_dev_model custom-model                # Override for this project
lanes config lane_dev_model                             # Read the project override
lanes config lane_dev_reasoning_effort                  # Read the effective effort
lanes config lane_dev_model --unset                     # Remove a project override
lanes config lane_dev_model                             # Inherit the user preference
lanes config --user lane_dev_model --unset              # Remove a user override
lanes config lane_dev_model                             # Inherit the built-in default
lanes config --help                                     # List all model preference keys
```

The keys are `lane_manager_model`, `lane_manager_reasoning_effort`,
`lane_dev_model`, and `lane_dev_reasoning_effort`. Unsetting an override resumes
inheritance from the next scope. Project initialization and unrelated project
configuration writes do not store inherited model defaults as overrides.

## Quick start

Initialize inside a Git repository:

```bash
lanes init
lanes goal create '{"title":"Restore the selected workspace","description":"Reopen the last available workspace after reload","plan":"Implement persistence, then integrate selection","decisions":"Store the workspace ID and validate it against current workspaces","acceptance_criteria":[{"id":"A1","description":"Reload restores the last available workspace"}]}'
lanes component create '{"title":"Workspace preference","responsibility":"Persist the selected workspace ID","contract":"Read returns an ID or no preference; storage failures do not block startup","source_refs":["src/workspace-preference.js"]}'
lanes task create g1 '{"title":"Persist workspace preference","description":"Read and write the selected workspace ID","components":["#c1"],"scope":"Persistence boundary and its failure behavior","acceptance_criteria":[{"id":"A1","description":"A stored ID can be read back"},{"id":"A2","description":"Unavailable storage does not throw"}]}'
lanes task status g1 t1 in_progress
lanes view '#g1#t1' --json
```

The examples assume an empty store; use the refs returned by your commands.
The CLI accepts shorthand refs and may display padded forms such as
`#g001#t01`. Quote hash refs in shell commands.

Create and update commands accept inline JSON, `--file path.json`, or
`--stdin`. A task result file can preserve the original request while adding
the actual change:

```json
{
  "record": "Describe the implemented behavior, compatibility impact, and relevant verification.",
  "sections": {
    "Amendments": "Record material changes to the agreement and why."
  }
}
```

Apply the result, then record acceptance after verifying it:

```bash
lanes task update g1 t1 --file task-result.json
lanes task accept g1 t1 --file task-acceptance.json
```

An acceptance file contains the artifact actually checked, the accepting actor,
a summary, and evidence for every criterion. See the
[acceptance schema](work-contracts.md#acceptance) for a complete example.

## Stable references and history

| Reference | Meaning |
|---|---|
| `#l1`, `#g1`, `#g1#t1`, `#c1` | Current Lane, goal, task, or component |
| `#g1#A1`, `#g1#t1#A1` | Acceptance criterion belonging to an engineering record |
| `#l1#r1`, `#c1#r1`, `#g1#t1#r1` | Recoverable record snapshot |
| `#g1#t1#r1#A1` | Criterion in a particular task snapshot |

Criteria retain their IDs when reordered. Removed IDs are not reused. Revisions
use one history mechanism across goals, tasks, and components; they are record
snapshots, not versions of the executable code.

```bash
lanes view '#c1#r1' --json
lanes view '#g1#t1#A1' --json
lanes view '#t1#A1' --goal '#g1' --json
lanes history '#g1#t1' --json
lanes component history c1
```

Include the commit, tree/diff identity, or immutable artifact reference with
verification evidence. A record revision or Git HEAD alone does not identify the
contents of a dirty working tree.

## Review Markdown handoff

`lanes review open <record-ref|review-id>` exports the exact pinned CR to a
stable Markdown file under the selected project's excluded workflow store and
prints its absolute path. `--json` returns the path with the review ID, pinned
candidate, reviewer, status, coverage and stale reasons. Work refs resolve only
actionable requests whose request-time coverage includes that exact Lane, Goal
or Task. A Goal review covers its pinned Task obligations; Tasks created later
need a refreshed review request. Ambiguous matches require an explicit review
ID. Opening or editing the exported copy does not change the original CR,
review journal or approval.

```bash
lanes review open '#g1#t1'
lanes review open rev-00000000-0000-4000-8000-000000000000 --json
```

## Acceptance and administrative status

`task accept` and `goal accept` record structured receipts tied to a request
snapshot. An assessment names each criterion and supplies evidence or an
authorized waiver. Contract changes invalidate affected acceptance while
preserving its history. `accepted_by` must match a configured
`acceptance_owner`; both are metadata, not authentication.

Lanes checks receipt structure. It does not execute verification commands,
validate the truth of submitted evidence, or grant approval authority. Agents
must inspect the actual result and respect human-owned approvals.

Receipts also capture `component_basis` as pinned component refs. Explicit pins
are honored; current refs resolve at acceptance time. Pin a negotiated baseline
before assignment when it must remain fixed. Later component edits do not
automatically reopen tasks across separate journals. The receipt's `artifact`
identifies the accepted result; explicit acceptance clears the legacy
`closed_commit_sha` field.

`status closed` remains an administrative status update for compatibility. It
records HEAD but does not create acceptance evidence. Goal acceptance also requires all child
tasks to be terminal; `not_planned` or `duplicate` children need explicit
exceptions in the goal receipt. Existing closed tasks do not receive fabricated
acceptance receipts. A selected-task assignment can finish without closing its
whole goal.

Goals and tasks retain the statuses `open`, `in_progress`, `closed`,
`not_planned`, and `duplicate`. Components use `active` and `retired`.

### Behavior and verification modes

Goals and tasks can carry optional behavior descriptions, including Gherkin-style
scenarios. Lanes stores this text without parsing or executing it.

- `behavior`: verify relevant observable behavior using methods suitable for
  the repository and change.
- `behavior_and_tests`: include relevant automated test evidence as well as
  checking behavior.

Tasks inherit their goal's mode unless overridden. Setting a task's mode to
`null` restores inheritance. Legacy records without a mode use `behavior`.
The mode does not prescribe a language, framework, or test-writing order.
Types can establish structural contracts; runtime behavior still needs suitable
evidence.

## Dependencies and strategic Lanes

Component `dependencies` describe system relationships. Task `blocked_by`
describes required work ordering. An agreed interface can let a provider and
consumer be implemented in parallel; integrated acceptance still checks their
interaction. Dependencies are coordination data, not an automatic scheduler.

A **Lane** is an optional strategic frame for related goals. A goal belongs to
at most one Lane. Lanes are intentionally less formal than goals: they can carry
a description and product goals, but they do not have technical acceptance
criteria, test evidence, or an acceptance owner.

```bash
lanes lane create '{"title":"Workspace experience","description":"Make returning to work feel continuous","product_goals":["Users return to the right workspace quickly"]}'
lanes goal assign g1 l1
lanes goal update g2 '{"blocked_by":["g1"]}'
lanes lane show l1
lanes goal assign g1 none
```

When a Lane is closed, Lanes records a strategic retrospective rather than an
engineering acceptance receipt. Closure requires a summary, a cross-goal decision
log, a system overview, and the product goals achieved. It also snapshots the
Lane's goals and their statuses, derives referenced components from those goals
and tasks, and can include screenshot or other product-media references.

```json
{
  "summary": "Workspace restoration is now coherent across reload and switching.",
  "decision_log": "We standardized persistence on stable workspace IDs.",
  "system_overview": "Workspace preference owns persisted selection; project selection consumes it.",
  "product_goals_achieved": [
    "Users return to the intended workspace after reload"
  ],
  "media": [
    {"src":"screenshots/workspace-restored.png","caption":"Restored workspace"}
  ]
}
```

```bash
lanes lane close l1 --file lane-closure.json
lanes view '#l1'
lanes view '#l1#r1' --json
```

Lanes can be moved to `in_progress`, `not_planned`, or `duplicate` without
technical ceremony. The `closed` state uses `lane close` so the retrospective
is not lost. Merely sharing a Lane does not make goals dependent on one another.

Historical Tracks remain readable. Existing `#r001`, `track_id`,
`.lanes/db/tracks/`, and `lanes track` data/commands are compatibility
surfaces; current UI and agent guidance use `#l001`, `lane_id`, and
`lanes lane`. GitHub collaboration mirrors Lanes as parent issues containing
their goal issues.


## Storage and compatibility

Goal/task events live under `.lanes/db/`. Component events live under
`.lanes/components/`. Components default to repository-wide storage: `#c1` does
not change when the configured user changes. Explicit component namespaces such
as `#alice#c1` remain available; goal/task namespaces keep their existing behavior.
Independent legacy CR and ADR Markdown records live under `.lanes/records/{cr,adr}/`.

Workflow instances must not be committed. Lanes adds `.lanes` to the
repository-local `.git/info/exclude`; no shared `.gitignore` change is needed.
Committed product documentation and source describe shipped behavior.
Committed templates define formats, not record instances.

Worktrees share the workflow store through the common repository root. Use one
coordinator for shared record writes by default. Revision checks and short file
locks reduce specific write hazards; they do not provide distributed task
ownership, leases, or a scheduler.

Existing Track relationships are exposed as legacy Lane aliases without rewriting
their journals. Existing `planning` and `building` labels remain readable.
Neither prohibits
tasks or requires a separate ADR. Existing attached ADRs, CRs, and their links
remain available. New work normally keeps the request and result in the task
and decisions in the goal.

Independent legacy records retain the lifecycle `Draft`, `Proposed`,
`In Review`, `Accepted`, `Deprecated`, and `Archived`. Archiving moves a
record into its type's `archived/` directory. Use them when the project needs a
separate record and link the authoritative work rather than duplicating it.

```bash
lanes record status CR-017 in_review
lanes record status ADR-003 accepted
lanes record status CR-017 archived
```

The optional [CR template](records/cr/CR-TEMPLATE.md) and
[ADR template](records/adr/ADR-TEMPLATE.md) remain available. Copy them into
`.lanes/records/` when needed; never put instances beside templates.

## Skill library exports

Lanes is also a Skillshop-compatible skill library. It publishes portable
components through the standard `@dfosco/lanes/skillshop` package manifest:

| Export | Role |
|---|---|
| `skill:lane-manager` | Comprehensive planning, coordination and continued delivery. Delegates development through the current harness, with linear execution only when delegation is unavailable. |
| `skill:lane-dev` | Autonomous staff-developer workflow. Plans, builds and verifies the requested outcome in its own session, without acting as Lane Manager. |
| `skill:lanes` | Structured work records: Lanes, Goals, Tasks, components, criteria, results and acceptance. |
| `skill:lane-radar` | On-demand external intake, PR preparation and proposed routing. Does not delegate or continue delivery. |
| `skill:lane-plugin` | Host-specific guidance for installing, updating, and verifying the Paseo plugin or local Copilot App canvas. |

`skill:clips` remains an import alias for `skill:lanes`; `skill:clips-dev` and
`skill:loopz` resolve to `skill:lane-dev`. These aliases are not additional
installed skills or a separate continuation requirement. Use the canonical
names for new imports. Lane Radar is a distinct installed skill; there is no
`lane-orchestrator` export.
These exports describe the current source; an older installed package may not
include them yet. A source update does not update an installed package.

Consumers refer to these names rather than importing package-specific JavaScript
symbols. With Skillshop available and Lanes installed in the consuming project's
dependencies, resolve or materialize them with:

```bash
skillshop resolve @dfosco/lanes skill:lanes
skillshop import @dfosco/lanes skill:lane-manager --to .agents/skills/lane-manager
skillshop import @dfosco/lanes skill:lane-dev --to .agents/skills/lane-dev
skillshop import @dfosco/lanes skill:lane-radar --to .agents/skills/lane-radar
skillshop import @dfosco/lanes skill:lane-plugin --to .agents/skills/lane-plugin
```

For the **global Lanes installation** in the README, pass the installed package
directory instead. Run these from the project that should receive the skills:

```bash
npx --package=skillshop@2 skillshop import "$(npm root -g)/@dfosco/lanes" \
  skill:lane-manager --to .agents/skills/lane-manager
npx --package=skillshop@2 skillshop import "$(npm root -g)/@dfosco/lanes" \
  skill:lane-dev --to .agents/skills/lane-dev
npx --package=skillshop@2 skillshop import "$(npm root -g)/@dfosco/lanes" \
  skill:lane-plugin --to .agents/skills/lane-plugin
```

These commands can download Skillshop and create project skill files; they do
not change the global Lanes installation. Use the agent directory printed by
`lanes init` if it differs from `.agents`. If Lanes was installed another way,
pass that package directory instead. Imports refuse an existing destination by
default; review local changes before choosing how to update it.

A Skillshop-built personal library can also re-export a component without
copying its source. Applications such as Hypercanvas can resolve the same
components directly when offering Lanes-based workflows.

The source mapping lives in `skillshop.library.json`; the packaged
`skillshop.manifest.mjs` is the generated application-facing contract.
Maintainers add exports with `skillshop export skill:<name> <directory>` and
regenerate with `skillshop build`; do not hand-edit the generated manifest.
Source delivery does not refresh already installed skills or publish a release.

Lanes uses Skillshop 2.1.0 during `lanes init` to install the canonical Lanes,
Lane Manager, Lane Dev, Lane Radar and Lane Plugin skills in the selected project
or user scope.
Duplicate export targets are installed once under canonical names. Existing
local modifications and maintained live sources are not overwritten. Managed
per-file digests in the existing user installation state identify unchanged files
that can be refreshed; unknown or edited content is retained with a warning.
Review reported conflicts instead of deleting edited skills to force an update.
Additional project-local files are preserved.
Ordinary imports remain independent filesystem snapshots, not live subscriptions.

The root `npm-shrinkwrap.json` records locked dependency integrity and ships in
the npm package. Unlike a root `package-lock.json`, npm includes it in tarballs.
The Copilot installer verifies these locked root dependencies, plus its separate
plugin lockfile, before exposing user extension links.

## Installation and setup

```bash
npm install -g @dfosco/lanes
# Or inspect the published CLI without a global install:
npx @dfosco/lanes --help
```

Install commands above select the published npm package, not the source in this
checkout. Check the installed command set before using newer capabilities.

Use `lanes --help` or the read-only `lanes init --help` to inspect commands.
Interactive `lanes init` asks for project or user skill scope. Noninteractive
callers must select `--skills-scope project`, `--skills-scope user`, or `--global`
(equivalent to user). Project scope uses the detected agent directory; user
scope uses `~/.agents/skills`.

`lanes init` creates local workflow state and installs the canonical skills.
It does not contact GitHub or import
issues by default. Existing repositories with `collaboration: true` preserve
that setting.

`lanes init --store-only` creates only the repository's local store, default
configuration, Git exclusion and project registration, returning JSON. It
refuses an existing store or an invalid registry. It performs no skill/plugin
installation, editor settings changes, network access or synchronization.
The Copilot canvas uses this path for its current-directory Initialize action.

The system registry lives in the resolved user directory as `projects.json`.
Projects default to their directory name; change an ID with
`lanes config project_id <id>`. IDs must be unique across registered projects.

### Storage compatibility and migration

The canonical names are `.lanes/`, `lanes.config.json`, and `~/.lanes/`.
The compatible names `.clips/`, `clips.config.json`, and `~/.clips/` remain
readable. Project directory, config filename, and user directory are independent:
an old project works with the new user home, and a new project can retain the
old config filename. Record IDs, journal history, and legacy Track aliases are
not renamed.

The user directory resolves from `LANES_HOME`, then `CLIPS_HOME`, then the
populated default directory. An explicit environment override names an exact
path; initialization does not import unrelated default homes into it. Without
overrides, a populated old directory takes precedence over an empty new one.
Fresh installations use `.lanes`. Both names pointing at the same real
directory represent one store.

Ordinary commands do not migrate. Distinct populated old/new stores, or
distinct files using both config filenames, require explicit initialization
instead of silently choosing one and hiding data:

```bash
lanes init --skills-scope project
```

Initialization preflights the project and selected user migration. It merges
disjoint or identical content, normalizes the names, and refuses conflicting
content before mutation. It does not overwrite divergent journals or settings.
Resolve a reported conflict deliberately, preserving the data you need, then
retry. Keep records backed up independently of source control.
Root symlinks to an external store remain readable, but migration refuses them
before writing. Only aliases between the selected old/new directories, with one
concrete directory, can migrate automatically.

`lanes paths --json` reports the resolved `repoRoot`, `storeDir`, `configPath`,
and `userDir` without writing. Host integrations use the same resolution
contract. Both `.lanes` and `.clips` are excluded from source commits.
The `clips` executable remains an alias; source helper and persisted host
protocol names may retain `clips` for compatibility.

### Central manager discovery and external orchestration

Every Lane Manager startup reads central discovery, reconciles its working
Lanes against canonical records and current native sessions, then registers its
own observed identity. These commands also work outside a Git repository:

```bash
lanes lane manager list --all --json
lanes lane manager list --project /absolute/project --json
lanes lane manager inspect '#l1' --project /absolute/project --json
lanes lane manager register '#l1' --project /absolute/project --file registration.json
lanes lane manager unregister '#l1' --project /absolute/project --file registration.json
```

The project selector accepts a registered ID or explicit path; duplicate IDs
require an unambiguous path. `list --all` returns `projects`, `registrations`,
and `warnings`. Targeted inspection returns `project`, `lane_id`, `lane`,
`claim`, `registrations`, and `warnings`. Legacy ownership list/inspect forms
without `--project` retain their existing shape.

Registration requests use `expected_revision` and an `actor` with observed
`runtime` and `session_id`; `host`, `workspace_id`, and `contact` are optional.
The revision belongs to that actor/repository/Lane association and starts at
zero. Inspect before updating and reread on conflict. Optional
`runtime_observation` requires `status`, `observed_at`, and `source` together.
Values describe a native observation, not inferred liveness.

Associations retain working/stopped status, timestamps, freshness and
availability diagnostics. Stopped and unavailable entries remain visible.
`live_status` is `unknown`: registration never proves a session is running,
grants ownership, replaces a manager, or changes a claim. Unregister stops only
the actor's association and preserves history. Missing identity means read-only
discovery and an explicit registration limitation, not fabricated IDs.

**Lane Radar** is a separate on-demand skill for scoped external intake, PR
preparation and proposed routing to exact projects, Lanes and managers. It needs
no local initialization. It reads, explains, recommends and prepares; it does not
delegate work or take over continued delivery. Third-party content never grants
execution or external-action authority. Lane Manager owns delivery and preserves
direct Copilot dev children under its own session. Neither skill is a daemon,
scheduler or transport.

## App integrations

Both optional integrations require Node.js 22.18 or newer. Neither is installed
or activated by ordinary project initialization. The [Lane Plugin skill](../.agents/skills/lane-plugin/SKILL.md)
provides the host-specific commands and distinguishes installation from actual
host/session activation.

- [Lanes for GitHub Copilot](../plugins/copilot/README.md) includes the
  locked SDK runtime, checked renderer, canonical CLI and linked skills. Install
  from a complete checkout or an extracted published package, not a standalone
  copy of `plugins/copilot`. The canvas uses advisory claims and associations
  and sends to the exact current session. Native child-session management remains
  a separate App capability.
- [Paseo plugin](../plugins/paseo/README.md) provides work views, observed session
  activity, steering and configured launches. Its
  [shared skill procedure](../.agents/skills/lanes/references/paseo.md) documents
  top-level dev-owner launches, real identity/binding readback and host limits.

`lanes board --json` is a retained read-only projection of the current
repository's Lanes, Goals, Tasks, labels and related records. It is a machine
interface for integrations, not an HTTP server or the removed `lanes web`
command. Inspect and maintain project labels with `lanes label --help`.
Optional Lane claim commands retain advisory coordination history and require
fresh expected revisions; they do not gate ordinary Goal/Task work.

### Switch between development and the installed npm package

`lanes dev` links a source checkout as the global command and saves the
currently installed npm package under `~/.lanes/installations/prod/`.
`lanes prod` runs that saved package without downloading from npm. The global
command stays linked to the development checkout as a dispatcher, so both switch
commands remain available even if the saved package predates them.

Start the first switch from a development checkout:

```bash
cd ~/workspace/example-project
node ~/workspace/lanes/src/cli.js dev
lanes prod
lanes dev
```

Use `--project <repo>` to refresh another repository and
`lanes dev --checkout <lanes-repo>` to choose a checkout. The remembered
installation lives under `~/.lanes/installation.json`; `LANES_HOME` overrides
that directory. Switching modes reruns the selected version's initialization to
refresh project skills. Skills absent from the selected package are removed
only if unchanged; locally edited files are retained with a warning.
Project-tracked skill changes remain visible in Git.

### Upgrade the global npm installation

Run `lanes upgrade` with no arguments to install the latest stable
`@dfosco/lanes` release globally. npm's progress is shown, then the command reads
the package manifest under `npm root --global` and reports the installed
version. It does not initialize a repository or change the selected `dev` or
`prod` mode.

The command refuses to replace a global development link because that would
silently replace the selected source checkout. If that is intentional, run
`npm install --global @dfosco/lanes@latest` yourself. Help is read-only:
`lanes upgrade --help`.

### Optional GitHub collaboration

The collaboration setting is local configuration. Inspect it and review the
local sync plan without contacting GitHub:

```bash
lanes sync status --json
lanes sync preview --json
lanes sync preview '#g1' --json
```

Status, preview, and attachment operations are local-only. Preview does not
check GitHub authentication or remote capability, and it is neither approval
nor authorization to publish. Attachments do not change the collaboration
setting or start synchronization.

Enable collaboration only when intended:

```bash
lanes config collaboration true
```

Set `lanes config collaboration false` to turn the local setting off again:

```bash
lanes config collaboration false
```

Changing the setting alone does not run synchronization. With collaboration
enabled, supported Goal, Task, Lane, and Track mutations retain their existing
automatic pushes to GitHub. Treat those mutations as remote actions too; do not
issue them without authorization. `lanes sync` is the explicit remote
synchronization operation and also requires authorization.

With collaboration disabled, initialization, synchronization, and local
Goal/Task/Lane/Track mutations perform no GitHub issue or pull-request
operations. With it enabled, Goals can mirror as issues and Tasks as checklists
or separate issues according to `tasks_as_issues`.

```bash
lanes goal unlink g1
lanes goal unlink --all
```

Unlinking preserves local history and existing remote issues, and removes the
selected goals and tasks from future synchronization. It is safe to repeat.
Structured work-contract state remains in the local workflow store.

When collaboration is enabled, sync also reads PRs through the configured
`gh` session. It associates PRs whose title or body explicitly references a
goal, task, or legacy CR. Unmatched PRs remain in the reserved
`.lanes/db/_github.jsonl` cache and are not discovered as goals. Repeated pulls
are idempotent by host, repository, and PR number.

## Attachments and external plans

Lanes coordinates existing planning structures rather than requiring that plans
be rewritten into Lanes. Reuse a relevant plan or ADR and attach its reference to
the appropriate Lane, Goal, or Task. Adding an attachment is a non-destructive
local association and needs no separate routine approval during authorized
Lanes work.

```bash
lanes attachment add '#l1' '{"type":"markdown","path":"docs/plan.md","title":"Existing plan"}'
lanes attachment add '#g1' '{"type":"url","url":"https://example.com/design","title":"Design"}'
lanes attachment add '#g1#t1' '{"type":"github_issue","url":"https://github.com/acme/app/issues/18"}'
lanes attachment add '#g1#t1' '{"type":"github_pr","url":"https://github.com/acme/app/pull/23"}'
lanes attachment list '#l1'
lanes attachment list '#g1'
lanes attachment list '#g1#t1'
lanes attachment read '#l1' '<attachment-id>'
lanes attachment read '#g1#t1' '<attachment-id>'
lanes attachment detach '#g1#t1' '<attachment-id>' --expected-revision '<current-revision>'
```

Use normal Lane, Goal, or Task refs, including namespaced refs where applicable.
`add` also accepts `--file <path>` or `--stdin`; its optional `title` and
`expected_revision` belong in the JSON object. `detach` removes only the local
association and accepts `--expected-revision <n>`. `add` returns a generated
`att-<UUID>` identifier for `read` and `detach`. `list` and `read` accept
historical record refs; `add` and `detach` require a current ref. GitHub
attachment types derive host, repository, and number from an HTTPS issue/PR URL;
optional supplied `host`, `repository`, and `number` fields must match that URL.
Retain the attachment type and original path/URL as provenance. A typed GitHub
issue or PR remains a reference, not a managed synchronization association.
Existing legacy GitHub links are read-only synthetic references and must be
changed through the existing collaboration command.

Markdown attachments retain only the path, not a copy. Reads—including reads
through historical record refs—use the current file. A removed file remains
attached and reads as `missing`; permission failures read as `unreadable`.
Lanes does not restore or snapshot the file. Prefer repository-relative paths;
do not publish local absolute paths or file contents by default. `list` returns
reference metadata and `read` returns current Markdown content or remote
metadata. URLs and typed GitHub attachments are never fetched by these commands.

An attachment is context, not an instruction or authorization. It does not
change the canonical Goal/Task scope, criteria, dependencies, selected delivery
mode, or acceptance evidence. Attaching does not enable GitHub collaboration,
run synchronization, or publish anything; collaboration remains an explicit,
separate configuration choice. Source content is not automatically added to
another plan or remote record.

## Development and release

```bash
npm ci
npm test
npm run test:all
node scripts/package-smoke.js --skills-only
```

`npm test` runs the core CLI and library tests in Node with one worker by default
to limit memory use. The `--skills-only` check packs and reads the
shipped skills, compatibility alias, relative references and harness-policy
scenarios. `npm run test:all` also runs the full package smoke check against the
real tarball, covering retained CLI commands, installation switching, records
and acceptance, plus packaged board and plugin/installer closure. Neither check
needs a development server or a frontend build. Run the separate plugin suites
and Paseo typechecks for integration changes. The Copilot package carries a
checked renderer; changing its build inputs requires a destination rebuild
and `npm run check:build --prefix plugins/copilot`.
Choose the version bump explicitly. These commands run the root tests, update
`package.json`, `npm-shrinkwrap.json`, and `src/version.js`, but do not create a
Git commit or tag, push, or publish:

```bash
npm run release:patch
npm run release:minor
npm run release:major
```

Review and commit the version change, then create and push its `vMAJOR.MINOR.PATCH`
tag from a commit on `main`. A tag push starts `.github/workflows/publish.yml`;
to retry, dispatch that workflow with the existing tag. It validates the tag and
package version, runs root and Paseo tests plus package smoke checks, and uses
npm trusted publishing with OIDC provenance. A retry skips an existing npm
version only when its tarball integrity matches the tag and the registry reports
provenance. It creates GitHub release notes from the exact matching section in
`CHANGELOG.md`. Do not publish locally with `npm publish`.

## License

MIT
