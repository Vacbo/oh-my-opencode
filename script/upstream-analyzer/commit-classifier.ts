import { generateStructured } from "./ai-client"
import { getCommitDiff } from "./git-inspector"
import { commitVerdictSchema } from "./schemas"
import { CLASSIFIER_TOOLS } from "./tools"
import type { ChainEntry } from "./providers"
import type {
  CommitClassification,
  CommitMeta,
  CommitVerdict,
} from "./types"

const MAX_OUTPUT_TOKENS = 768
const DEFAULT_DIFF_BUDGET = 16000
const MAX_PRIOR_CONTEXT = 8

export interface PriorVerdictSummary {
  shortSha: string
  subject: string
  verdict: CommitVerdict
  reason: string
}

export interface ClassifyBatchOptions {
  commits: CommitMeta[]
  systemPrompt: string
  chain: ChainEntry[]
  onProgress?: (index: number, total: number, classification: CommitClassification) => void
  onProviderFallback?: (args: { failed: ChainEntry; next: ChainEntry; reason: string }) => void
}

function renderPriorContext(prior: PriorVerdictSummary[]): string {
  if (prior.length === 0) return ""
  const trimmed = prior.slice(-MAX_PRIOR_CONTEXT)
  const lines = trimmed.map(
    (entry) => `- ${entry.shortSha} [${entry.verdict}] ${entry.subject} :: ${entry.reason}`,
  )
  return [
    "",
    "## Recent classifications in this release (for cross-commit awareness)",
    "",
    ...lines,
    "",
    "Use this context only to spot patterns (e.g., 'this is part of a pointless rename spree').",
    "Do NOT copy a neighbor's verdict mechanically; judge each commit on its own merits.",
  ].join("\n")
}

function buildUserPrompt(commit: CommitMeta, diff: string, prior: PriorVerdictSummary[]): string {
  return [
    `Commit: ${commit.shortSha}`,
    `Author: ${commit.author}`,
    `Date: ${commit.date}`,
    `Subject: ${commit.subject}`,
    "",
    "Full diff:",
    diff,
    renderPriorContext(prior),
  ].join("\n")
}

function fallbackClassification(commit: CommitMeta, reason: string): CommitClassification {
  return {
    sha: commit.sha,
    shortSha: commit.shortSha,
    subject: commit.subject,
    verdict: "NEEDS_REVIEW",
    confidence: "low",
    reason: `Classification failed: ${reason}`,
    slopSignals: [],
  }
}

async function classifyOne(
  commit: CommitMeta,
  systemPrompt: string,
  chain: ChainEntry[],
  prior: PriorVerdictSummary[],
  onProviderFallback?: ClassifyBatchOptions["onProviderFallback"],
): Promise<CommitClassification> {
  const diff = await getCommitDiff(commit.sha, DEFAULT_DIFF_BUDGET)

  try {
    const result = await generateStructured({
      chain,
      schema: commitVerdictSchema,
      schemaName: "CommitVerdict",
      schemaDescription: "Structured verdict for a single upstream commit",
      systemPrompt,
      userPrompt: buildUserPrompt(commit, diff, prior),
      tools: CLASSIFIER_TOOLS,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      temperature: 0.1,
      onProviderFallback,
    })

    return {
      sha: commit.sha,
      shortSha: commit.shortSha,
      subject: commit.subject,
      verdict: result.object.verdict,
      confidence: result.object.confidence,
      reason: result.object.reason,
      slopSignals: result.object.slop_signals,
    }
  } catch (cause) {
    return fallbackClassification(commit, (cause as Error).message)
  }
}

export async function classifyCommitsSequentially(
  options: ClassifyBatchOptions,
): Promise<CommitClassification[]> {
  const results: CommitClassification[] = []
  const priorSummaries: PriorVerdictSummary[] = []

  for (let i = 0; i < options.commits.length; i++) {
    const commit = options.commits[i]
    const classification = await classifyOne(
      commit,
      options.systemPrompt,
      options.chain,
      priorSummaries,
      options.onProviderFallback,
    )
    results.push(classification)
    priorSummaries.push({
      shortSha: classification.shortSha,
      subject: classification.subject,
      verdict: classification.verdict,
      reason: classification.reason,
    })
    options.onProgress?.(i + 1, options.commits.length, classification)
  }

  return results
}
