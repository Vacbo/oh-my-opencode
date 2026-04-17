import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { buildAllBatches, pushBatches } from "./batch-builder"
import type { BatchResult } from "./batch-builder"
import { applyVerificationsToClassifications, verifySlopCommits } from "./slop-verifier"
import { classifyCommitsSequentially } from "./commit-classifier"
import {
  ensureUpstreamRemote,
  listCommitsInRange,
  resetWorkingTree,
  tagExists,
} from "./git-inspector"
import { loadAllPrompts } from "./prompt-loader"
import { synthesizeRelease } from "./release-synthesizer"
import type {
  AnalyzerConfig,
  CommitClassification,
  PipelineOutput,
  SlopVerification,
  SynthesisResult,
} from "./types"

async function writeArtifact(outputDir: string, name: string, data: unknown): Promise<void> {
  await mkdir(outputDir, { recursive: true })
  const path = join(outputDir, name)
  await writeFile(path, JSON.stringify(data, null, 2), "utf8")
}

function logProgress(step: string, detail: string): void {
  console.log(`[analyzer] ${step}: ${detail}`)
}

async function prepareUpstreamRange(config: AnalyzerConfig): Promise<void> {
  logProgress("setup", `fetching ${config.upstreamRepo}`)
  await ensureUpstreamRemote(config.upstreamRepo)
  for (const tag of [config.fromTag, config.toTag]) {
    if (!(await tagExists(tag))) {
      throw new Error(`Tag ${tag} not found after fetching upstream`)
    }
  }
}

function describeChain(chain: AnalyzerConfig["classifyChain"]): string {
  return chain.map((entry) => `${entry.provider}:${entry.modelId}`).join(" -> ")
}

function handleProviderFallback(step: string) {
  return ({ failed, next, reason }: { failed: { provider: string; modelId: string }; next: { provider: string; modelId: string }; reason: string }) => {
    logProgress(
      `${step}/fallback`,
      `${failed.provider}:${failed.modelId} failed (${reason.slice(0, 140)}); trying ${next.provider}:${next.modelId}`,
    )
  }
}

async function runPass1Classify(
  config: AnalyzerConfig,
  systemPrompt: string,
): Promise<CommitClassification[]> {
  const commits = await listCommitsInRange(config.fromTag, config.toTag)
  logProgress("pass1", `classifying ${commits.length} commits (chain: ${describeChain(config.classifyChain)})`)
  if (commits.length === 0) {
    logProgress("pass1", "no commits in range, nothing to do")
    return []
  }
  return classifyCommitsSequentially({
    commits,
    systemPrompt,
    chain: config.classifyChain,
    onProgress: (i, n, classification) => {
      logProgress("pass1", `${i}/${n} ${classification.shortSha} => ${classification.verdict}`)
    },
    onProviderFallback: handleProviderFallback("pass1"),
  })
}

async function runPass2Verify(
  config: AnalyzerConfig,
  classifications: CommitClassification[],
  systemPrompt: string,
): Promise<{ verifications: SlopVerification[]; final: CommitClassification[] }> {
  const slopCount = classifications.filter((c) => c.verdict === "SLOP").length
  if (slopCount === 0) {
    logProgress("pass2", "no SLOP candidates, skipping slop verifier")
    return { verifications: [], final: classifications }
  }
  logProgress("pass2", `verifying ${slopCount} SLOP candidates (chain: ${describeChain(config.slopVerifyChain)})`)
  const verifications = await verifySlopCommits({
    classifications,
    systemPrompt,
    chain: config.slopVerifyChain,
    onProgress: (i, n, verification) => {
      logProgress("pass2", `${i}/${n} ${verification.sha.slice(0, 7)} => ${verification.verifyResult}`)
    },
    onProviderFallback: handleProviderFallback("pass2"),
  })
  const final = applyVerificationsToClassifications(classifications, verifications)
  return { verifications, final }
}

async function runPass3Synthesize(
  config: AnalyzerConfig,
  classifications: CommitClassification[],
  systemPrompt: string,
): Promise<SynthesisResult> {
  logProgress("pass3", `synthesizing release verdict (chain: ${describeChain(config.synthesisChain)})`)
  return synthesizeRelease({
    fromTag: config.fromTag,
    toTag: config.toTag,
    upstreamRepo: config.upstreamRepo,
    classifications,
    chain: config.synthesisChain,
    systemPrompt,
    onProviderFallback: handleProviderFallback("pass3"),
  })
}

async function runBatchBuilding(
  config: AnalyzerConfig,
  classifications: CommitClassification[],
): Promise<BatchResult[]> {
  logProgress("batches", "resetting working tree before checkout")
  await resetWorkingTree()
  logProgress("batches", "building good / review / slop branches")
  const results = await buildAllBatches({
    fromTag: config.fromTag,
    toTag: config.toTag,
    classifications,
    branchPrefix: "sync/upstream",
  })
  for (const result of results) {
    if (result.skipped) {
      logProgress("batches", `${result.batch}: skipped (no commits)`)
      continue
    }
    logProgress(
      "batches",
      `${result.batch}: ${result.appliedCommits.length} applied / ${result.conflictCommits.length} conflicts on ${result.branchName}`,
    )
  }
  return results
}

async function pushIfRequested(results: BatchResult[], shouldPush: boolean): Promise<void> {
  if (!shouldPush) {
    logProgress("push", "skipping push (dry run or pushBranches=false)")
    return
  }
  logProgress("push", "pushing batch branches")
  await pushBatches(results)
}

export interface PipelineRunOptions {
  config: AnalyzerConfig
  pushBranches: boolean
}

export interface PipelineResult extends PipelineOutput {
  batches: BatchResult[]
  pushAttempted: boolean
}

export async function runPipeline(options: PipelineRunOptions): Promise<PipelineResult> {
  const { outputDir } = options.config
  const prompts = await loadAllPrompts()
  await prepareUpstreamRange(options.config)

  // Persist after every pass so partial progress survives any downstream
  // failure. The CI workflow uploads outputDir unconditionally, so even a
  // pipeline crash produces useful post-mortem artifacts.
  const initialClassifications = await runPass1Classify(options.config, prompts.commitClassify)
  await writeArtifact(outputDir, "classifications.initial.json", initialClassifications)

  const { verifications, final } = await runPass2Verify(
    options.config,
    initialClassifications,
    prompts.slopVerify,
  )
  await writeArtifact(outputDir, "verifications.json", verifications)
  await writeArtifact(outputDir, "classifications.json", final)

  const synthesis = await runPass3Synthesize(options.config, final, prompts.releaseSynthesis)
  await writeArtifact(outputDir, "synthesis.json", synthesis)

  const batches = await runBatchBuilding(options.config, final)
  await pushIfRequested(batches, options.pushBranches)
  // Write batches.json AFTER pushIfRequested so pushOutcome lands in the
  // persisted artifact. Writing it earlier (as in the prior revision)
  // leaves the on-disk record missing push state.
  await writeArtifact(outputDir, "batches.json", batches)

  const result: PipelineResult = {
    config: options.config,
    commits: final,
    verifications,
    synthesis,
    batches,
    pushAttempted: options.pushBranches,
  }

  await writeArtifact(outputDir, "pipeline-result.json", result)
  return result
}
