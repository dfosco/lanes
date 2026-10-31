# Model routing and reasoning policy

This reference defines two independent decisions. Model routing is owned by Lane Manager when assigning a dev. Reasoning self-assessment is owned by each active agent for its own session. Neither decision changes authorization, task ownership, or acceptance rules.

## Manager: initial model routing

Before launching an authorized Lane Dev, assess the bounded work contract, not just its title. Consider uncertainty, coupling, known dependencies, user speed/cost preference, available models and supported host capabilities. Choose the least costly capable model; do not infer capability from a model name alone.

Suggested starting tiers (override with configured preferences and actual host options):
- Routine and well specified: Luna 6, low reasoning.
- Normal implementation: Luna 6, medium.
- Complex implementation or uncertain debugging: Luna 6, high.
- Architecture-heavy work requiring stronger planning: Sol 6.1, medium or high.

These are recommendations, not a hard-coded allowlist. Discover supported provider/model/reasoning IDs. The manager selects the initial dev model; the dev does not independently escalate to another model family. If a model change is needed during execution, request a new manager routing decision. Record the chosen model and reason in the handoff, not as a new mandatory Lanes record type. Read back the effective launch configuration; report mismatches.

## Both roles: reasoning self-assessment

At the start of a work phase and at meaningful boundaries (new Task, unexpected blocker, repeated unsuccessful attempts, root cause established, transition to mechanical implementation or verification), decide whether the *same model* should use lower or higher reasoning. Do not run a separate classifier or assess after every tool call.

- Low: deterministic, small, clearly scoped actions.
- Medium: ordinary implementation, planning and verification.
- High: ambiguity, difficult root-cause analysis, conflicting constraints, repeated failure without progress.

User speed preference biases toward low/medium when safe; thoroughness biases toward medium/high. Task size alone does not imply high complexity. After escalation, reassess when the hard part is resolved and downgrade. Repeated failure requires a change of investigative strategy; do not endlessly retry at high.

Only change settings using a verified host-supported capability targeting the current session. Resolve valid thinking IDs from the live provider; apply changes between turns, then read back effective settings. Do not modify global config, spawn a replacement session, or claim a switch occurred when no supported self-update is available. If unavailable, continue with the current effort and mention the limitation at the next useful handoff.

Keep routing and reasoning decisions lightweight. Do not override explicit user model, cost, or speed constraints. Avoid logging credentials or full prompts.
