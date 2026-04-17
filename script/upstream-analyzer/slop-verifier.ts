import { generateStructured } from "./ai-client"
import { getCommitDiff } from "./git-inspector"
import { slopVerifyResultSchema } from "./schemas"
import { CLASSIFIER_TOOLS } from "./tools"
import type { ChainEntry } from "./providers"
import type {
  CommitClassification,
  CommitVerdict,
  SlopVerification,
  SlopVerifyVerdict,
} from "./types"

const MAX_OUTPUT_TOKENS = 768
const DEFAULT_DIFF_BUDGET = 12000

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

function applyVerdict(result: SlopVerifyVerdict): CommitVerdict {
  if (result === "CONFIRMED_SLOP") return "SLOP"
  if (result === "DEMOTE_TO_GOOD") return "GOOD"
  return "NEEDS_REVIEW"
}

function fallbackVerification(
  classification: CommitClassification,
  reason: string,
): SlopVerification {
  return {
    sha: classification.sha,
    originalVerdict: classification.verdict,
    finalVerdict: classification.verdict,
    verifyResult: "CONFIRMED_SLOP",
    reasoning: `Verification failed, keeping original verdict: ${reason}`,
    behaviorDelta: "none",
  }
}

export interface VerifyBatchOptions {
  classifications: CommitClassification[]
  systemPrompt: string
  chain: ChainEntry[]
  onProgress?: (index: number, total: number, verification: SlopVerification) => void
  onProviderFallback?: (args: { failed: ChainEntry; next: ChainEntry; reason: string }) => void
}

async function verifyOne(
  classification: CommitClassification,
  systemPrompt: string,
  chain: ChainEntry[],
  onProviderFallback?: VerifyBatchOptions["onProviderFallback"],
): Promise<SlopVerification> {
  const diff = await getCommitDiff(classification.sha, DEFAULT_DIFF_BUDGET)

  try {
    const result = await generateStructured({
      chain,
      schema: slopVerifyResultSchema,
      schemaName: "SlopVerifyResult",
      schemaDescription: "Deeper second-pass review of a SLOP-classified commit",
      systemPrompt,
      userPrompt: buildUserPrompt(classification, diff),
      tools: CLASSIFIER_TOOLS,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      temperature: 0.2,
      onProviderFallback,
    })

    return {
      sha: classification.sha,
      originalVerdict: classification.verdict,
      finalVerdict: applyVerdict(result.object.verdict),
      verifyResult: result.object.verdict,
      reasoning: result.object.reasoning,
      behaviorDelta: result.object.behavior_delta,
    }
  } catch (cause) {
    return fallbackVerification(classification, (cause as Error).message)
  }
}

export async function verifySlopCommits(
  options: VerifyBatchOptions,
): Promise<SlopVerification[]> {
  const candidates = options.classifications.filter((c) => c.verdict === "SLOP")
  const results: SlopVerification[] = []
  for (let i = 0; i < candidates.length; i++) {
    const verification = await verifyOne(
      candidates[i],
      options.systemPrompt,
      options.chain,
      options.onProviderFallback,
    )
    results.push(verification)
    options.onProgress?.(i + 1, candidates.length, verification)
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
