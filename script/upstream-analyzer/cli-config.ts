import type { AnalyzerConfig } from "./types"

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

function parseModelList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function parseRepoSlug(slug: string): { owner: string; name: string } {
  const [owner, name] = slug.split("/")
  if (!owner || !name) {
    throw new Error(`Invalid repo slug: ${slug} (expected owner/name)`)
  }
  return { owner, name }
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
    modelClassify: optionalEnv("MODEL_CLASSIFY", "openai/gpt-4.1-mini"),
    modelSlopVerify: optionalEnv("MODEL_SLOP_VERIFY", "openai/gpt-5-mini"),
    modelSlopVerifyFallbacks: parseModelList(
      optionalEnv("MODEL_SLOP_VERIFY_FALLBACKS", "openai/gpt-4.1,openai/gpt-4.1-mini"),
    ),
    modelSynthesis: optionalEnv("MODEL_SYNTHESIS", "openai/gpt-4.1"),
    repoOwner: owner,
    repoName: name,
    outputDir: optionalEnv("OUTPUT_DIR", ".analyzer-output"),
  }
}

export function shouldPushBranches(): boolean {
  const value = (process.env.PUSH_BRANCHES ?? "false").toLowerCase()
  return value === "true" || value === "1" || value === "yes"
}
