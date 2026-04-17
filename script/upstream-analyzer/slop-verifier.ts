import { getCommitDiff } from "./git-inspector"
import { inferJsonWithFallback } from "./github-models-client"
import type {
  CommitClassification,
  CommitVerdict,
  SlopVerification,
  SlopVerifyVerdict,
} from "./types"

const MAX_TOKENS_OUT = 768

// gpt-5-mini caps input at ~4K tokens on Copilot Pro/Student tier, so we keep
// verifier diff payloads much smaller than the pass-1 classifier. The fallback
// chain (gpt-4.1 / gpt-4.1-mini) has higher headroom (8K tokens), so larger
// payloads still fit there if gpt-5-mini quota is exhausted.
const MAX_DIFF_CHARS = 10000

function buildUserPrompt(classification: CommitClassification, diff: string): string {
  return [
    `Commit: ${classification.shortSha}`,
    `Subject: ${classification.subject}`,
    `First-pass verdict: SLOP (confidence: ${classification.confidence})`,
    `First-pass reason: ${classification.reason}`,
    `First-pass slop signals: ${classification.slopSignals.join(", ") || "(none)"}`,
    "",
    "Full diff:",
    diff,
  ].join("\n")
}

function normalizeVerdict(raw: unknown): SlopVerifyVerdict {
  if (raw === "CONFIRMED_SLOP" || raw === "DEMOTE_TO_REVIEW" || raw === "DEMOTE_TO_GOOD") {
    return raw
  }
  return "DEMOTE_TO_REVIEW"
}

function normalizeBehaviorDelta(raw: unknown): "none" | "minor" | "significant" {
  if (raw === "none" || raw === "minor" || raw === "significant") return raw
  return "none"
}

function applyVerdict(result: SlopVerifyVerdict): CommitVerdict {
  if (result === "CONFIRMED_SLOP") return "SLOP"
  if (result === "DEMOTE_TO_GOOD") return "GOOD"
  return "NEEDS_REVIEW"
}

function fallbackVerification(classification: CommitClassification, reason: string): SlopVerification {
  return {
    sha: classification.sha,
    originalVerdict: classification.verdict,
    finalVerdict: classification.verdict,
    verifyResult: "CONFIRMED_SLOP",
    reasoning: `Verification failed, keeping original verdict: ${reason}`,
    behaviorDelta: "none",
  }
}

export interface SlopVerifyModels {
  primary: string
  fallbacks: string[]
}

export async function verifySlopCommit(
  classification: CommitClassification,
  systemPrompt: string,
  models: SlopVerifyModels,
): Promise<SlopVerification> {
  const diff = await getCommitDiff(classification.sha, MAX_DIFF_CHARS)

  let parsed: unknown
  try {
    const result = await inferJsonWithFallback({
      primaryModel: models.primary,
      fallbackModels: models.fallbacks,
      systemPrompt,
      userPrompt: buildUserPrompt(classification, diff),
      maxTokens: MAX_TOKENS_OUT,
      temperature: 0.2,
      onFallback: (failed, next, reason) => {
        console.warn(`[verifier] ${classification.shortSha}: ${failed} failed (${reason}); trying ${next}`)
      },
    })
    parsed = result.parsed
  } catch (cause) {
    return fallbackVerification(classification, (cause as Error).message)
  }

  if (!parsed || typeof parsed !== "object") {
    return fallbackVerification(classification, "Verifier returned non-JSON")
  }

  const record = parsed as Record<string, unknown>
  const verifyResult = normalizeVerdict(record.verdict)
  const reasoning =
    typeof record.reasoning === "string" ? record.reasoning.trim() : "No reasoning provided"

  return {
    sha: classification.sha,
    originalVerdict: classification.verdict,
    finalVerdict: applyVerdict(verifyResult),
    verifyResult,
    reasoning,
    behaviorDelta: normalizeBehaviorDelta(record.behavior_delta),
  }
}

export async function verifySlopCommits(
  classifications: CommitClassification[],
  systemPrompt: string,
  models: SlopVerifyModels,
): Promise<SlopVerification[]> {
  const slopCandidates = classifications.filter((c) => c.verdict === "SLOP")
  const results: SlopVerification[] = []
  for (const candidate of slopCandidates) {
    results.push(await verifySlopCommit(candidate, systemPrompt, models))
  }
  return results
}

export function applyVerificationsToClassifications(
  classifications: CommitClassification[],
  verifications: SlopVerification[],
): CommitClassification[] {
  const byVerifiedSha = new Map(verifications.map((v) => [v.sha, v]))
  return classifications.map((c) => {
    const verified = byVerifiedSha.get(c.sha)
    if (!verified) return c
    return {
      ...c,
      verdict: verified.finalVerdict,
      reason:
        verified.finalVerdict === c.verdict
          ? c.reason
          : `${c.reason} | Verifier: ${verified.reasoning}`,
    }
  })
}
