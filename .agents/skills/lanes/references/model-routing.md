# Model routing and reasoning policy

This reference defines two independent decisions. Model routing is owned by Lane Manager when assigning a dev. Reasoning self-assessment is owned by each active agent for its own session. Neither decision changes authorization, task ownership, or acceptance rules.

## Manager: initial model routing

Before launching an authorized Lane Dev, assess the bounded work contract, not just its title. Consider uncertainty, coupling, known dependencies, user speed/cost preference, available models and supported host capabilities. Choose the least costly capable model; do not infer capability from a model name alone.

Read the durable `model_routing_policy` (`lanes config --user model_routing_policy`) and resolve provider-scoped role defaults using the actual Paseo catalog provider ID, for example `lanes config --user --provider codex lane_dev_model`. The saved provider order is the eligible fallback order; the role's qualified model order overrides that provider's default when present. A `modelEffort` value saved for that ranked entry is the effort to launch it with, when the model still offers it; otherwise fall back to the provider/role default effort. The JSON `reasoningEffortOrder` is the user's persistent low-to-high ordering for supported effort IDs. A direct user request to change this policy is durable: update the user config via the Lanes CLI and read it back. Do not turn that request into a temporary session-only override. Project-specific values still take precedence for that project.

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

Only change a running session's effort using a verified host-supported capability targeting that session. Resolve valid thinking IDs from the live provider and use the saved `reasoningEffortOrder` to select the next supported adjacent level; apply between turns and read back effective settings. Changing the durable policy is a separate user-level action: do it only when the user asks for a lasting change, then read it back. Do not spawn a replacement session or claim a session switch occurred when no supported self-update is available. If unavailable, continue with the current effort and mention the limitation at the next useful handoff.

Keep routing and reasoning decisions lightweight. Do not override explicit user model, cost, or speed constraints. Avoid logging credentials or full prompts.
