import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  clampModelThinking,
  loadRouterConfig,
  matchesPattern,
  mergeRouterConfigs,
  readAgentFrontmatter,
  resolveSubagentRouting,
  selectModelForTier,
  type CandidateModel,
  type RouterConfig,
} from "../index.ts";

describe("pi-subagent-model-router", () => {
  it("merges hierarchical configs (bundled -> user -> project)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "router-cfg-"));
    try {
      const bundledPath = join(tmp, "bundled.json");
      const agentDir = join(tmp, "agent");
      const projectDir = join(tmp, "project");
      mkdirSync(agentDir, { recursive: true });
      mkdirSync(join(projectDir, ".pi"), { recursive: true });

      const bundled: RouterConfig = {
        preferActiveProvider: true,
        providerOrder: ["antigravity", "openai"],
        defaultTier: "balanced",
        agentTiers: {
          scout: "fast",
          worker: "balanced",
          planner: "deep",
        },
        tiers: {
          fast: {
            thinking: "low",
            providers: {
              antigravity: ["gemini-3.8-flash"],
              openai: ["gpt-5-mini"],
            },
            fallbackPatterns: ["*flash*", "*mini*"],
          },
          balanced: {
            thinking: "medium",
            providers: {
              antigravity: ["gemini-4-argon"],
            },
          },
        },
      };

      const userOverride = {
        agentTiers: {
          worker: "deep",
        },
        tiers: {
          fast: {
            providers: {
              antigravity: ["custom-user-flash"],
            },
          },
        },
      };

      const projectOverride = {
        defaultTier: "fast",
        tiers: {
          fast: {
            thinking: "minimal",
          },
        },
      };

      writeFileSync(bundledPath, JSON.stringify(bundled));
      writeFileSync(
        join(agentDir, "subagent-model-router.json"),
        JSON.stringify(userOverride),
      );
      writeFileSync(
        join(projectDir, ".pi", "subagent-model-router.json"),
        JSON.stringify(projectOverride),
      );

      const resolved = loadRouterConfig({
        cwd: projectDir,
        agentDir,
        bundledConfigPath: bundledPath,
      });

      assert.equal(resolved.defaultTier, "fast");
      assert.equal(resolved.agentTiers?.scout, "fast");
      assert.equal(resolved.agentTiers?.worker, "deep");
      assert.equal(resolved.tiers.fast.thinking, "minimal");
      assert.deepEqual(resolved.tiers.fast.providers?.antigravity, [
        "custom-user-flash",
      ]);
      // Unoverridden provider from bundled config is preserved
      assert.deepEqual(resolved.tiers.fast.providers?.openai, ["gpt-5-mini"]);
      assert.deepEqual(resolved.tiers.balanced.providers?.antigravity, [
        "gemini-4-argon",
      ]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("matches exact and wildcard model patterns", () => {
    const model: CandidateModel = {
      provider: "amazon-bedrock",
      id: "us.anthropic.claude-sonnet-4-5-v1:0",
    };
    assert.equal(matchesPattern("*claude-sonnet-4-5*", model), true);
    assert.equal(matchesPattern("amazon-bedrock/*sonnet*", model), true);
    assert.equal(matchesPattern("openai/*sonnet*", model), false);
    assert.equal(
      matchesPattern("us.anthropic.claude-sonnet-4-5-v1:0", model),
      true,
    );
  });

  it("reads agent frontmatter with project -> user precedence", () => {
    const tmp = mkdtempSync(join(tmpdir(), "router-fm-"));
    try {
      const agentDir = join(tmp, "agent");
      const projectDir = join(tmp, "project");
      mkdirSync(join(agentDir, "agents"), { recursive: true });
      mkdirSync(join(projectDir, ".pi", "agents"), { recursive: true });

      writeFileSync(
        join(agentDir, "agents", "scout.md"),
        "---\nname: scout\ntier: fast\n---\nGlobal scout\n",
      );
      writeFileSync(
        join(projectDir, ".pi", "agents", "scout.md"),
        "---\nname: scout\ntier: deep\nthinking: high\n---\nProject scout\n",
      );

      const projectFm = readAgentFrontmatter("scout", projectDir, agentDir);
      assert.equal(projectFm?.tier, "deep");
      assert.equal(projectFm?.thinking, "high");

      const globalFm = readAgentFrontmatter(
        "scout",
        join(tmp, "other"),
        agentDir,
      );
      assert.equal(globalFm?.tier, "fast");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("selects model preferring active provider then fallback patterns and cost heuristic", () => {
    const config = loadRouterConfig();
    const available: CandidateModel[] = [
      { provider: "antigravity", id: "gemini-3.8-flash", reasoning: true },
      { provider: "antigravity", id: "gemini-4-argon", reasoning: true },
      { provider: "antigravity", id: "gemini-4-hydrogen", reasoning: true },
    ];

    const fast = selectModelForTier(
      "fast",
      config.tiers.fast,
      available,
      "antigravity",
      config,
    );
    assert.equal(fast?.id, "gemini-3.8-flash");

    const deep = selectModelForTier(
      "deep",
      config.tiers.deep,
      available,
      "antigravity",
      config,
    );
    assert.equal(deep?.id, "gemini-4-hydrogen");
  });

  it("clamps thinking level to model capabilities and resolves routing", () => {
    const nonReasoning: CandidateModel = {
      provider: "custom",
      id: "basic-chat",
      reasoning: false,
    };
    assert.equal(clampModelThinking(nonReasoning, "high"), "off");

    const config = mergeRouterConfigs(loadRouterConfig(), {
      agentTiers: { customAgent: "fast" },
    });
    const available: CandidateModel[] = [
      { provider: "antigravity", id: "gemini-3.8-flash", reasoning: true },
    ];

    const routed = resolveSubagentRouting(
      { agent: "customAgent" },
      {
        cwd: "/tmp/nonexistent-router-cwd",
        model: { provider: "antigravity", id: "gemini-4-argon" },
        modelRegistry: {
          getAvailable: () => available,
        },
      },
      config,
    );

    assert.equal(routed.tier, "fast");
    assert.equal(routed.model, "antigravity/gemini-3.8-flash");
    assert.equal(routed.thinking, "low");
  });
});
