# Bounded delivery, validation and publication gates

Use these rules for Lane Dev assignments and handoffs. Project preferences are
read with `lanes config lane_dev_max_tasks`, `lane_validation_mode`,
`lane_commit_mode`, and `lane_pr_mode`; their defaults are `3`, `human`,
`after_validation`, and `none`. Preferences guide procedure. They do not enforce
scheduling, confer acceptance authority, prove host capability, or authorize
external actions.

## Bounded worker assignments and retirement

Assign a finite batch of persisted Tasks, normally one. Do not exceed the
configured per-session Task cap, count known earlier assignments, and return the
batch when its defined work is done even below the cap. Allow only bounded
rework against the same contract while that assignment is active. Always fold a
finished developer promptly; do not leave it idle for possible follow-up work,
human Goal review, or a remaining numerical Task allowance.

**Fold means close the native agent/sub-agent/session or tab and terminate its
owned runtime process on every harness.** Marking a Task complete, returning a
result, idling, detaching, hiding a tab, or merely interrupting a turn does not
fold it. Use discovered native closure operations and verify their actual
session/process effects. Archive qualifies only when that host closes the
runtime too. Preserve source, worktrees, transcripts and association history.
Do not target an unrelated process or infer process termination from a UI badge.

For normal completion, reassignment, or a noncritical resource fold:

1. Get the developer's latest context to its actual manager: exact Goal/Task
   refs and revisions, artifact and changed paths, criterion-level checks and
   results, commands/environment, decisions, blockers/remaining work, and any
   active writes or external effects. Settle those effects before normal closure.
2. Persist that context as a durable attachment on **each respective Goal**
   before closing. The designated writer uses
   `lanes handoff record <goal-or-task-ref> --file handoff.json`; a Task ref
   attaches to its parent Goal. The payload contains `context`, observed
   `agent_id` and `manager_id`, and `reason` (`completed` by default, `resource_warning`,
   `resource_critical`, or `reassignment`), with optional `incomplete` and a
   UUID `handoff_id`. Reuse it only for an exact retry; use a new ID for changed
   context or a different Goal. Read back the returned attachment. Never invent
   identities or substitute an unpersisted chat message for this handoff.
3. Have the manager read and acknowledge the latest attached context, then
   immediately close the native worker and its owned process. Confirm closure
   through native readback and report it to the resource manager. Keep capacity
   occupied until closure is verified; failures remain visible and retryable.

For a **critical resource condition, close immediately**. Do not wait for a
developer response, manager acknowledgment, fresh context, attachment write,
checkpoint, or quiescence. Use already known exact session identity, preserve
available context, and after closure persist it on the respective Goals with
`reason: resource_critical` and `incomplete: true`. Record interrupted work,
unresolved effects, and any persistence/closure failures; emergency closure is
not acceptance. This exception changes the order, not the obligation to retain
available context or preserve source and worktrees.

When a host cannot close the actual runtime or expose the required readback,
report the missing capability and actual state. Do not claim a fold or recovered
capacity. Use the host's existing tools; do not invent an API. A standalone dev
without a manager preserves the same Goal-attached context through the supported
attachment interface and returns it to the user without fabricating a manager.

## Resource capacity and manager contact

Maintain two-way contact with the live resource manager throughout the Lane:
read fresh capacity before dispatch and at planning boundaries, reserve grants
before launching, and report actual launches, handoffs, folds and failures. Count
starting, running, idle and finished-but-unclosed workers, including permitted
nested helpers. Unknown state is not free capacity. Respect updated allocations;
fold completed/old workers first under ordinary pressure and current workers
when requested, using the normal or critical procedure above.

Use fresh, enabled resource-manager capacity instead of the stored
`lane_max_active_agents` value. That setting (default **5** per Lane, excluding
the manager) is only the fallback when the resource manager is unavailable,
stale or disabled; it is not an extra cap on live grants. Explicit user ceilings
and native quotas always apply. Cloud execution does not waive either live
capacity or the fallback. See [Paseo resource coordination](paseo.md#resource-coordination-and-folding)
for its concrete channel; other harnesses must discover their native equivalent.

## Validation, acceptance, and user review

Run automated checks on the actual candidate before commit. Record the candidate
(commit plus any dirty diff, tree, or immutable artifact), each criterion and
check, observed result, responsible actor and next action. A failure blocks
acceptance and commit; repair and rerun affected checks. Later source changes
invalidate affected evidence.

An authorized agent may accept engineering Tasks when each criterion is met.
Task acceptance does not close its Goal. Human review is available at Goal or
Lane level, but is not required for every Goal. When the integrated Goal has no
Goal-level human review, accept and close it with a `not-reviewed` label. The
label records that the Goal was not individually reviewed; it is not human
approval or a substitute for verification, a Goal acceptance receipt, or any
explicitly requested review or external delivery gate. A later Goal or Lane
review can cover the current candidate; update the label to reflect that
review. For a requested Goal review, attach a CR for the exact committed
candidate, scope, criteria and checks, then separately submit a pinned request.
Attaching a CR alone does not request review. Request explicit `approved`,
`changes_requested`, or `deferred` disposition. The user may coalesce selected
Goal reviews into one Lane CR. Covered scope receives one review decision, not
duplicate Goal and Lane approvals. CR attachments request candidate review;
ADR approval settles a decision and does not accept implementation. A review
inbox holds actionable requests pinned to candidate, content and coverage. A
generic waiting label is not a review request. Never claim human approval before
the user responds. If the candidate changes, refresh the request and affected
checks. A stale attachment retains immutable
`attachment.content` alongside `current_content`, pinned/current SHA-256
identities, and read identities so the reviewer can see the original pin and
the current-content warning together.

After submitting a review request, run `lanes review open <record-ref|review-id>`
and give the returned absolute pinned Markdown export path to the user through
the current harness. This hands off the requested snapshot rather than the live
attachment path. In the Paseo plugin, the `clips.review.open` RPC reads that
CLI-exported file into the dedicated read-only Markdown view. The installed
`@getpaseo/plugin` 0.11.2 SDK exposes `navigation.openBrowser` for HTTP(S) URLs,
but no API for opening an arbitrary Markdown file in a Paseo file tab. Do not
describe this view as a native file-tab open or route the path through a browser.

Goal completion requires a valid acceptance receipt for the exact candidate and
fulfillment of the configured delivery endpoint. A human decision is required
only when the user or contract explicitly requested that review; otherwise the
manager may record the actual accepting actor and close the completed Goal with
the `not-reviewed` label. `changes_requested` returns bounded affected work to a
dev and requires a new candidate-bound review request. `deferred` leaves an
explicit user wait with its next owner and action; do not continue unrelated or
endless work. Deferral is not final: the assigned reviewer may later record a
new decision against the same still-current candidate. Fold the finished dev
promptly after its Goal-attached handoff; pending Goal review never keeps it
open.

`lane_validation_mode=human` remains the default for requested human review;
it does not make review mandatory for every Goal. `lane_validation_mode=agent`
also permits agent acceptance where configured. Neither mode overrides a named
human gate. Manager analysis and agent Task acceptance do not imply human
approval. Use a ready-for-review state only when the candidate is complete, the
request is actionable, and the host supports it.

## Commit and PR boundaries

`lane_commit_mode=after_validation` means the dev commits after automated checks
pass and before manager analysis or user validation. The assignment must
authorize the dev-owned local commit. Stage only owned, verified paths, inspect
the staged diff, preserve unrelated changes, and record the commit identity.
Recheck evidence affected by hooks or generated files. `manual` leaves an
explicit commit handoff with candidate, paths and next owner.

`lane_pr_mode` describes the desired result: `none`, `prepare`, `draft`, or
`ready`. It never authorizes network writes, publication, review-state changes,
messages or reviewer requests. PR materialization requires collaboration enabled,
mode `draft` or `ready`, and explicit `--confirm`; it is allowed while the
review awaits a decision. `draft` uses `gh pr create --draft`; `ready` uses
`gh pr create`. Verify local/remote branch tips against the pinned base/head
SHAs before invoking `gh`. Materialization records a separate PR association
without changing review status. PR creation is only a review surface. It is not
approval, merge, delivery completion, Task acceptance or Goal acceptance. Modes
`none` and `prepare` prohibit materialization. Follow the user's explicit
external-action approval rules. Do not push unless separately authorized.

`lanes attachment add <ref> '<json>'` accepts optional `purpose: "cr"` or
`"adr"`; purpose labels use and grants no authority. Remote CR/ADR references
may be attached, but only readable local Markdown with purpose `cr` can be
pinned for review. A Goal review covers the Goal and required Task obligations;
a Task review covers only that Task; a Lane review requires explicit selected
in-Lane Goal/Task coverage. Fully covered requests coalesce; partial overlaps
reject and identify uncovered obligations. Request reuse compares reviewer,
intent, attachment content, coverage pins, candidate commits and branch refs.

`review show <id> --json` returns a numeric revision. Supplying it as
`expected_revision` to `review decide` or `review complete` is optional in the
CLI and recommended for race-safe UI callers. The UI sends it to prevent a
decision or completion against a revision that changed after display. `show` shows immutable
pinned `attachment.content`, current content, SHA-256 identities and read
identities when content has changed. Candidate pins include immutable base/head
commit SHAs and the matching `base_ref`/`head_ref`; head must remain current
`HEAD` and base an ancestor. Verify both named branch tips against those SHAs
before materialization.

`review decide <id> --file payload.json` accepts optional `expected_revision`,
the exact pinned base/head, and an actor matching the assigned reviewer. Only
`awaiting_review`, `changes_requested`, and `deferred` are actionable. A
deferred review can receive an explicit later decision without changing its
content. Superseded and delivered reviews remain terminal; exact retries do not
reopen them. Approval remains one decision for covered obligations, whether
submitted by the reviewer or imported from the linked PR.

`review complete <id> --file payload.json` requires an approved exact candidate
and endpoint evidence. Payload shape is `{actor, candidate:{base,head},
endpoint, expected_revision?}`. URL endpoints are `{type:"github_pr"|"url",url}`;
`github_pr` requires an HTTPS GitHub pull URL and `url` an absolute HTTP/HTTPS
URL. They are evidence links, not proof of merge, and still require a non-stale
candidate. A local Git proof is `{type:"git",ref:"main",commit:"<full SHA>"}`.
It requires a local branch name, the recorded commit to equal that branch's
current tip, the approved head to be an ancestor, and identical delivered and
approved trees. It permits expected HEAD/base-ref movement from a real
merge/fast-forward; changes to the attachment, CR, coverage, or Lane contract,
and missing candidate objects still reject. Completion does not perform a merge.
It records `delivered_by` and endpoint evidence only; it does not authenticate
the actor or close/accept the Goal or Tasks. A delivered review is a historical
receipt: `review show` reports `stale:false` after delivery, and later unrelated
HEAD/base movement does not reclassify that evidence.

`review pr import <id> --event <PullRequestReview-GraphQL-node-ID> --json` is a
read-only import from an already linked PR. It queries only the supplied review
node ID with `gh api graphql`, then verifies the PR URL, pinned base/head OIDs,
review-event commit OID and valid submission time, event ID, and author login
against the assigned reviewer. Only GitHub `APPROVED` and `CHANGES_REQUESTED`
events import. It records the GitHub review node ID, login, state, commit OID,
PR URL, `submittedAt` and body as local decision provenance. Reimporting the
same event is idempotent; reusing its ID with changed data rejects. Stale
candidates reject. PR creation, merge state and aggregate `reviewDecision` do
not imply approval. Import performs no external writes or continuous sync. It
records a decision on the existing pinned review, not a second approval surface.

The manager owns shared Lanes records and cross-Task coordination and integration
oversight. Assigned devs resolve technical conflicts and execute their own
integration, checks and authorized commits. Workers return evidence and proposed
record updates unless assigned as their writer. A completed worker must be folded
promptly after its Goal-attached handoff, even while the Goal's human review
remains pending. A critical resource fold closes first and records available
context afterward.
