# pi-subagent-model-router

Tier-based model and thinking router for Pi subagents (`subagent` tool calls).

## How it works

When a named subagent is spawned via the `subagent` tool without explicit `model` or `thinking` overrides:

1. Reads `tier`, `model`, and `thinking` from the subagent's Markdown frontmatter (`<cwd>/.pi/agents`, `~/.pi/agent/agents`, or bundled `pi-herdr-subagents/agents`).
2. Maps the subagent to a tier (`fast`, `balanced`, `deep`) via frontmatter `tier`, `agentTiers[agent]`, or `defaultTier`.
3. Resolves the best authenticated model for that tier, preferring the active parent session's provider (when `preferActiveProvider` is `true`), then `providerOrder`, then `fallbackPatterns`, and finally a token-cost heuristic.
4. Clamps the resolved thinking level (`frontmatter.thinking ?? tier.thinking`) to the target model's supported thinking levels.

## Configuration hierarchy

Configurations are deep-merged from lowest to highest precedence:

1. **Bundled defaults**: `<packageDir>/subagent-model-router.json`
2. **User global overrides**: `~/.pi/agent/subagent-model-router.json` (or `$PI_CODING_AGENT_DIR/subagent-model-router.json`)
3. **Project local overrides**: `<cwd>/.pi/subagent-model-router.json`

Higher layers only need to specify the fields, tiers, or provider lists they want to override.

## Commands

- `/subagent-models` - Display the resolved tier, model, and thinking level for each configured subagent under the active provider.
