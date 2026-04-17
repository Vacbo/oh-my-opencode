import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { buildAllBatches, pushBatches } from "./batch-builder"
import type { BatchResult } from "./batch-builder"
import { applyVerificationsToClassifications, verifySlopCommits } from "./slop-verifier"
import { classifyCommitsSequentially } from "./commit-classifier"
import { ensureUpstreamRemote, listCommitsInRange, tagExists } from "./git-inspector"
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

async function runPass1Classify(
  config: AnalyzerConfig,
  systemPrompt: string,
): Promise<CommitClassification[]> {
  const commits = await listCommitsInRange(config.fromTag, config.toTag)
  logProgress("pass1", `classifying ${commits.length} commits with ${config.modelClassify}`)
  if (commits.length === 0) {
    logProgress("pass1", "no commits in range, nothing to do")
    return []
  }
  return classifyCommitsSequentially(commits, systemPrompt, config.modelClassify, (i, n, c) => {
    logProgress("pass1", `${i}/${n} ${c.shortSha} => ${c.verdict}`)
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
  const chainDescription = [config.modelSlopVerify, ...config.modelSlopVerifyFallbacks].join(" -> ")
  logProgress("pass2", `verifying ${slopCount} SLOP candidates (chain: ${chainDescription})`)
  const verifications = await verifySlopCommits(classifications, systemPrompt, {
    primary: config.modelSlopVerify,
    fallbacks: config.modelSlopVerifyFallbacks,
  })
  const final = applyVerificationsToClassifications(classifications, verifications)
  return { verifications, final }
}

async function runPass3Synthesize(
  config: AnalyzerConfig,
  classifications: CommitClassification[],
  systemPrompt: string,
): Promise<SynthesisResult> {
  logProgress("pass3", `synthesizing release verdict with ${config.modelSynthesis}`)
  return synthesizeRelease({
    fromTag: config.fromTag,
    toTag: config.toTag,
    upstreamRepo: config.upstreamRepo,
    classifications,
    model: config.modelSynthesis,
    systemPrompt,
  })
}

async function runBatchBuilding(
  config: AnalyzerConfig,
  classifications: CommitClassification[],
): Promise<BatchResult[]> {
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
}

export async function runPipeline(options: PipelineRunOptions): Promise<PipelineResult> {
  const prompts = await loadAllPrompts()
  await prepareUpstreamRange(options.config)

  const initialClassifications = await runPass1Classify(options.config, prompts.commitClassify)
  const { verifications, final } = await runPass2Verify(
    options.config,
    initialClassifications,
    prompts.slopVerify,
  )
  const synthesis = await runPass3Synthesize(options.config, final, prompts.releaseSynthesis)
  const batches = await runBatchBuilding(options.config, final)
  await pushIfRequested(batches, options.pushBranches)

  const result: PipelineResult = {
    config: options.config,
    commits: final,
    verifications,
    synthesis,
    batches,
  }

  await writeArtifact(options.config.outputDir, "classifications.json", final)
  await writeArtifact(options.config.outputDir, "verifications.json", verifications)
  await writeArtifact(options.config.outputDir, "synthesis.json", synthesis)
  await writeArtifact(options.config.outputDir, "batches.json", batches)
  await writeArtifact(options.config.outputDir, "pipeline-result.json", result)

  return result
}
