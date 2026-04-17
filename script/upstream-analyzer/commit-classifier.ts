import { getCommitDiff } from "./git-inspector"
import { inferJson } from "./github-models-client"
import type { CommitClassification, CommitMeta, CommitVerdict } from "./types"

const MAX_TOKENS_OUT = 512

function buildUserPrompt(commit: CommitMeta, diff: string): string {
  return [
    `Commit: ${commit.shortSha}`,
    `Author: ${commit.author}`,
    `Date: ${commit.date}`,
    `Subject: ${commit.subject}`,
    "",
    "Full diff:",
    diff,
  ].join("\n")
}

function normalizeVerdict(raw: unknown): CommitVerdict {
  if (raw === "GOOD" || raw === "NEEDS_REVIEW" || raw === "SLOP") return raw
  return "NEEDS_REVIEW"
}

function normalizeConfidence(raw: unknown): "high" | "medium" | "low" {
  if (raw === "high" || raw === "medium" || raw === "low") return raw
  return "medium"
}

function normalizeReason(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return "Model did not return a reason"
  return raw.trim()
}

function normalizeSlopSignals(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is string => typeof x === "string")
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

export async function classifyCommit(
  commit: CommitMeta,
  systemPrompt: string,
  model: string,
): Promise<CommitClassification> {
  const diff = await getCommitDiff(commit.sha)

  let parsed: unknown
  try {
    const result = await inferJson({
      model,
      systemPrompt,
      userPrompt: buildUserPrompt(commit, diff),
      maxTokens: MAX_TOKENS_OUT,
      temperature: 0.1,
    })
    parsed = result.parsed
  } catch (cause) {
    return fallbackClassification(commit, (cause as Error).message)
  }

  if (!parsed || typeof parsed !== "object") {
    return fallbackClassification(commit, "Model returned non-JSON output")
  }

  const record = parsed as Record<string, unknown>
  return {
    sha: commit.sha,
    shortSha: commit.shortSha,
    subject: commit.subject,
    verdict: normalizeVerdict(record.verdict),
    confidence: normalizeConfidence(record.confidence),
    reason: normalizeReason(record.reason),
    slopSignals: normalizeSlopSignals(record.slop_signals),
  }
}

export async function classifyCommitsSequentially(
  commits: CommitMeta[],
  systemPrompt: string,
  model: string,
  onProgress?: (index: number, total: number, classification: CommitClassification) => void,
): Promise<CommitClassification[]> {
  const results: CommitClassification[] = []
  for (let i = 0; i < commits.length; i++) {
    const classification = await classifyCommit(commits[i], systemPrompt, model)
    results.push(classification)
    onProgress?.(i + 1, commits.length, classification)
  }
  return results
}
