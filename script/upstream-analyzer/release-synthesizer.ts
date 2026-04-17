import { getReleaseDiffStat, getDependencyChanges } from "./git-inspector"
import { inferJson } from "./github-models-client"
import type {
  CommitClassification,
  SynthesisRecommendation,
  SynthesisResult,
} from "./types"

const MAX_TOKENS_OUT = 1024
const MAX_DEP_DIFF_CHARS = 6000

interface SynthesisInput {
  fromTag: string
  toTag: string
  upstreamRepo: string
  classifications: CommitClassification[]
  model: string
  systemPrompt: string
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}\n...[truncated]`
}

function computeSlopRatio(classifications: CommitClassification[]): number {
  if (classifications.length === 0) return 0
  const slopCount = classifications.filter((c) => c.verdict === "SLOP").length
  return Math.round((slopCount / classifications.length) * 100)
}

function buildCommitSummary(classifications: CommitClassification[]): string {
  return classifications
    .map((c) => `- [${c.verdict}] ${c.shortSha} ${c.subject} :: ${c.reason}`)
    .join("\n")
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

function normalizeRecommendation(raw: unknown): SynthesisRecommendation {
  if (
    raw === "MERGE_CLEAN" ||
    raw === "CHERRY_PICK" ||
    raw === "SKIP" ||
    raw === "HOLD_FOR_HUMAN"
  ) {
    return raw
  }
  return "HOLD_FOR_HUMAN"
}

function normalizeSeverity(raw: unknown): "high" | "medium" | "low" {
  if (raw === "high" || raw === "medium" || raw === "low") return raw
  return "low"
}

function normalizeBreakingChanges(raw: unknown): SynthesisResult["breakingChanges"] {
  if (!Array.isArray(raw)) return []
  const result: SynthesisResult["breakingChanges"] = []
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue
    const record = entry as Record<string, unknown>
    const description = typeof record.description === "string" ? record.description : ""
    if (!description) continue
    result.push({ description, severity: normalizeSeverity(record.severity) })
  }
  return result
}

function normalizeStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
}

function fallbackSynthesis(
  classifications: CommitClassification[],
  reason: string,
): SynthesisResult {
  return {
    recommendation: "HOLD_FOR_HUMAN",
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

  let parsed: unknown
  try {
    const result = await inferJson({
      model: input.model,
      systemPrompt: input.systemPrompt,
      userPrompt,
      maxTokens: MAX_TOKENS_OUT,
      temperature: 0.2,
    })
    parsed = result.parsed
  } catch (cause) {
    return fallbackSynthesis(input.classifications, (cause as Error).message)
  }

  if (!parsed || typeof parsed !== "object") {
    return fallbackSynthesis(input.classifications, "Synthesizer returned non-JSON")
  }

  const record = parsed as Record<string, unknown>
  const slopRatio =
    typeof record.slop_ratio_percent === "number"
      ? Math.round(record.slop_ratio_percent)
      : computeSlopRatio(input.classifications)

  return {
    recommendation: normalizeRecommendation(record.recommendation),
    confidence:
      record.confidence === "high" || record.confidence === "medium" || record.confidence === "low"
        ? record.confidence
        : "medium",
    summary:
      typeof record.summary === "string" ? record.summary.trim() : "No summary provided",
    slopRatioPercent: slopRatio,
    breakingChanges: normalizeBreakingChanges(record.breaking_changes),
    dependencyChanges: normalizeStringArray(record.dependency_changes),
    architectureDrift: normalizeStringArray(record.architecture_drift),
    hiddenConcerns: normalizeStringArray(record.hidden_concerns),
    actionItems: normalizeStringArray(record.action_items),
  }
}
