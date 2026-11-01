# Work contracts in Lanes

This document defines the work-contract implementation in this checkout.
It is not a claim that an older installed CLI supports every command below.

## Contents

- [Core records](#core-records)
- [Planning through implementation](#planning-through-implementation)
- [Fields and extensions](#fields-and-extensions)
- [Identity and revisions](#identity-and-revisions)
- [Management policy](#management-policy)
- [Acceptance](#acceptance)
- [Dependencies and coordination](#dependencies-and-coordination)
- [Lane management ownership](#lane-management-ownership)
- [Compatibility and storage](#compatibility-and-storage)

## Core records

A **Lane** is a sustained conceptual and strategic frame across related goals.
It describes product direction and helps agents understand why several outcomes
belong together. It is not an engineering acceptance layer: Lanes do not carry
technical acceptance criteria, verification modes, or acceptance receipts.

Closing a Lane creates a strategic retrospective. The closure records a summary,
the decisions made across its goals, a system overview and components worked on,
product goals achieved, goal-status snapshot, and product media such as
screenshots when useful. Goal acceptance remains authoritative for engineering
completion.

A **goal** is a desired engineering outcome and the record that coordinates its delivery.
It holds the context, scope, plan, architectural decisions, and outcome
acceptance. Its plan can change as the team learns. Decisions retain the choices
and reasons that explain the plan and the resulting system.

A **task** is the work contract for one atomic change. Atomic means the change
has a coherent result that can be assigned, reviewed, and accepted as a unit;
it does not mean one file, one command, or one commit. Before execution, the
task is a change request. During execution, it preserves material amendments.
Afterward, the same task contains the actual change record, evidence, and
acceptance. It does not turn into another object or lose its original request.

A **system component** is a persistent unit of responsibility with a behavioral
boundary and identifiable implementation or specification references. It gives
other components and tasks a stable identity to rely on.

A useful component definition answers:

- What responsibility does it own?
- What interface or observable behavior can consumers rely on?
- What constraints or failure behavior are part of that promise?
- Where is its implementation or authoritative specification?
- What other components does it depend on?

Create a component when this shared boundary is useful to coordination. A title
alone can start a draft definition; settle the relevant promise before consumers
rely on it. A component can span files or be part of a larger module. It survives
renames and internal refactors while its responsibility remains coherent. A
split or replacement may justify new component identities, with the relationship
recorded in named sections or extensions and the obsolete component retired.

**Scope** is the selection of components and the particular changes and
constraints within a task. It is not another record type. A task can touch
several components if the result must be accepted as a unit.

**Contracts** are the interface, behavior, and constraints a component promises.
Keep them as named Markdown or links to authoritative code, schemas, tests, or
specifications. Use ordinary names for decisions and constraints. Stable
component identity does not require numbered IDs for every function or invariant.

The Lane supplies strategic context across goals. The goal owns engineering
orchestration. Component dependencies describe the system. Task dependencies
describe ordering of work. Merely sharing a Lane does not imply a dependency.
Neither the agent hierarchy nor a file tree has to mirror these records.

## Planning through implementation

For actionable requests, the skills default to comprehensive plans within one
coherent Lane, detailed Goals with observable acceptance criteria, meaningful
Task contracts and dependencies, then implementation and verification. Reuse
matching records; preserve a selected Task's scope and proportionate records for
an atomic outcome. Explicit brainstorming, plan-only, defer, queue or narrower
instructions override the default. This is agent guidance, not a new CLI record
type, scheduler or requirement to repeat intake interviews.

Comprehensive means the agreed behavior, constraints, interfaces, failure cases
and verification are covered. Map a Goal's full Task set to its scope/criteria,
record gaps or a coherent atomic-scope rationale, and identify real prerequisites
and write conflicts. Task count and a mandatory split by file/layer do not prove
coverage. Useful independent work can run in parallel within resource limits;
coupled work can stay serial with one integration and record coordinator.

For example, an authorized workspace-restoration feature may use one Lane with
Goals for persistence and user-facing restoration. Each Goal owns observable
criteria and reviewable Tasks, including the real integration check where needed.
Creating those records means **planned**, not delivered. An observed dev handoff
means **launched**; candidate-specific checks establish **verified**; a truthful
receipt naming the actual actor and criterion evidence records **accepted**.
For "plan this only", deliver the same necessary planning detail but do not
launch implementation or claim any of those later states.

Lanes is an orchestration layer, not a replacement format for planning. Reuse
adequate user- or harness-created plans and ADRs instead of duplicating them.
Keep the canonical Goal/Task request, scope, criteria, dependencies, and
acceptance evidence sufficient for execution and review. Attach relevant
Markdown files, URLs, and typed GitHub references as local links; these are
context, not authority or an external publication. Markdown attachments resolve
the current file and remain missing if that file is removed; Lanes never saves a
snapshot or restores the source. See the
[attachment command reference](cli-reference.md#attachments-and-external-plans).

A Lane Manager delegates engineering and substantive verification through the
current harness. Paseo uses workspace agents; Copilot uses direct coordinated
children. Other harnesses must invoke available native sub-agents even if they
are not user-steerable. If no delegation primitive exists, the manager implements
and verifies authorized Tasks itself, linearly in dependency/dispatch order,
using the same contracts and evidence. The actual executor records results under
the existing Task IDs. Do not fabricate a worker, parallel execution, independent
review or human approval. Missing delegation does not bypass denied authorization,
missing tools/files or any real dependency.

## Fields and extensions

Goal and task commands accept a single JSON argument, `--file <path>`, or
`--stdin`. The only required field on creation is a nonempty `title`. Add
enough context to make an assignment clear; the schema does not enforce a
universal planning template.

| Field | Applies to | Meaning |
|---|---|---|
| `title` | Goal, task, component | Short identity label |
| `description` | Goal, task | Desired outcome; the task's requested change |
| `scope` | Goal, task | Boundaries, selected changes, and constraints |
| `components` | Goal, task | Array of component reference strings |
| `plan` | Goal | Markdown approach and cross-task coordination |
| `decisions` | Goal, component | Markdown choices, rationale, and consequences |
| `owner` | Goal, task | Work owner, or `null` to clear |
| `acceptance_owner` | Goal, task | Expected accepting actor, or `null` to clear |
| `acceptance_criteria` | Goal, task | Array of `{id, description}` criteria; legacy strings accepted |
| `record` | Goal, task | Markdown actual result and material implementation notes |
| `behavior` | Goal, task | Optional behavior/scenario text |
| `verification_mode` | Goal, task | `behavior` or `behavior_and_tests`; task `null` restores inheritance |
| `blocked_by` | Goal, task | Array of required work references |
| `responsibility` | Component | Markdown statement of its system responsibility |
| `contract` | Component | Markdown interface, behavior, and constraints |
| `source_refs` | Component | Array of implementation or specification references |
| `dependencies` | Component | Array of component references, optionally pinned to revisions |
| `sections` | All three | Named Markdown sections |
| `extensions` | All three | Project-defined JSON metadata or relationships |
| `expected_revision` | Update/accept input | Reject a mutation if the current record revision differs |

Goals support `lane_id` for their strategic frame and retain legacy
`track_id` plus `type` labels for compatibility. Lane creation/update uses
`title`, `description`, and optional `product_goals`. Lane closure uses
`summary`, `decision_log`, `system_overview`,
`product_goals_achieved`, and optional `components` / `media`.
Use status commands for lifecycle changes, except Lane closure, which uses
`lanes lane close` so the retrospective is captured.

### Extend without multiplying artifact types

Use `sections` when a named explanation helps another agent, and `extensions`
when structured project data is useful. For example:

```json
{
  "sections": {
    "Migration": "Read the existing preference key; write only the new key.",
    "Review focus": "Confirm startup still works when browser storage is unavailable."
  },
  "extensions": {
    "review": {
      "source_branch": "feature/workspace-preference",
      "affected_docs": ["docs/workspaces.md"]
    }
  }
}
```

A section update merges by heading; `null` removes that heading. Extensions
merge objects recursively; arrays and scalar values replace the value at that
key, and `null` removes a key. Unspecified content is preserved. New
project-defined fields belong in these containers; unsupported top-level
goal/task keys are rejected with guidance instead of silently dropped.

Define the meaning and owner of an extension if other agents rely on it.
A contract obligation belongs in the request, scope, or criteria even if an
extension supplies additional details. Editing `sections` or `extensions`
does not automatically invalidate acceptance, so do not hide changed obligations
there. If a custom relationship changes what must be delivered, amend the
authoritative request too.

## Identity and revisions

Current references identify Lanes, goals, tasks, and components:

- `#l1`
- `#g1`
- `#g1#t1`
- `#c1`

The CLI normalizes shorthand to its canonical padded IDs. Existing user
namespaces remain supported, for example `#alice#g1#t1` and `#alice#c1`.
Unqualified components are repository-wide: `#c1` and `#c1#r1` always address
root component storage, independent of the configured agent username. Use an
explicit component namespace when a separate catalog is intentional.
Use complete refs across contexts. Within an identified goal,
`#t1#A1` can name a task criterion; a CLI view supplies the goal explicitly
with `--goal`.

### Criteria

Acceptance criteria use nested stable IDs:

- `#g1#A1`: goal criterion.
- `#g1#t1#A1`: task criterion.

Preserve explicit IDs on reorder and when refining the same condition.
Allocate a new ID for a new condition. Removed or reserved IDs are not reused.
Legacy strings are normalized into criteria with deterministic IDs; use the
returned IDs for subsequent edits.

Implementation steps remain ordinary lists. A separate task is appropriate
when a piece of work needs its own assignment and acceptance. There is no
required step, evidence, invariant, or decision ID namespace.

### History

Append `#rN` to read a recoverable record snapshot. Lane IDs use `l`, so
`#l1#r2` is unambiguous: Lane 1, revision 2.

```bash
lanes view '#l1#r1' --json
lanes view '#c1#r1' --json
lanes view '#g1#t1#r2' --json
lanes view '#g1#t1#r2#A1' --json
lanes history '#g1' --json
lanes history '#g1#t1' --json
lanes history '#c1' --json
```

Goal revisions count events in the aggregate goal/task stream. Task revisions
advance when events affect that task, including relevant inherited state.
Component revisions follow the component's event stream. Use returned revisions;
do not infer a revision number from elapsed time, commit count, or semantic
compatibility.

Pinned refs are read-only. Supply `expected_revision` on a mutation of the
current ref when work was based on a particular revision:

```json
{
  "expected_revision": 3,
  "scope": "Persist one workspace ID; tolerate unavailable storage."
}
```

A stale revision is a prompt to reread and reconcile. It is not permission to
overwrite another owner's change. Short append locks and revision checks do not
implement a distributed scheduler, a task lease, or complete multiwriter
coordination.

Revisions identify agreements and historical records. A separate commit,
tree/diff identity, or immutable artifact reference identifies what was
implemented and checked. A record's current revision is not verification
evidence, and a Git HEAD alone does not identify a dirty working tree.

## Management policy

Work ownership is advisory coordination metadata, not an authorization or
execution lock. Authorized Lane, goal, and task work does not require a host ID,
manager claim, exclusive management role, or unused session association.
The canonical CLI has no host-identity or Lane-claim prerequisite. Integrations
must not turn those optional relationships into requirements for ordinary work.

Preserve existing owners, associations, and history unless explicitly updating
them. Do not fabricate an actor, erase metadata, or claim a Lane just to start
work. Coordinate actual overlapping writes rather than treating a recorded owner
as proof that another agent is currently writing.

Use the CLI for records and supported host tools for agent sessions and
communication. User-requested coordinated children remain steerable through
those tools; they do not require a Lanes role or claim. Respect resource limits
and reuse an existing session when another is unnecessary. The packaged Copilot
canvas uses an exact-current-session adapter; native App tools still own child
creation and cross-session steering. Agent instructions cannot change checks
implemented by a host integration.

For GitHub Copilot App handoffs, every dev session is a direct coordinated child
of the Lane Manager, without an intermediate coordinator/Squad/dev-lead session.
The manager calls native `create_session` and verifies `creator_session_id` and
`coordinating_creator_session_id` through `get_session`/listings, together with
the intended repository and workspace. The actual listed `app_url` exposes user
navigation; `send_session_message` maintains manager/worker contact throughout
execution. Claims, titles, activity or a canvas Send do not establish parentage.
Do not detach/reparent or use hidden replacement workers to satisfy the rule.
If useful parallel Tasks need more dev sessions, the manager creates direct
siblings while one owner integrates. RAM limits or shared writes can justify
one serial dev child. Paseo's separate top-level path is unaffected.

This policy leaves authentication, credential safeguards, external-action
approval, exact-target validation, atomic writes, canonical journal locks, and
stale-revision conflicts intact. It also preserves acceptance receipt checks:
`acceptance_owner` identifies the expected accepting actor, not who may implement
the work. A receipt must still name its actual authorized actor and satisfy the
recorded acceptance agreement.

## Acceptance

Accept only after assessing the actual result against the current request and
criteria, under the authority of the accepting actor. A task's result can be
written to `record`; the acceptance receipt also carries its summary and
evidence. The request remains available in the same task and history.

```bash
lanes task update '#g1#t1' --file task-result.json
lanes task accept '#g1#t1' --file task-acceptance.json
lanes goal accept '#g1' --file goal-acceptance.json
```

Receipt shape, with illustrative values:

```json
{
  "expected_revision": 4,
  "artifact": {
    "source": "actual immutable commit, tree/diff, or artifact identity",
    "evidence": "location of the observed verification results"
  },
  "accepted_by": "actual-authorized-actor",
  "summary": "Describe the outcome accepted and its boundaries.",
  "criteria": [
    {
      "id": "A1",
      "status": "satisfied",
      "evidence": "Check performed, observed result, and relevant evidence location."
    },
    {
      "id": "A2",
      "status": "waived",
      "reason": "Specific waived scope and the authority that approved the exception."
    }
  ]
}
```

`artifact` must be nonempty text or an object. Satisfied criteria need nonempty
evidence, which may be text, an object, or an array. Waived criteria need a
nonempty reason; evidence may also be supplied. Every live criterion must appear
exactly once, and unknown criterion IDs are rejected.

The CLI supplies `accepted_at`, `request_snapshot`, and
`request_revision` when available. It stores the receipt under `acceptance`
and closes only the target task or goal. It preserves superseded or invalidated
receipts in history.

It also generates `acceptance.component_basis` as canonical pinned component
refs. Explicit component revisions are honored; unpinned refs resolve to their
current revisions at acceptance time. Missing declared components prevent
acceptance. The request snapshot retains the originally declared component refs.
Pin a component before assignment when work must use a fixed negotiated baseline.
Later component edits do not automatically invalidate acceptance across separate
journals; agents must reconcile affected contracts and evidence.

The receipt's `artifact` is the authoritative identity of the checked result,
which may include uncommitted changes or an external artifact. Explicit
acceptance clears the legacy `closed_commit_sha` field. Administrative status
closure still records HEAD, which alone does not identify a dirty working tree.

If `acceptance_owner` is set, `accepted_by` must match. These fields are
responsibility metadata. The CLI does not authenticate an actor, run the checks,
prove that evidence is true, or manufacture human approval. An agent should name
itself when accepting under delegated authority and must not imply a human
approved something they have not reviewed.

### Goal completion and exceptions

Goal acceptance requires its children to be `closed`, `not_planned`, or
`duplicate`. For each `not_planned` or `duplicate` child, the goal receipt
must include an explicit exception:

```json
{
  "exceptions": [
    {
      "ref": "#g1#t2",
      "reason": "State the actual disposition and authority for excluding this work."
    }
  ]
}
```

This is an additional field in a complete goal receipt, not a receipt by itself.
The goal receipt captures the child task basis. Already closed legacy tasks can
be included without synthesizing missing task receipts. The goal's own evidence
must establish the integrated outcome; child statuses alone do not do that.

A selected-task assignment accepts those tasks without accepting the whole goal.
Keep dispositions and waivers distinct from delivered behavior.

### Changes after acceptance

Request-affecting edits include changes to title, description, scope, component
refs, acceptance criteria, acceptance owner, behavior, verification mode, and
work blockers; goal decisions also belong to its accepted request. Such changes
invalidate current acceptance and reopen closed work while preserving the prior
receipt. Criteria or reference reordering alone does not change the agreement.

Plan updates, work-owner changes, result notes, sections, and extensions do not
automatically change the obligation. They remain in history. An agent must still
notice when source changes or custom semantics make earlier evidence stale.
Lanes does not watch the filesystem and prove continued correctness.

Administrative `status closed` creates no receipt and is not evidence of
acceptance. Reopening work also invalidates its prior current acceptance.
Status is useful for coordination, while evidence supports the completion claim.

## Bounded delivery, validation, and publication gates

Before dispatch, the Lane Manager reads the effective project settings with
`lanes config lane_dev_max_tasks`, `lanes config lane_validation_mode`,
`lanes config lane_commit_mode`, and `lanes config lane_pr_mode`. Defaults are
`3`, `human`, `after_validation`, and `none`. These settings describe the
intended delivery workflow. They are not a scheduler, proof of host capability,
acceptance authority, or permission for an external action. Record the effective
values, any explicit user override, the actual acceptance authority, and desired
delivery endpoint in the plan or handoff.

### Bounded worker assignments and retirement

Assign each Lane Dev session one bounded batch of persisted Tasks, normally one
and never beyond `lane_dev_max_tasks`. Count earlier assignments in the same
session; a new label or reassignment does not reset a host lifetime quota. Allow
only finite rework within the active contract. Always fold the developer
promptly when its assignment ends, even below the numerical cap, while human
Goal review is pending, or when follow-up might later be needed.

Folding means closing the native agent/sub-agent/session or tab **and its owned
runtime process** on every harness. Idle, complete, detached, hidden or
interrupted is not closed. Preserve source, worktrees, transcripts and
association history. Verify actual native closure and runtime effects; do not
infer process termination from a UI badge or act on unrelated processes.

For normal completion, reassignment or noncritical resource pressure, first
return latest context to the actual manager: exact Goal/Task refs and request
revisions, artifact and changed paths, criterion checks/results, commands and
environment, decisions, blockers/remaining work, and active writes or external
effects. Settle those effects. Persist this context as a durable attachment on
each respective Goal with `lanes handoff record <goal-or-task-ref>`, read back
the attachment and have the manager acknowledge it, then immediately close and
verify the native worker/runtime. A Task ref attaches to its parent Goal.

Critical resource pressure **closes first**. Do not wait for fresh context,
acknowledgment, attachment, checkpoint or quiescence. Preserve available context
and after closure attach it to the respective Goals with
`reason: resource_critical` and `incomplete: true`. Record interrupted work,
unresolved effects and failures; closure is not completion or acceptance. If
native closure or process readback is unavailable, report the exact limitation
and actual state instead of claiming a fold.

Maintain two-way resource-manager contact throughout execution. Fresh enabled
live capacity supersedes `lane_max_active_agents`; its default of 5 per Lane,
excluding the manager, is only a fallback when resource management is
unavailable, stale or disabled. Explicit user ceilings and native quotas always
apply, including on cloud harnesses. Starting, running, idle and
finished-but-unclosed workers occupy capacity until native closure is verified;
unknown state is not free capacity. See the
[handoff command reference](cli-reference.md#developer-handoffs-and-folding) and
[packaged procedure](../.agents/skills/lanes/references/delivery.md#bounded-worker-assignments-and-retirement).

### Validation and acceptance gate

For each candidate, name the exact checked artifact (commit plus any dirty-diff
identity, tree, or immutable artifact ref), each required check or scenario, its
actual result, the accepting actor and authority, and the action taken on pass or
failure. A failed check blocks acceptance and downstream commit/PR work; repair
and rerun affected checks, or report the blocker. Later source changes invalidate
the affected evidence and require reassessment. `ready-to-review` is only an
actionable request for human validation, never a substitute for acceptance or a
default holding state.

Human validation is available for the integrated Goal, but is not mandatory for
every Goal. If no Goal-level human review was requested, an authorized agent may
accept and close a fully verified Goal with the `not-reviewed` label. This label
records that no Goal-level review occurred; it is not human approval, an
acceptance receipt, or a waiver of checks, explicit review gates, or external
delivery approval. Review may be requested at Lane level or performed manually
later; update the label when a later review covers the current candidate. For a
requested review, attach a Goal CR identifying the exact candidate, covered
scope, criteria and checks, then separately submit a pinned request. Attaching a
CR alone does not request review; ask for explicit `approved`,
`changes_requested`, or `deferred` disposition. The user may coalesce selected
Goals in one Lane CR. A covered scope receives one review decision, not duplicate
Goal and Lane approvals. Attachments have an explicit purpose: CR for candidate
review, ADR for a decision. ADR approval settles a decision; it does not accept
implementation. The review inbox contains actionable requests pinned to
candidate, content and coverage; a generic waiting label is not a review
request. Never record human approval until the user responds. If the candidate
changes before approval, refresh the request and checks.

An agent may accept an engineering Task only when the contract authorizes that
agent as accepting actor and the evidence satisfies every criterion. Record the
real actor and per-criterion evidence. Task acceptance does not close its Goal.
The manager reviews cross-Task evidence and may prepare requested human review;
its analysis does not stand in for user validation or imply approval.
`lane_validation_mode=agent` permits agent acceptance where configured, but
neither validation mode overrides a named human gate. Do not use an
administrative status change as acceptance.

Goal completion requires a valid acceptance receipt for the exact candidate and
fulfillment of the configured delivery endpoint. Human approval is additionally
required only when explicitly requested or named as a gate. `changes_requested`
sends bounded affected work to a dev and requires a new candidate-bound review
request. `deferred` leaves an explicit user wait with its next owner and action;
it does not permit endless building. Deferral is not final: the assigned
reviewer may later record a new decision against the same still-current
candidate. Pending Goal review never keeps a finished dev open after its
Goal-attached handoff; fold it promptly.

### Commit and PR endpoint

`lane_commit_mode=after_validation` means the dev commits after its automated
checks pass, before manager analysis and user validation. The Task contract
must authorize that dev-owned local commit. Stage only scoped, checked paths,
inspect the staged diff, and preserve unrelated user changes. Never commit after
failed or stale checks. Record the resulting commit identity and rerun checks
affected by commit hooks or generated files. Under `lane_commit_mode=manual`,
leave an explicit handoff naming the verified paths, candidate identity and
next commit owner; do not imply a commit exists.

`lane_pr_mode` selects a desired endpoint: `none` stops before PR preparation;
`prepare` produces a local review brief or exact proposed title/body;
`draft` or `ready` permits PR materialization only with GitHub collaboration
enabled, the explicit `--confirm` flag, and the user's required external-action
authorization. Materialization is allowed while review is awaiting a decision,
uses `gh pr create --draft` for draft mode and `gh pr create` for ready mode,
and requires local/remote branch tips to match the pinned base/head commits.
It stores a separate pull-request association and leaves review status unchanged.
PR creation is a review surface only. It is not approval, merge, delivery
completion, Task acceptance or Goal acceptance. `none` and `prepare` prohibit
materialization. No setting authorizes a push.

`lanes attachment add <Lane|Goal|Task> '<json>'` accepts optional
`purpose: "cr"` or `"adr"`, which only labels use. Remote CR/ADR references
remain attachable, but review pinning requires readable local Markdown with
purpose `cr`. Goal coverage pins the Goal and required Task obligations; Task
coverage includes only that Task; Lane coverage requires explicit selected
in-Lane Goal/Task refs. Fully covered active requests coalesce into one journal
event. Partial overlaps reject with the uncovered obligations. Idempotent
request reuse compares reviewer, summary, validation, delivery intent,
attachment identity/content, coverage pins, candidate commits and branch refs.

Use `lanes review request <record-ref> --file payload.json` to submit a
candidate-bound request for a CR attachment; attaching the CR alone is not a
request. `lanes review show <id> --json` returns a numeric `revision` to pass as
`expected_revision` when deciding or completing. It returns pinned
`attachment.content`; when stale, it also returns `current_content`, pinned and
current SHA-256 identities, and read identities. This lets the reviewer see the
original pin and current-content warning together.

Use `lanes review decide <id> --file payload.json` with numeric
`expected_revision`, the exact candidate, and an actor matching the assigned
reviewer. `awaiting_review`, `changes_requested`, and `deferred` are actionable.
Deferred permits an explicit subsequent decision without an edit; superseded and
delivered reviews are terminal, and exact retries do not resurrect them.

Use `lanes review open <Lane|Goal|Task-ref|review-id>` to materialize the exact
pinned CR as a stable Markdown file under the selected project's excluded
workflow store. Normal output is its absolute path; `--json` also returns review
identity, candidate, reviewer, status, coverage and stale reasons. A work ref
resolves only actionable requests whose pinned coverage obligations include
that exact object. Goal requests pin the Tasks present when requested; Tasks
added later are not implicitly covered. If several actionable requests match,
the command lists them and asks for an explicit review ID. An attachment alone
does not create an actionable request. The generated document includes the
original pinned CR and a stale warning when current content or pins changed.
Opening it does not alter the CR, review journal or approval; editing the
generated copy does not alter the pinned review.

Use `lanes review pr preview <id> --json` to inspect materialization, then
`lanes review pr materialize <id> --confirm` only after the required authority.
Candidate data includes base/head commit SHAs and matching `base_ref`/`head_ref`
branch names. The head must still equal Git `HEAD`, and base must be its
ancestor. `gh` receives branch names only after local and remote branch tips are
verified against the pinned SHAs. Materialization records a separate
pull-request association and leaves review status unchanged, including while
awaiting review.

`lanes review complete <id> --file payload.json` records an approved candidate's
endpoint evidence from `{actor, candidate:{base,head}, endpoint,
expected_revision?}`. URL endpoints use `{type:"github_pr"|"url",url}`;
`github_pr` requires an HTTPS GitHub pull URL and `url` an absolute HTTP/HTTPS
URL. These are evidence links, not merge proof, and require a non-stale
candidate. Local Git proof uses `{type:"git",ref:"main",commit:"<full SHA>"}`.
It requires a local branch name, a commit equal to that branch's current tip,
the approved head as an ancestor, and identical delivered/approved trees. This
form accounts for expected HEAD/base-ref movement from a real merge or
fast-forward. Changes to the attachment, CR, coverage, or Lane contract, and
missing candidate objects still reject. Completion does not perform a merge.
It records `delivered_by` and endpoint evidence only, does not authenticate the
actor, and does not accept or close a Goal or Task automatically. A delivered
review is a historical receipt: `review show` reports `stale:false` after
delivery, and later unrelated HEAD/base movement does not reclassify its
evidence.

`lanes review pr import <id> --event <PullRequestReview-GraphQL-node-ID> --json`
imports one decision event from an already linked PR through read-only
`gh api graphql`. It verifies the linked PR URL, base/head OIDs, event commit
OID, valid submission time, author login against the assigned reviewer, and
event ID against the pinned local review. Only `APPROVED` and
`CHANGES_REQUESTED` GitHub review events import. The local journal records the GitHub
review node ID, login, state, commit OID, PR URL, `submittedAt`, and body.
It queries only the supplied GraphQL review node ID. Reimporting
the same event is idempotent;
reusing an event ID with changed data rejects. Stale candidates reject. PR
creation, merge, and aggregate `reviewDecision` do not imply approval. Import
does not write to GitHub or run a continuous sync. It records a decision on the
existing pinned review, not a second approval surface. A human decision or
GitHub import uses the same approval surface for covered obligations.

The Lane Manager owns shared Lanes records and cross-Task coordination and
integration oversight. Assigned devs execute their technical conflicts,
integration, checks and authorized commits. Workers return evidence and proposed updates. A completed worker assignment is not complete
delivery until automated validation, engineering acceptance, the configured
commit behavior, and the requested human review/PR endpoint are each either
reached or left with an explicit next owner and action. Human Goal validation
may remain pending after engineering Tasks are accepted and the dev is folded.
Completion requires prompt native closure, not an idle session awaiting review.

## Dependencies and coordination

Use Lanes for strategic grouping and narrative continuity across related goals.
A goal belongs to at most one Lane, but Lane membership does not schedule work.
When an agent works on a goal in a Lane, read the Lane for context; do not
automatically pull sibling goals into scope. When the Lane itself is the user's
scope, coordinate its dependency-ready goals and close the Lane only after
capturing the strategic retrospective.

Use component `dependencies` for structural system relationships. Structural
cycles are permitted; the field does not schedule work. Pin a component revision
when a consumer needs a specific contract and reconcile changes before
integration.

Use task `blocked_by` for task or goal references that the work actually needs.
Goal `blocked_by` retains its existing goal-dependency validation. Dependencies
are recorded coordination data, not a runtime enforcement or ownership system.

A provider and consumer can be implemented in parallel after agreeing their
interface. Record any integration acceptance gate in the goal plan. A mock can
support local development without proving that the real integration works.

Keep one coordinator writing shared Lanes state by default. Workers return
results and proposed updates. Keep execution state in task status, owner,
blockers, and result; keep cross-task coordination in the goal plan. An existing
squad log or host handoff can hold transient context. Ordinary coordination
needs no separate execution-note record; folding requires a durable Goal-attached
handoff, with the critical close-first exception above.

## Lane management ownership

Lane lifecycle status, manager ownership, and observed agent activity are separate.
Stopped or unavailable sessions retain their management claim. A claim coordinates
decisions; it does not prohibit another agent from contributing to a Task.
Contributors must contact existing managers before overlapping decisions or changes.
If an authorized messaging route is unavailable, report that limitation rather than
silently claiming ownership or inventing a successful exchange.

Inspect with `lanes lane manager inspect '#l1' --json`; list with
`lanes lane manager list --json`. An unowned Lane returns revision 0. Mutations
accept one JSON argument, `--file <path>`, or `--stdin`, and output the updated
claim as JSON. Every mutation requires the revision just inspected:

```json
{
  "expected_revision": 0,
  "actor": {
    "host": "observed-host-id",
    "runtime": "paseo",
    "session_id": "actual-agent-id",
    "workspace_id": "actual-workspace-id",
    "contact": "supported coordination route"
  }
}
```

| Command | Behavior and additional input |
|---|---|
| `lanes lane manager claim '#l1' <json>` | Claims an unowned Lane; repeating the same identity is idempotent |
| `lanes lane manager share '#l1' <json>` | Current manager adds `owner`, another observed manager identity |
| `lanes lane manager release '#l1' <json>` | Removes only the calling `actor`; preserves coowners |
| `lanes lane manager handover '#l1' <json>` | Replaces `from` (defaults to `actor`) with `owner`; requires `authorization: {"by":"user identity","reason":"explicit instruction"}` |

The tuple `host`, `runtime`, `session_id` identifies a manager. `workspace_id`
and `contact` are optional navigation/coordination hints. Use observed identity
values. One session can claim several Lanes. Sharing is explicit and requires an
existing manager; handover always requires a recorded user instruction permitting
that replacement. The metadata records the asserted authority; it is not an
authentication mechanism. Never infer permission to take over from a stale or
disconnected session. Revision conflicts require rereading and coordination.

Claims live under `LANES_HOME/lane-claims/` or `~/.lanes/lane-claims/`, outside
repository state and GitHub sync. Canonical realpath Git common-directory identity
and Lane ID determine the record. Worktrees and symlinks share ownership; repository
labels, configured agent usernames, and display project IDs cannot fork it. Lanes
are repository-global and have no configurable ownership namespace.

Each state contains `version: 1`, `repository_id`, fixed `namespace: ""`,
`lane_id`, `revision`, `owners`, and `history`. Owners include their identity and
`claimed_at`. History retains operation, actor, time, owners before/after, and any
handover authorization. Locking covers read, revision check, and atomic replacement.
Malformed or inconsistent ownership fails closed; a stopped writer's lock is never
silently stolen. Confirm no writer is active before repairing a stale lock.

Board Lanes expose `manager_claim` separately from `status`. Ownership read failures
set `manager_claim: null` and `manager_claim_error`, with a warning. Consumers must
not interpret unknown ownership as an unowned Lane or offer automatic replacement.

## Compatibility and storage

Existing planning/building labels, Track relationships, attached ADRs, CR/ADR
files, GitHub metadata, and old event streams remain supported. Track IDs such
as `#r001` are exposed as legacy aliases of `#l001`; their journals remain in
`.lanes/db/tracks/` so existing stores do not need a migration. New user-facing
commands, fields, and references use Lane terminology. Labels no longer
force a separate ADR or prohibit tasks. Existing records are not rewritten into
new objects or discarded.

Workflow instances remain local under `.lanes/` and must not be committed:

| State | Location |
|---|---|
| Lane events (including legacy Tracks) | `.lanes/db/tracks/r001.jsonl` |
| Goal/task events | `.lanes/db/[username/]g001.jsonl` |
| Component events | `.lanes/components/[username/]c001.jsonl` |
| Optional CR/ADR Markdown | `.lanes/records/{cr,adr}/` |
| Archived CR/ADR Markdown | `.lanes/records/{cr,adr}/archived/` |

Worktrees resolve the common repository's store. Product documentation and
source remain committed repository state. GitHub collaboration stays opt-in,
and the full structured work-contract record remains local.

On older installations, inspect help and preserve useful model content in named
sections of goal/task descriptions. Keep evidence explicit and describe status
closure honestly. Do not claim that a textual revision label is a recoverable
snapshot, or that an older CLI created a structured acceptance receipt.

Legacy criterion maps and entries using `text` remain readable, including blank
legacy descriptions. Replay assigns stable criterion IDs and retains their
metadata without rewriting the journal. Clarify a blank criterion before
accepting it; new and amended criterion descriptions must be nonempty.
