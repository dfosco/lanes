# Lanes records and optional Paseo execution

This is the shared procedure for ordinary dev agents, direct user steering,
and Lane Manager handoffs. Use the installed interfaces you actually have;
inspect tool schemas and CLI help before using a version-dependent capability.
An assigned dev agent implements its outcome and maintains its records. It
does not need to become Lane Manager, spawn a replacement, or claim a Lane.
Lane Manager separately retains its coordination-only, top-level delegation,
task-coverage, authorization, and management-claim policies.

## Distinguish the sources

- **Planning:** the plugin reads `lanes board --json` from the selected Git
  repository's shared Lanes store. Update records through the Lanes CLI, never
  raw journals or a parallel UI store. Linked worktrees share that store.
- **Activity and navigation:** the plugin reads the selected Paseo host's
  workspace/agent directory. An `in_progress` Goal can have no running agent;
  an idle, failed, or input-blocked session is different from active execution.
  Idle or finished-but-unclosed agents still occupy resources. A stopped agent
  is not evidence that its Task is complete, accepted or natively closed.
- **Association:** an observed session/workspace is attached to an exact work
  record by native Paseo labels. Titles and Lanes `owner` prose do not make
  that link. A Task binding is not an automatic binding to its parent Goal.
- **Management:** durable Lane claims are separate from work execution. They
  survive disconnection. Contributing to an agreed Goal/Task requires no Lane
  claim; strategic Lane management still requires its own authority/procedure.

## Maintain the work contract

Read the complete qualified Goal/Task, linked contracts, scope, criteria and
blockers. Reuse the current request/authorization. A direct bug/feature request
can be implemented by the current dev agent; no manager session is required.
Create or amend the bounded Task request before implementation when needed.
Preserve historical IDs and request revisions. Use the goal for coordination
and cross-task decisions, and tasks for independently acceptable changes.

Use actual supported commands, for example:

```sh
lanes view '#g1#t1' --json
lanes task update g1 t1 --file task-request.json
lanes task status g1 t1 in_progress
lanes task update g1 t1 --file task-result.json
lanes task accept g1 t1 --file task-acceptance.json
lanes view '#g1#t1' --json
```

`task-request.json` can set `owner` to the actual execution identity and amend
`blocked_by` to reflect real dependencies. Do not clear blockers simply to run.
Record an execution destination that another agent can identify; that owner
field is coordination metadata, not the runtime association below. Keep a
truthful result/record while working or blocked. Acceptance requires the checked
artifact, actual accepting actor and criterion evidence under the main Lanes
skill; administrative status alone is insufficient. Update the Goal's plan or
record when coordination/outcome changes. Use expected revisions when supported.

## Discover identity and bind the actual session

For the native Paseo tools, the supported sequence is:

1. Identify the actual session you are authorized to use. In a Paseo agent,
   `PASEO_AGENT_ID` is an observed candidate ID, not a fabricated display name.
   Read `get_agent_status({agentId})`: the returned snapshot includes `id`,
   `cwd`, `workspaceId`, current `labels` and actual runtime status. Use
   `list_agents` to discover candidates when needed, not as a polling loop.
2. Read `list_workspaces({})` and match the snapshot's `workspaceId` to the
   returned `workspaceId`, `cwd`, and **`projectId`**. Verify the actual project
   and selected workspace belong to the repository/worktree being worked on.
   The Paseo project ID is not Lanes config `project_id`, a title, or a guessed
   hash. Resolve ambiguous repositories/workspaces before writing a binding.
3. Read the exact Lanes ref, retaining any namespace, and select its real kind:
   `goal` for a whole-Goal owner, `task` for a bounded Task, or `lane` only for
   actual Lane management. Read current labels immediately before an update.
   With `update_agent`, merge the three fields below into those fresh labels;
   preserve every unrelated key. For example, a tool invocation constructed
   from observed values has this shape (variables are not literal IDs):

   ```js
   update_agent({
     agentId: observedSessionId,
     labels: {
       ...freshSnapshot.labels,
       "lanes.ref": qualifiedRecordRef,
       "lanes.projectId": observedWorkspace.projectId,
       "lanes.kind": recordKind,
     },
   })
   ```

4. Reread `get_agent_status({agentId})` and verify the exact triple, session,
   workspace and repository. New launches need this readback too, even if the
   launch path sets labels automatically. Report success only for what was
   observed. An ordinary dev agent can now continue its direct assignment;
   a coordinator reusing another session sends the complete outcome through
   `send_agent_prompt` within existing authority and reports actual handoff.

For shell-only environments with the installed Paseo CLI, inspect
`paseo project ls --help`, `paseo agent update --help`, and `paseo ls --help` first.
Resolve the executable from the host's `PASEO_CLI` when provided, or
`command -v paseo`; examples use `paseo` as shorthand for that actual executable.
An app-bundled CLI may not be on PATH. Do not invent an installation path.
Current supported equivalents include `paseo project ls --json` to discover
actual registered project IDs and `paseo agent update <actual-agent-id>` with
repeated `--label key=value` add/set flags. Read back the exact association and
match the actual agent ID. Substitute observed values; do not copy placeholders:

```sh
paseo agent update '<actual-agent-id>' \
  --label 'lanes.ref=<qualified-ref>' \
  --label 'lanes.projectId=<observed-project-id>' --label 'lanes.kind=<kind>' --json
paseo ls --global --label 'lanes.ref=<qualified-ref>' \
  --label 'lanes.projectId=<observed-project-id>' --label 'lanes.kind=<kind>' --json
```

The compact list omits the complete label map and workspace ID. Use a native
snapshot/workspace API when those need inspection; never pretend the compact
list supplied missing metadata. If no supported discovery/write/readback route
is available, report that integration limitation and continue authorized record
work rather than inventing flags or claiming association succeeded.

`paseo inspect <actual-agent-id> --json` exposes `ParentAgentId`. Verify null
parentage when a top-level dev-owner handoff is required; do not infer it from
workspace placement or a visible tab. A child must not present itself as a
top-level execution owner. The existing Lane Manager role policy determines
which sessions it may choose; this procedure does not grant it child creation.

## Direct steering, reuse, and limitations

A user may steer the current dev agent directly. Keep its Task/Goal records
and binding aligned with the agreed outcome. Continue the same session only
within its still-active bounded assignment. Fold it promptly when finished;
do not retain it idle for possible new work. Do not steal another owner's
session or silently relabel an unrelated active outcome. A single `lanes.ref` cannot
represent several simultaneous Goals. Use separate authorized owners or actual
supported multi-record association; do not claim nonexistent aggregation.

When a Lane Manager is explicitly asked to continue in `codex`, `claude`, or
`opencode`, the manager's provider-specific worker replacement exception takes
precedence over ordinary session reuse. Follow the canonical
[Lane Manager provider-continuation procedure](../../lane-manager/SKILL.md#explicit-continuation-in-a-provider):
request a checkpoint, then use a supported non-destructive pause or
cancel-current-run action for every running dev it manages and verify
quiescence. If no checkpoint arrives, preserve the available transcript and
workspace state and record missing context. Recreate workers in the requested
provider with the same unfinished contracts and revision pins, then update the
current advisory worker association after verifying the replacement identity.
This exception is specific to that manager request;
it does not authorize replacing another manager's worker, a standalone dev
outside that manager's scope, or an unrelated session. Continue to use the
current host's supported session lifecycle and readback capabilities; this
reference does not imply that every host exposes pause or suspend.

Preserve labels from the freshest read and read them back. Full-map replacement
APIs without revision/CAS support cannot guarantee against a concurrent writer
between read and write; coordinate a single binding writer, report conflicts,
and use atomic revision support if the installed interface provides it. Do not
invent CAS flags. Binding success alone does not prove the Go to agent action
renders. If a concrete UI problem remains, send the observed binding/workspace
and reproduction details to the responsible UI dev owner; preserve the host's
computer-use and external-message authorization rules.

## Configure a new session only when needed

Current dev agents do not need a new session merely to update assigned work.
Continue a suitable top-level owner only within its current still-active bounded
assignment. An explicit provider-continuation request may require replacing its
managed running devs as described above. Fold the owner promptly when its
assignment ends; new work after completion needs a fresh authorized owner.
Discover configured profiles and their notes. Materialize the requested
provider/model, permission mode, thinking and feature values; if no profile fits,
discover live capabilities and report the fallback rather than guessing values.
Workspace choice follows the request/settings, not a universal isolation default.

For a new manager, read `lane_manager_model` and
`lane_manager_reasoning_effort`; for a new dev owner, read `lane_dev_model` and
`lane_dev_reasoning_effort` from the Lane project's effective configuration.
An explicit user choice for that Lane or worker takes precedence. These saved
preferences do not change an existing or resumed manager; preserve its current
model and effort.

Lanes stores a model ID, while Paseo launch requires a `provider/model` pair.
Use live `options` output to find a ready provider that exposes the exact
preferred model ID. Do not invent a provider prefix or assume every host has
the same catalog. Resolve reasoning effort through the selected model's
discovered `--thinking` options. If the preference is unavailable, select a
supported role-appropriate model and effort from the live results; use the
only available model or provider default when no tier comparison exists.
Disclose requested and selected values and do not rewrite the stored
preference. If no launchable provider/model or native default exists, report
that actual capability blocker.

From the Lanes checkout on Node.js 22.18 or later, the supported top-level
launch path is the Lanes Paseo CLI (or its plugin launch dialog):

```sh
node plugins/paseo/cli.js options --project . --provider codex
node plugins/paseo/cli.js options --project . --provider codex/gpt-6.1-sol
node plugins/paseo/cli.js start --project . --ref '#g1#t1' \
  --provider codex/gpt-6.1-sol --thinking high --speed fast \
  --permission full-access --workspace '<observed-workspace-id>' --dry-run --json
```

Examples of provider/model/settings are illustrative: use values returned by
live discovery. The provider-only query lists ready models and permission modes;
provider/model queries include thinking/features. Add `--thinking <id>` to
discovery when feature availability depends on thinking. Full access is the
default where supported; `--permission restricted` selects a matching restricted
mode and `--mode <id>` chooses an exact discovered provider mode. Missing requested
modes are a real choice/blocker, not permission to substitute a default.

Inspect the preview's exact ref, prompt, workspace action, `config.modeId` and
feature values. `--workspace <id>` selects a current/existing workspace;
`--base <branch>` selects the base for a requested new worktree. Without a
matching workspace the CLI proposes a new worktree; do not accept that if the
request calls for current-workspace execution. Lane launches additionally need
the actual observed app host ID in `--host-id`, even for a dry run; use Lane
Manager for strategic management and claim/authority policy. Goal/Task launches
require neither Lane ownership nor that host-ID option.

Within the user's authorization, run the same start command without `--dry-run`,
then verify actual returned parentage, workspace and binding. Lane Manager must
first resolve its delivery-mode choice or honor the user's explicit selection.
The planning-validation path permits no worker launch before user approval.
Once execution is authorized, do not add a routine start confirmation.
Explicit plan/defer/queue instructions and real blockers still override
execution. The checkout CLI uses an unscoped
workspace SDK route. Agent-scoped `create_agent` and `paseo run` create children
even in another workspace, so are not substitutes for a top-level-owner launch.
Dev owners follow Lanes' Task-level parallel execution guidance when assigning
their own sub-agents within their role and authority; those workers do not
replace the verified top-level owner or imply a new Lane management claim.

## Resource coordination and folding

Keep the manager's resource channel current throughout the Lane. From the
installed full Lanes checkout, use the observed native manager identity:

```sh
node plugins/paseo/cli.js resources --manager '<observed-manager-id>' --action status
node plugins/paseo/cli.js resources --manager '<observed-manager-id>' --action status --watch
node plugins/paseo/cli.js resources --manager '<observed-manager-id>' \
  --action reserve --count 1 --request-id '<request-UUID>'
```

Keep one `--watch` stream for the manager to receive status/inbox updates every
15 seconds; use the harness's supported long-running-process interface and
stop that stream when the manager ends. Also read fresh status at planning
boundaries and before every dispatch. Reserve
before launch, honor the returned grant, then report actual created agent IDs
against the returned reservation. Reuse request IDs on retries, and reconcile
ambiguous launches before another attempt. Release an unused reservation or
report actual verified closures; do not release capacity merely because a
worker is idle or has returned a result.

```sh
node plugins/paseo/cli.js resources --manager '<observed-manager-id>' \
  --action report --reservation '<issued-reservation-id>' --agents '<observed-dev-id>'
node plugins/paseo/cli.js resources --manager '<observed-manager-id>' \
  --action release --reservation '<unused-reservation-id>'
```

Fresh enabled resource-manager capacity replaces `lane_max_active_agents`.
Use its stored default of 5 only when the manager is unavailable, stale or
disabled. Explicit user ceilings and native quotas still apply. Keep reporting
launches, handoffs, folds and failures so the resource manager can update grants;
do not treat a one-time status read as an ongoing allocation.

Provider-continuation replacement must account for the original sessions while
recreating workers. First checkpoint and pause every managed running dev, then
verify each is quiescent, including settling or inspecting outstanding tools and
background writes. Native idle status and no active turn alone do not prove the
workspace is quiescent; treat unknown write activity as pending. A paused or idle
original still occupies capacity until its native runtime is closed; do not
assume pausing frees a slot. Read fresh resource status and reserve only the
replacements that the live grant permits.
If the live channel is unavailable, stale or disabled, use the configured
`lane_max_active_agents` fallback and respect explicit user ceilings and native
quotas. Where available capacity is insufficient, retain originals paused when
possible. To release capacity for a replacement, persist the latest
`reassignment` context on the respective Goal and get manager acknowledgment.
When the resource channel is available, deliver and acknowledge that handoff
through the channel; otherwise use `lanes handoff record` and have the manager
read the Goal attachment. Then use the supported normal native fold/closure and
verify runtime closure before counting the slot as free or reserving against it.
Preserve original workspace, transcript, Task IDs, attribution and unfinished
contract. If a fold or launch fails partway, keep verified replacements, leave
not-yet-folded originals paused, and report already-folded originals as closed
with their preserved context. Include the exact old-to-new mapping and any
ambiguous state. Never resume an original silently or launch on another provider.

Always fold a developer promptly after its bounded assignment is finished,
including during pending human Goal review. For normal completion or warning
pressure, send its latest context through the handoff command. This persists
Goal-attached context and makes it available to the manager's channel:

```sh
node plugins/paseo/cli.js handoff --manager '<observed-manager-id>' \
  --agent '<observed-dev-id>' --context-file /absolute/handoff-context.md \
  --reason completed --handoff-id '<handoff-UUID>'
```

Use `resource_warning` or `reassignment` for those normal handoff reasons.
Read `channel.pendingHandoffs` through `resources --action status`, including
the latest context and each respective Goal attachment. Acknowledge the read
handoff by supplying its ID to the fold action; do not close first or merely
assume the manager received a chat message. Normal folds also require fresh
native idle state after the developer settles its writes and other effects:

```sh
node plugins/paseo/cli.js fold --manager '<observed-manager-id>' \
  --agent '<observed-dev-id>' --handoff-id '<acknowledged-handoff-UUID>'
```

When the live resource condition is **critical**, use `fold` immediately without
a handoff ID. Do not wait for context, acknowledgment, attachment, checkpoint or
quiescence. The emergency path closes first and preserves already available
context on the respective Goals afterward, marking interrupted work incomplete.
Keep closure or persistence failures visible; they do not imply acceptance.

Paseo's native archive operation closes the provider runtime and removes its
agent tabs while retaining history. Verify the refreshed closed/archived state.
Detaching only removes a parent association, and stopping a turn is not a fold.
Provider subprocess/descendant guarantees vary: report missing process evidence
instead of claiming that every detached child process was terminated. Preserve
source, worktrees and transcripts. Other harnesses use their discovered native
close operation under the same [normal and critical folding policy](delivery.md#bounded-worker-assignments-and-retirement).

If this installed version lacks the resource channel, use the documented
fallback capacity and core `lanes handoff record` before supported native
closure. Do not invent commands or claim an unavailable live service.

## When Paseo is absent

Use Lanes locally for authorized requests, owners, statuses, blockers, results
and acceptance. Runtime integration is optional. Report missing session/project
discovery, tooling or daemon access precisely; do not block unrelated engineering,
start a manager, fake a Lane claim, or infer a running agent from Lanes status.
Filesystem skill updates become visible through live links, but already-loaded
session instructions require explicit rereading; dissemination is not prompt
hot-reload or future compliance proof.
