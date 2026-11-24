import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

function getActivePiNodeModules(): string | null {
  try {
    const agentDir =
      process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
    const versionFile = join(agentDir, "install", "current-version");
    if (existsSync(versionFile)) {
      const version = readFileSync(versionFile, "utf8").trim();
      const nm = join(agentDir, "install", "releases", version, "node_modules");
      if (existsSync(nm)) return nm;
    }
  } catch {
    // Ignore error
  }
  return null;
}

let clampThinkingLevel: (
  model: Model<any> | undefined,
  level: ModelThinkingLevel,
) => ModelThinkingLevel;
let getSupportedThinkingLevels: (
  model: Model<any>,
) => readonly ModelThinkingLevel[];

try {
  const piAi = await import("@earendil-works/pi-ai");
  clampThinkingLevel = piAi.clampThinkingLevel;
  getSupportedThinkingLevels = piAi.getSupportedThinkingLevels;
} catch {
  const piModules = getActivePiNodeModules();
  if (!piModules) {
    throw new Error(
      "Unable to resolve '@earendil-works/pi-ai': run inside Pi or ensure an active Pi release is installed",
    );
  }
  const piAiUrl = pathToFileURL(
    join(piModules, "@earendil-works", "pi-ai", "dist", "index.js"),
  ).href;
  const piAi = await import(piAiUrl);
  clampThinkingLevel = piAi.clampThinkingLevel;
  getSupportedThinkingLevels = piAi.getSupportedThinkingLevels;
}

export type ThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export interface TierConfig {
  thinking?: ThinkingLevel;
  providers?: Record<string, string[]>;
  fallbackPatterns?: string[];
}

export interface RouterConfig {
  preferActiveProvider?: boolean;
  providerOrder?: string[];
  defaultTier?: string;
  agentTiers?: Record<string, string>;
  tiers: Record<string, TierConfig>;
}

export interface LoadRouterConfigOptions {
  cwd?: string;
  agentDir?: string;
  bundledConfigPath?: string;
}

export interface AgentFrontmatter {
  name: string;
  tier?: string;
  model?: string;
  thinking?: ThinkingLevel;
}

export interface CandidateModel {
  provider: string;
  id: string;
  reasoning?: boolean;
  thinkingLevelMap?: Model<any>["thinkingLevelMap"];
  cost?: {
    input?: number;
    output?: number;
  };
}

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
export const BUNDLED_CONFIG_PATH = join(
  EXTENSION_DIR,
  "subagent-model-router.json",
);

const THINKING_SET = new Set<ThinkingLevel>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

function isThinkingLevel(value: string | undefined): value is ThinkingLevel {
  return value != null && THINKING_SET.has(value as ThinkingLevel);
}

export function getAgentConfigDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function getFrontmatterField(
  frontmatter: string,
  key: string,
): string | undefined {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return match ? stripQuotes(match[1]) : undefined;
}

export function readAgentFrontmatter(
  agentName: string,
  cwd: string,
  agentDir: string = getAgentConfigDir(),
): AgentFrontmatter | null {
  // Precedence matches pi-herdr-subagents: project -> global -> bundled package
  const candidateDirs = [
    join(cwd, ".pi", "agents"),
    join(agentDir, "agents"),
    join(agentDir, "npm", "node_modules", "pi-herdr-subagents", "agents"),
    join(
      agentDir,
      "git",
      "github.com",
      "0xRichardH",
      "pi-herdr-subagents",
      "agents",
    ),
  ];
  const dirs = [...new Set(candidateDirs.map((d) => resolve(d)))];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    } catch {
      continue;
    }

    // Check direct filename match first, then scan remaining files
    const directFile = `${agentName}.md`;
    const ordered = files.includes(directFile)
      ? [directFile, ...files.filter((f) => f !== directFile)]
      : files;

    for (const file of ordered) {
      try {
        const content = readFileSync(join(dir, file), "utf8");
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!fmMatch) continue;
        const fm = fmMatch[1];
        const fallbackName = file.replace(/\.md$/, "");
        const parsedName = getFrontmatterField(fm, "name") ?? fallbackName;
        if (parsedName !== agentName) continue;

        const thinkingRaw = getFrontmatterField(fm, "thinking");
        return {
          name: parsedName,
          tier: getFrontmatterField(fm, "tier"),
          model: getFrontmatterField(fm, "model"),
          thinking: isThinkingLevel(thinkingRaw) ? thinkingRaw : undefined,
        };
      } catch {
        continue;
      }
    }
  }

  return null;
}

export function getRouterConfigPaths(
  cwd?: string,
  agentDir: string = getAgentConfigDir(),
  bundledConfigPath: string = BUNDLED_CONFIG_PATH,
): {
  bundled: string;
  user: string;
  project?: string;
} {
  return {
    bundled: bundledConfigPath,
    user: join(agentDir, "subagent-model-router.json"),
    project: cwd ? join(cwd, ".pi", "subagent-model-router.json") : undefined,
  };
}

export function mergeRouterConfigs(
  base: RouterConfig,
  override: Partial<RouterConfig>,
): RouterConfig {
  const tiers: Record<string, TierConfig> = {};
  const tierNames = new Set([
    ...Object.keys(base.tiers ?? {}),
    ...Object.keys(override.tiers ?? {}),
  ]);

  for (const name of tierNames) {
    const baseTier = base.tiers?.[name];
    const overrideTier = override.tiers?.[name];
    if (baseTier && overrideTier) {
      tiers[name] = {
        thinking: overrideTier.thinking ?? baseTier.thinking,
        providers:
          baseTier.providers || overrideTier.providers
            ? {
                ...(baseTier.providers ?? {}),
                ...(overrideTier.providers ?? {}),
              }
            : undefined,
        fallbackPatterns:
          overrideTier.fallbackPatterns !== undefined
            ? [...overrideTier.fallbackPatterns]
            : baseTier.fallbackPatterns
              ? [...baseTier.fallbackPatterns]
              : undefined,
      };
    } else if (overrideTier) {
      tiers[name] = {
        thinking: overrideTier.thinking,
        providers: overrideTier.providers
          ? { ...overrideTier.providers }
          : undefined,
        fallbackPatterns: overrideTier.fallbackPatterns
          ? [...overrideTier.fallbackPatterns]
          : undefined,
      };
    } else if (baseTier) {
      tiers[name] = {
        thinking: baseTier.thinking,
        providers: baseTier.providers ? { ...baseTier.providers } : undefined,
        fallbackPatterns: baseTier.fallbackPatterns
          ? [...baseTier.fallbackPatterns]
          : undefined,
      };
    }
  }

  return {
    preferActiveProvider:
      override.preferActiveProvider !== undefined
        ? override.preferActiveProvider
        : base.preferActiveProvider,
    providerOrder:
      override.providerOrder !== undefined
        ? [...override.providerOrder]
        : base.providerOrder
          ? [...base.providerOrder]
          : undefined,
    defaultTier:
      override.defaultTier !== undefined
        ? override.defaultTier
        : base.defaultTier,
    agentTiers:
      base.agentTiers || override.agentTiers
        ? { ...(base.agentTiers ?? {}), ...(override.agentTiers ?? {}) }
        : undefined,
    tiers,
  };
}

/**
 * Load router configuration hierarchically (lowest to highest precedence):
 * 1. Bundled defaults (<packageDir>/subagent-model-router.json)
 * 2. User global overrides (<agentDir>/subagent-model-router.json)
 * 3. Project local overrides (<cwd>/.pi/subagent-model-router.json)
 */
export function loadRouterConfig(
  cwdOrOptions?: string | LoadRouterConfigOptions,
  options?: LoadRouterConfigOptions,
): RouterConfig {
  const opts: LoadRouterConfigOptions =
    typeof cwdOrOptions === "string"
      ? { ...options, cwd: cwdOrOptions }
      : (cwdOrOptions ?? options ?? {});

  const paths = getRouterConfigPaths(
    opts.cwd,
    opts.agentDir,
    opts.bundledConfigPath,
  );
  const candidates = [paths.bundled, paths.user, paths.project].filter(
    (p): p is string => Boolean(p),
  );
  const uniquePaths = [...new Set(candidates.map((p) => resolve(p)))];

  let merged: RouterConfig = { tiers: {} };
  let loadedCount = 0;

  for (const configPath of uniquePaths) {
    if (!existsSync(configPath)) continue;
    const raw = readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<RouterConfig>;
    merged = mergeRouterConfigs(merged, parsed);
    loadedCount++;
  }

  if (loadedCount === 0) {
    throw new Error(
      `No subagent-model-router configuration found in: ${uniquePaths.join(", ")}`,
    );
  }

  return merged;
}

/** Match an ID or "provider/id" against an exact string or "*" wildcard pattern (case-insensitive). */
export function matchesPattern(
  pattern: string,
  model: CandidateModel,
): boolean {
  const clean = pattern.trim().toLowerCase();
  if (!clean) return false;
  const target = clean.includes("/")
    ? `${model.provider}/${model.id}`.toLowerCase()
    : model.id.toLowerCase();

  if (!clean.includes("*")) {
    return target === clean;
  }

  const escaped = clean
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`, "i").test(target);
}

function asPiModel(model: CandidateModel): Model<any> {
  return {
    provider: model.provider,
    id: model.id,
    name: model.id,
    api: "openai-completions",
    baseUrl: "",
    reasoning: model.reasoning ?? false,
    thinkingLevelMap: model.thinkingLevelMap,
    input: ["text"],
    contextWindow: 0,
    maxTokens: 0,
    cost: {
      input: model.cost?.input ?? 0,
      output: model.cost?.output ?? 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
  };
}

export function clampModelThinking(
  model: CandidateModel | undefined,
  desired: ThinkingLevel | undefined,
): ThinkingLevel | undefined {
  if (!desired) return undefined;
  if (!model) return desired;
  const piModel = asPiModel(model);
  const clamped = clampThinkingLevel(
    piModel,
    desired as ModelThinkingLevel,
  ) as ThinkingLevel;
  const supported = getSupportedThinkingLevels(piModel);
  if (
    supported.length > 0 &&
    !supported.includes(clamped as ModelThinkingLevel)
  ) {
    return supported[0] as ThinkingLevel;
  }
  return clamped;
}

function getAuthenticatedModels(ctx: {
  scopedModels?: ReadonlyArray<{ model: CandidateModel }>;
  modelRegistry: {
    find?: (provider: string, modelId: string) => any;
    getAvailable?: () => any[];
    getAll?: () => any[];
    hasConfiguredAuth?: (model: any) => boolean;
  };
}): CandidateModel[] {
  if (ctx.scopedModels && ctx.scopedModels.length > 0) {
    return ctx.scopedModels.map((entry) => entry.model);
  }
  const direct = ctx.modelRegistry.getAvailable?.() ?? [];
  const source =
    direct.length > 0 ? direct : (ctx.modelRegistry.getAll?.() ?? []);
  const result: CandidateModel[] = [];
  const seen = new Set<string>();

  for (const m of source) {
    if (!m || typeof m.provider !== "string" || typeof m.id !== "string")
      continue;
    if (ctx.modelRegistry.hasConfiguredAuth) {
      const original = ctx.modelRegistry.find
        ? (ctx.modelRegistry.find(m.provider, m.id) ?? m)
        : m;
      if (!ctx.modelRegistry.hasConfiguredAuth(original)) continue;
    }
    const ref = `${m.provider}/${m.id}`;
    if (seen.has(ref)) continue;
    seen.add(ref);
    result.push(m);
  }

  return result;
}

function buildProviderPools(
  available: CandidateModel[],
  activeProvider: string | undefined,
  config: RouterConfig,
): Array<{ provider: string; models: CandidateModel[] }> {
  const byProvider = new Map<string, CandidateModel[]>();
  for (const model of available) {
    const list = byProvider.get(model.provider) ?? [];
    list.push(model);
    byProvider.set(model.provider, list);
  }

  const orderedProviders: string[] = [];
  const addProvider = (p: string | undefined) => {
    if (p && byProvider.has(p) && !orderedProviders.includes(p)) {
      orderedProviders.push(p);
    }
  };

  if (config.preferActiveProvider !== false) {
    addProvider(activeProvider);
  }
  for (const p of config.providerOrder ?? []) {
    addProvider(p);
  }
  for (const p of byProvider.keys()) {
    addProvider(p);
  }

  return orderedProviders.map((provider) => ({
    provider,
    models: byProvider.get(provider)!,
  }));
}

function selectByCostHeuristic(
  tierName: string,
  pool: CandidateModel[],
): CandidateModel | undefined {
  // simplification: heuristic uses input token price to rank fast/balanced/deep for unconfigured providers; add explicit provider entries in subagent-model-router.json for custom catalogs.
  const withCost = pool.filter(
    (m) => typeof m.cost?.input === "number" && m.cost.input > 0,
  );
  if (withCost.length < 2) return undefined;

  const sorted = [...withCost].sort(
    (a, b) => (a.cost?.input ?? 0) - (b.cost?.input ?? 0),
  );
  if (tierName === "fast") return sorted[0];
  if (tierName === "deep") {
    const reasoning = [...sorted].reverse().find((m) => m.reasoning);
    return reasoning ?? sorted[sorted.length - 1];
  }
  return sorted[Math.floor(sorted.length / 2)];
}

export function selectModelForTier(
  tierName: string,
  tierConfig: TierConfig,
  available: CandidateModel[],
  activeProvider: string | undefined,
  config: RouterConfig,
): CandidateModel | undefined {
  if (available.length === 0) return undefined;
  const pools = buildProviderPools(available, activeProvider, config);

  // Pass 1: explicit per-provider model lists in provider priority order
  for (const { provider, models } of pools) {
    const patterns = tierConfig.providers?.[provider];
    if (!patterns || patterns.length === 0) continue;
    for (const pattern of patterns) {
      const match = models.find((m) => matchesPattern(pattern, m));
      if (match) return match;
    }
  }

  // Pass 2: provider-agnostic fallbackPatterns + cost heuristic per provider pool
  for (const { models } of pools) {
    for (const pattern of tierConfig.fallbackPatterns ?? []) {
      const match = models.find((m) => matchesPattern(pattern, m));
      if (match) return match;
    }
    const heuristic = selectByCostHeuristic(tierName, models);
    if (heuristic) return heuristic;
  }

  return undefined;
}

export function resolveSubagentRouting(
  input: { agent?: string; model?: string; thinking?: string },
  ctx: {
    cwd: string;
    model?: { provider: string; id: string };
    scopedModels?: ReadonlyArray<{ model: CandidateModel }>;
    modelRegistry: {
      find?: (provider: string, modelId: string) => any;
      getAvailable?: () => any[];
      getAll?: () => any[];
      hasConfiguredAuth?: (model: any) => boolean;
    };
  },
  configOverride?: RouterConfig,
): { tier?: string; model?: string; thinking?: ThinkingLevel } {
  if (!input.agent) return {};

  let config: RouterConfig;
  try {
    config = configOverride ?? loadRouterConfig(ctx.cwd);
  } catch {
    return {};
  }

  const frontmatter = readAgentFrontmatter(input.agent, ctx.cwd);
  const tierName =
    frontmatter?.tier ?? config.agentTiers?.[input.agent] ?? config.defaultTier;
  const tierConfig = tierName ? config.tiers?.[tierName] : undefined;

  const available = getAuthenticatedModels(ctx);
  let targetModel: CandidateModel | undefined;
  let resolvedModelRef: string | undefined;

  // Respect explicit tool argument or explicit model in agent frontmatter
  const explicitModelRef = input.model || frontmatter?.model;
  if (explicitModelRef) {
    const slash = explicitModelRef.indexOf("/");
    if (slash > 0) {
      const p = explicitModelRef.slice(0, slash);
      const id = explicitModelRef.slice(slash + 1);
      targetModel =
        available.find((m) => m.provider === p && m.id === id) ??
        ctx.modelRegistry.find?.(p, id);
    }
  } else if (tierName && tierConfig) {
    targetModel = selectModelForTier(
      tierName,
      tierConfig,
      available,
      ctx.model?.provider,
      config,
    );
    if (targetModel) {
      resolvedModelRef = `${targetModel.provider}/${targetModel.id}`;
    }
  }

  if (!targetModel && ctx.model) {
    targetModel =
      available.find(
        (m) => m.provider === ctx.model!.provider && m.id === ctx.model!.id,
      ) ?? ctx.modelRegistry.find?.(ctx.model.provider, ctx.model.id);
  }

  let resolvedThinking: ThinkingLevel | undefined;
  if (!input.thinking) {
    const desiredThinking = frontmatter?.thinking ?? tierConfig?.thinking;
    resolvedThinking = clampModelThinking(targetModel, desiredThinking);
  }

  return {
    tier: tierName,
    model: resolvedModelRef,
    thinking: resolvedThinking,
  };
}

export default function activate(pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "subagent") return;

    const input = event.input as {
      agent?: string;
      model?: string;
      thinking?: string;
    };
    if (!input.agent) return;

    const resolved = resolveSubagentRouting(input, ctx);
    if (!input.model && resolved.model) {
      input.model = resolved.model;
    }
    if (!input.thinking && resolved.thinking) {
      input.thinking = resolved.thinking;
    }
  });

  pi.registerCommand("subagent-models", {
    description:
      "Show resolved model and thinking level per subagent for the active provider",
    handler: async (_args, ctx) => {
      const config = loadRouterConfig(ctx.cwd);
      const agents = Object.keys(
        config.agentTiers ?? {
          scout: "fast",
          worker: "balanced",
          "visual-tester": "balanced",
          planner: "deep",
          reviewer: "deep",
        },
      );
      const lines = agents.map((agent) => {
        const res = resolveSubagentRouting(
          { agent },
          ctx as unknown as ExtensionContext,
          config,
        );
        return `${agent} [${res.tier ?? "unmapped"}] -> model: ${res.model ?? "(inherit parent)"}, thinking: ${res.thinking ?? "(inherit parent)"}`;
      });
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
