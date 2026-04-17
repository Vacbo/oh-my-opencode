import { availableProviders, parseChainSpec, PROVIDERS, type ChainEntry } from "./providers"
import type { AnalyzerConfig } from "./types"

const DEFAULT_CLASSIFY_CHAIN =
  "github:openai/gpt-4.1-mini,openrouter:qwen/qwen3-coder:free,nvidia:nvidia/llama-3.3-nemotron-super-49b-v1"

const DEFAULT_SLOP_VERIFY_CHAIN =
  "nvidia:nvidia/llama-3.3-nemotron-super-49b-v1,openrouter:nvidia/nemotron-3-super-120b-a12b:free,github:openai/gpt-4.1"

const DEFAULT_SYNTHESIS_CHAIN =
  "openrouter:qwen/qwen3-next-80b-a3b-instruct:free,nvidia:nvidia/llama-3.3-nemotron-super-49b-v1,github:openai/gpt-4.1"

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Required env var ${name} is not set`)
  }
  return value
}

function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name]
  return value && value.length > 0 ? value : fallback
}

function parseRepoSlug(slug: string): { owner: string; name: string } {
  const [owner, name] = slug.split("/")
  if (!owner || !name) {
    throw new Error(`Invalid repo slug: ${slug} (expected owner/name)`)
  }
  return { owner, name }
}

function filterAvailable(chain: ChainEntry[]): ChainEntry[] {
  const usable = new Set(availableProviders())
  return chain.filter((entry) => usable.has(entry.provider))
}

function resolveChain(envVar: string, defaultSpec: string, label: string): ChainEntry[] {
  const spec = optionalEnv(envVar, defaultSpec)
  const parsed = parseChainSpec(spec)
  const usable = filterAvailable(parsed)
  if (usable.length === 0) {
    const missing = parsed
      .map((entry) => PROVIDERS[entry.provider].envVar)
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(", ")
    throw new Error(
      `No usable providers for ${label} chain. Set at least one of: ${missing}. ` +
        `Chain spec: ${spec}`,
    )
  }
  return usable
}

export function loadConfigFromEnv(): AnalyzerConfig {
  const upstreamRepo = requireEnv("UPSTREAM_REPO")
  const fromTag = requireEnv("FROM_TAG")
  const toTag = requireEnv("TO_TAG")
  const githubRepository = requireEnv("GITHUB_REPOSITORY")
  const { owner, name } = parseRepoSlug(githubRepository)

  return {
    upstreamRepo,
    fromTag,
    toTag,
    classifyChain: resolveChain("CLASSIFY_CHAIN", DEFAULT_CLASSIFY_CHAIN, "classify"),
    slopVerifyChain: resolveChain("SLOP_VERIFY_CHAIN", DEFAULT_SLOP_VERIFY_CHAIN, "slop-verify"),
    synthesisChain: resolveChain("SYNTHESIS_CHAIN", DEFAULT_SYNTHESIS_CHAIN, "synthesis"),
    repoOwner: owner,
    repoName: name,
    outputDir: optionalEnv("OUTPUT_DIR", ".analyzer-output"),
  }
}

export function shouldPushBranches(): boolean {
  const value = (process.env.PUSH_BRANCHES ?? "false").toLowerCase()
  return value === "true" || value === "1" || value === "yes"
}
