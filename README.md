# Subagent Model Router for Pi

A companion extension for [`pi-herdr-subagents`](https://github.com/0xRichardH/pi-herdr-subagents) that adds tier-based model and thinking-level routing to subagents in the [Pi coding agent](https://pi.dev).

`pi-subagent-model-router` hooks into the `subagent` tool exposed by [`pi-herdr-subagents`](https://github.com/0xRichardH/pi-herdr-subagents) (`npm:pi-herdr-subagents`) and assigns an authenticated model and clamped thinking level based on abstract capability tiers (`fast`, `balanced`, `deep`) and the active provider in the parent session. This keeps your subagent definitions (`scout`, `worker`, `planner`, `reviewer`, `visual-tester`, and custom agents) portable across providers (`antigravity`, `openai-codex`, `kiro`, `amazon-bedrock`, `openai`, `anthropic`, `google`) without hardcoding provider-specific model IDs into every agent file.

## Features

- **Provider-Aware Tier Routing**: Map named subagents (`scout`, `worker`, `planner`, `reviewer`, `visual-tester`) to capability tiers (`fast`, `balanced`, `deep`) and resolve the best authenticated model for the active provider.
- **Hierarchical Configuration Merging**: Deep-merge configuration layers from bundled defaults, user global config (`~/.pi/agent/subagent-model-router.json`), and project-local config (`<cwd>/.pi/subagent-model-router.json`).
- **Agent Frontmatter Support**: Read `tier`, `model`, and `thinking` directly from agent Markdown frontmatter (`<cwd>/.pi/agents/*.md`, `~/.pi/agent/agents/*.md`, or bundled `pi-herdr-subagents/agents/*.md`).
- **Multi-Stage Model Fallback**: Fall back through ordered provider pools (`providerOrder`), wildcard `fallbackPatterns`, and an input-cost heuristic when a provider has no explicit catalog entry.
- **Thinking-Level Clamping**: Clamp target thinking levels (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`) to the resolved model's supported capabilities via `@earendil-works/pi-ai`.
- **Non-Destructive Precedence**: Preserve explicit `model` and `thinking` arguments passed in a `subagent` tool call or declared in agent frontmatter.
- **Interactive Inspection Command**: Run `/subagent-models` in Pi to inspect the resolved tier, model, and thinking level for each configured subagent.

## Prerequisites

- Node.js >= 22.5.0 (for `--experimental-strip-types` when running tests)
- [Pi coding agent](https://pi.dev) >= 1.3.0
- [`pi-herdr-subagents`](https://github.com/0xRichardH/pi-herdr-subagents) (`npm:pi-herdr-subagents` on npm, or `git:https://github.com/0xRichardH/pi-herdr-subagents`)

## Installation

### Install via Pi CLI

Ensure [`pi-herdr-subagents`](https://github.com/0xRichardH/pi-herdr-subagents) is installed alongside `pi-subagent-model-router`:

```bash
pi install npm:pi-herdr-subagents
pi install git:https://github.com/gierdo/pi-subagent-model-router
```

Or install `pi-subagent-model-router` from a local checkout:

```bash
pi install ./path/to/pi-subagent-model-router
```

### Declare in `settings.json`

Alternatively, add the package to the `packages` array in `~/.pi/agent/settings.json` (user scope) or `<cwd>/.pi/settings.json` (project scope):

```json
{
  "packages": [
    "npm:pi-herdr-subagents",
    "git:https://github.com/gierdo/pi-subagent-model-router"
  ]
}
```

Run `/reload` inside an active Pi session or restart Pi to load the extension.

## Quickstart

1. Verify that the extension is loaded and inspect the resolved routing for your current provider:

   ```text
   /subagent-models
   ```

   Example output when `antigravity` is the active provider:

   ```text
   scout [fast] -> model: antigravity/gemini-3.8-flash, thinking: low
   worker [balanced] -> model: antigravity/gemini-4-argon, thinking: medium
   visual-tester [balanced] -> model: antigravity/gemini-4-argon, thinking: medium
   planner [deep] -> model: antigravity/gemini-4-hydrogen, thinking: high
   reviewer [deep] -> model: antigravity/gemini-4-hydrogen, thinking: high
   ```

2. Optionally tag a custom agent file (for example, `.pi/agents/investigator.md`) with a `tier` field in its frontmatter:

   ```markdown
   ---
   name: investigator
   description: Deep root-cause analysis agent
   tier: deep
   tools: read, bash
   ---
   ```

3. Spawn the subagent without hardcoding a model or thinking level. The router populates `model` and `thinking` automatically on the `subagent` tool call.

## Configuration

### Configuration Hierarchy

The router resolves and deep-merges up to three JSON configuration files from lowest to highest precedence:

| Precedence | Scope | Path | Purpose |
| :--- | :--- | :--- | :--- |
| 1 (Lowest) | Bundled | `<packageDir>/subagent-model-router.json` | Default tier mappings and provider model catalogs shipped with the extension. |
| 2 | User | `~/.pi/agent/subagent-model-router.json` (or `$PI_CODING_AGENT_DIR/subagent-model-router.json`) | Personal overrides across all projects (custom provider priority, preferred models, or personal agent tiers). |
| 3 (Highest) | Project | `<cwd>/.pi/subagent-model-router.json` | Repository-specific overrides for project agents or stricter tier assignments. |

### Merge Semantics

Higher-precedence files do not need to duplicate the entire configuration. Rules merge as follows:

- **Top-level scalars** (`preferActiveProvider`, `defaultTier`): Higher layer replaces lower layer when defined.
- **`providerOrder`**: Higher layer array replaces lower layer array when defined.
- **`agentTiers`**: Shallow-merged by agent name (`{ ...base.agentTiers, ...override.agentTiers }`).
- **`tiers.<tierName>`**: Merged per tier:
  - `thinking`: Higher layer replaces lower layer when defined.
  - `providers`: Shallow-merged by provider key (`{ ...baseTier.providers, ...overrideTier.providers }`). Overriding `antigravity` in `tiers.fast.providers` replaces the `antigravity` model list for `fast` while keeping `openai`, `kiro`, and `amazon-bedrock` intact.
  - `fallbackPatterns`: Higher layer array replaces lower layer array for that tier when defined.

### Configuration Schema Reference

| Field | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `preferActiveProvider` | `boolean` | `true` | Place the parent session's active provider at the front of the provider search order. |
| `providerOrder` | `string[]` | `["antigravity", "openai-codex", "kiro", "amazon-bedrock", "openai", "anthropic", "google"]` | Fallback provider priority when the active provider has no matching model (or when `preferActiveProvider` is `false`). Any remaining authenticated providers not listed here are appended afterward. |
| `defaultTier` | `string` | `"balanced"` | Fallback tier used when an agent has neither a frontmatter `tier` nor an entry in `agentTiers`. |
| `agentTiers` | `Record<string, string>` | `{ "scout": "fast", "worker": "balanced", "visual-tester": "balanced", "planner": "deep", "reviewer": "deep" }` | Maps subagent names to tier keys defined in `tiers`. |
| `tiers` | `Record<string, TierConfig>` | `{ fast, balanced, deep }` | Map of tier names to their thinking level and model selection rules. |
| `tiers.<name>.thinking` | `ThinkingLevel` | `"low"` / `"medium"` / `"high"` | Default thinking level for the tier (`"off"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"`, `"max"`). |
| `tiers.<name>.providers` | `Record<string, string[]>` | Per-provider arrays | Ordered list of model IDs or wildcard patterns (such as `"*claude-sonnet-4-5*"`) per provider. First authenticated match wins. |
| `tiers.<name>.fallbackPatterns` | `string[]` | Tier wildcard list | Provider-agnostic wildcard patterns (such as `["*flash*", "*haiku*", "*mini*"]`) checked when no explicit `providers.<provider>` entry matches. |

### Configuration Examples

#### Example 1: User override (`~/.pi/agent/subagent-model-router.json`)

Override only the `antigravity` models for the `deep` tier and add a custom `security-auditor` agent mapping without repeating the rest of the catalog:

```json
{
  "agentTiers": {
    "security-auditor": "deep"
  },
  "tiers": {
    "deep": {
      "providers": {
        "antigravity": [
          "claude-opus-5-5",
          "gemini-4-hydrogen"
        ]
      }
    }
  }
}
```

#### Example 2: Project override (`<cwd>/.pi/subagent-model-router.json`)

Route `worker` to the `deep` tier and increase `balanced` thinking to `high` for a complex repository:

```json
{
  "agentTiers": {
    "worker": "deep"
  },
  "tiers": {
    "balanced": {
      "thinking": "high"
    }
  }
}
```

## Agent Frontmatter Integration

The router inspects Markdown frontmatter in agent definitions using the same directory precedence as `pi-herdr-subagents`:

1. `<cwd>/.pi/agents/*.md` (project agents)
2. `~/.pi/agent/agents/*.md` (user global agents)
3. `~/.pi/agent/npm/node_modules/pi-herdr-subagents/agents/*.md` or `~/.pi/agent/git/github.com/0xRichardH/pi-herdr-subagents/agents/*.md` (bundled package agents)

Supported frontmatter fields:

| Frontmatter Field | Type | Precedence Behavior |
| :--- | :--- | :--- |
| `name` | `string` | Matches the `agent` argument passed to the `subagent` tool (falls back to filename without `.md`). |
| `tier` | `string` | Overrides `agentTiers[agent]` and `defaultTier` from JSON configuration. |
| `model` | `string` | Explicit `<provider>/<model-id>`. Skips tier model selection unless overridden by the `subagent` tool call's `model` argument. |
| `thinking` | `ThinkingLevel` | Overrides `tiers.<tier>.thinking` unless overridden by the `subagent` tool call's `thinking` argument. |

## Resolution Order

When `subagent({ agent, model, thinking })` is called, the router resolves `model` and `thinking` as follows:

1. **Tier Resolution**:
   `frontmatter.tier` -> `config.agentTiers[agent]` -> `config.defaultTier`.
2. **Model Resolution**:
   - **Explicit Override**: If `input.model` (tool call argument) or `frontmatter.model` is set, keep it as the target model.
   - **Pass 1 (Explicit Provider Catalog)**: Build ordered provider pools from authenticated models (`activeProvider` first if `preferActiveProvider !== false`, then `providerOrder`, then any remaining authenticated providers). For each provider pool, return the first model matching `tierConfig.providers[provider]`.
   - **Pass 2 (Wildcard Fallbacks & Cost Heuristic)**: For each provider pool, return the first model matching `tierConfig.fallbackPatterns`. If none match, rank models in that provider pool by input token price (`cost.input`): lowest cost for `fast`, highest-cost reasoning model (or highest cost) for `deep`, and median cost for `balanced`.
   - **Parent Inheritance**: If no model matches across any pass, omit `input.model` so `pi-herdr-subagents` inherits the parent session's model.
3. **Thinking Resolution**:
   - If `input.thinking` is explicitly passed in the tool call, keep it unchanged.
   - Otherwise, take `frontmatter.thinking ?? tierConfig.thinking` and clamp it against the resolved target model's supported thinking levels via `clampThinkingLevel` and `getSupportedThinkingLevels`.

## Development and Testing

Run the unit test suite using Node's built-in test runner:

```bash
node --test --experimental-strip-types test/*.test.ts
```

## License

MIT
