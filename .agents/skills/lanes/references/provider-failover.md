# Provider quota awareness and failover (Paseo)

Provider routing is separate from model routing and reasoning self-assessment. Lane Manager owns provider selection, and dev agents retain their bounded Task ownership until a verified handoff. This guidance does not itself implement automatic monitoring.

## Usage source and freshness

Use Paseo's host-owned usage reports (for example `paseo usage ls --refresh`, `paseo usage inspect <report-id> --refresh`, or a supported plugin SDK usage API). Do not scrape sidebar UI or assume a third-party usage plugin's private storage schema. Discover report/account/provider associations from the host; a display label is not proof that two provider identities share a quota. Do not infer missing quota windows as zero usage.

Read every applicable quota window (five-hour, weekly, monthly and model-scoped) and balance where available. Evaluate the **maximum percent used** among applicable, reliable windows, not the average. At or above 95%, do not start new work on that provider. Provider refusals or exhausted balances also make it ineligible. For stale, failed, missing or ambiguous readings, surface uncertainty and avoid automatic handoff solely on the missing reading. A refresh is a best-effort snapshot, not a guarantee of up-to-the-second availability.

## Selection

Before each delegated launch, check quota headroom for the selected provider. Select an eligible configured fallback that supports the required agent role, tools, permissions, model capabilities and task constraints. Never silently switch to an unapproved paid provider or bypass explicit provider restrictions. Consider remaining quota, user speed/cost preference and available models. If none qualifies, report the blocker and stop new dispatches.

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
