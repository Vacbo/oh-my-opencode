import { generateStructured } from "./ai-client"
import { getDependencyChanges, getReleaseDiffStat } from "./git-inspector"
import { releaseSynthesisSchema } from "./schemas"
import type { ChainEntry } from "./providers"
import type {
  CommitClassification,
  SynthesisRecommendation,
  SynthesisResult,
} from "./types"

const MAX_OUTPUT_TOKENS = 1536
const MAX_DEP_DIFF_CHARS = 4000
const MAX_COMMIT_SUMMARY_CHARS = 12000

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n...[truncated]`
}

function computeSlopRatio(classifications: CommitClassification[]): number {
  if (classifications.length === 0) return 0
  const slopCount = classifications.filter((c) => c.verdict === "SLOP").length
  return Math.round((slopCount / classifications.length) * 100)
}

function buildCommitSummary(classifications: CommitClassification[]): string {
  const lines = classifications.map(
    (c) => `- [${c.verdict}] ${c.shortSha} ${c.subject} :: ${c.reason}`,
  )
  return truncate(lines.join("\n"), MAX_COMMIT_SUMMARY_CHARS)
}

export interface SynthesisInput {
  fromTag: string
  toTag: string
  upstreamRepo: string
  classifications: CommitClassification[]
  chain: ChainEntry[]
  systemPrompt: string
  onProviderFallback?: (args: { failed: ChainEntry; next: ChainEntry; reason: string }) => void
}

async function buildUserPrompt(input: SynthesisInput): Promise<string> {
  const diffStat = await getReleaseDiffStat(input.fromTag, input.toTag)
  const depDiff = truncate(
    await getDependencyChanges(input.fromTag, input.toTag),
    MAX_DEP_DIFF_CHARS,
  )

  const counts = {
    good: input.classifications.filter((c) => c.verdict === "GOOD").length,
    review: input.classifications.filter((c) => c.verdict === "NEEDS_REVIEW").length,
    slop: input.classifications.filter((c) => c.verdict === "SLOP").length,
  }

  return [
    `Upstream: ${input.upstreamRepo}`,
    `Release window: ${input.fromTag} -> ${input.toTag}`,
    `Total commits: ${input.classifications.length}`,
    `GOOD: ${counts.good} | NEEDS_REVIEW: ${counts.review} | SLOP: ${counts.slop}`,
    "",
    "Diff stat:",
    diffStat || "(empty)",
    "",
    "Dependency changes (package.json diff):",
    depDiff || "(none)",
    "",
    "Per-commit classifications:",
    buildCommitSummary(input.classifications),
  ].join("\n")
}

function fallbackSynthesis(
  classifications: CommitClassification[],
  reason: string,
): SynthesisResult {
  return {
    recommendation: "HOLD_FOR_HUMAN" satisfies SynthesisRecommendation,
    confidence: "low",
    summary: `Synthesis failed (${reason}). Human review required.`,
    slopRatioPercent: computeSlopRatio(classifications),
    breakingChanges: [],
    dependencyChanges: [],
    architectureDrift: [],
    hiddenConcerns: [],
    actionItems: ["Synthesis pass failed; review classifications manually."],
  }
}

export async function synthesizeRelease(input: SynthesisInput): Promise<SynthesisResult> {
  const userPrompt = await buildUserPrompt(input)

  try {
    const result = await generateStructured({
      chain: input.chain,
      schema: releaseSynthesisSchema,
      schemaName: "ReleaseSynthesis",
      schemaDescription: "Cost-benefit assessment of the upstream release window",
      systemPrompt: input.systemPrompt,
      userPrompt,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      temperature: 0.2,
      onProviderFallback: input.onProviderFallback,
    })

    const raw = result.object
    return {
      recommendation: raw.recommendation,
      confidence: raw.confidence,
      summary: raw.summary,
      slopRatioPercent: Math.round(raw.slop_ratio_percent),
      breakingChanges: raw.breaking_changes,
      dependencyChanges: raw.dependency_changes,
      architectureDrift: raw.architecture_drift,
      hiddenConcerns: raw.hidden_concerns,
      actionItems: raw.action_items,
    }
  } catch (cause) {
    return fallbackSynthesis(input.classifications, (cause as Error).message)
  }
}
