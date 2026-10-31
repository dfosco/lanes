# Provider quota awareness and failover (Paseo)

Provider routing is separate from model routing and reasoning self-assessment. Lane Manager owns provider selection, and dev agents retain their bounded Task ownership until a verified handoff. The durable user policy is stored in `lanes.config.json`; read it with `lanes config --user model_routing_policy`. It contains `providerOrder`, per-role qualified `modelOrder`, `reasoningEffortOrder`, `warningThresholds`, and `handoffThreshold`. Change it persistently when the user asks for a durable routing change; do not substitute a one-turn override. Read/write provider-scoped role defaults with `lanes config --user --provider <catalog-id> <role-model-key>` and the same command with a value or `--unset`.

The policy shape is versioned and user-scoped. Example (replace the empty order with the user's chosen catalog IDs):

```json
{
  "version": 1,
  "providerOrder": [],
  "modelOrder": { "manager": [], "dev": [] },
  "reasoningEffortOrder": ["low", "medium", "high", "xhigh", "max"],
  "warningThresholds": [80, 90],
  "handoffThreshold": 95
}
```

Persist a requested change with `lanes config --user model_routing_policy '<JSON>'`, then read it back. `modelOrder` entries use exact `provider/model-id` values from the host catalog. Per-provider role defaults are separate and are the default models used when the model order has no entry for that provider. Legacy global model keys remain compatibility fallbacks; they do not replace provider-specific entries.

## Usage source and freshness

Use Paseo's host-owned usage reports (for example `paseo usage ls --refresh --json`, `paseo usage inspect <report-id> --refresh`, or a supported plugin SDK usage API). Do not scrape sidebar UI or assume a third-party usage plugin's private storage schema. Discover report/account/provider associations from the host; a display label is not proof that two provider identities share a quota. Do not infer missing quota windows as zero usage. Read the saved routing policy first; its warning and handoff thresholds are user-controlled.

Read every applicable quota window (five-hour, weekly, monthly and model-scoped) and balance where available. Evaluate the **maximum percent used** among applicable, reliable windows, not the average. Tell the user when a configured warning threshold (default 80% or 90%) is reached, including provider, window, reading freshness and the ordered next provider; keep working unless a real limit or user instruction prevents it. At or above the configured handoff threshold (default 95%), do not start new work on that provider; choose the next eligible entry in `providerOrder` and that provider's saved role default, or its qualified `modelOrder` entry. Provider refusals or exhausted balances also make it ineligible. For stale, failed, missing or ambiguous readings, surface uncertainty and avoid automatic handoff solely on the missing reading. A refresh is a best-effort snapshot, not a guarantee of up-to-the-second availability.

## Selection

At each new work phase and meaningful active-Task boundary, refresh usage, compare against the saved thresholds and notify the user at each newly crossed warning level. Before a delegated launch, check quota headroom for the selected provider. Select the next eligible configured fallback that supports the required agent role, tools, permissions, model capabilities and task constraints. Never silently switch to an unapproved paid provider or bypass explicit provider restrictions. Consider remaining quota, user speed/cost preference and the ordered model/effort choices. If none qualifies, report the blocker and stop new dispatches. The settings UI and policy file do not create a background monitor: notices occur when an agent or user-triggered refresh actually checks usage.

## Managed continuation

Provider changes require a new Paseo agent session; do not attempt an in-place provider mutation. For an active dev:
1. Detect threshold at a safe boundary or receive a quota-refusal signal. Notify the Lane Manager, without treating quota as task completion.
2. Request a bounded checkpoint and persist the exact Task/Goal context through the existing Lanes handoff record. Capture worktree/branch, current edits, tests, unresolved issues and next action. If the old provider is exhausted, use the last known durable state and inspect actual working-tree changes.
3. Quiesce the old session and confirm no active writes or external effects remain. Preserve ownership and authorization. Never have two writers active in the same worktree.
4. Resolve an eligible fallback provider/model using live host discovery. Start a new agent in the appropriate existing workspace/worktree with the persisted contract and checkpoint; read back its actual provider, model and session identity.
5. Verify continuation before folding the previous worker. If launch or verification fails, retain the checkpoint and report the blocker; do not claim failover success.
6. Record the association and reason, and keep the Lane Manager's existing resource reservation, folding and acceptance rules.

Avoid oscillation: do not switch back to a provider until its relevant limiting window resets and fresh readings confirm headroom. Limit automatic handoff attempts and avoid a provider-failover loop. Manager sessions themselves require a separately authorized continuity mechanism; a manager must not silently abandon ownership by spawning an unregistered replacement.

## Implementation boundary

This is a contract for future runtime wiring. Automatic threshold watching, safe handoff and cross-provider continuation require host-specific integration and tests; merely adding this reference does not activate them.
