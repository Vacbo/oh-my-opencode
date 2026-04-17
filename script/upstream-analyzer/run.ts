#!/usr/bin/env bun

import { appendFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { loadConfigFromEnv, shouldPushBranches } from "./cli-config"
import { buildIssueBody, buildIssueLabels, buildIssueTitle, buildBatchPrBody } from "./issue-report"
import { runPipeline } from "./pipeline"
import type { PipelineResult } from "./pipeline"

interface WorkflowArtifacts {
  issueTitle: string
  issueBody: string
  issueLabels: string[]
  batchPrSpecs: Array<{
    batch: string
    branchName: string
    title: string
    body: string
    skipped: boolean
    pushOutcome: string
  }>
}

function buildWorkflowArtifacts(result: PipelineResult): WorkflowArtifacts {
  const issueTitle = buildIssueTitle(result.config, result.synthesis)
  const issueBody = buildIssueBody({
    config: result.config,
    classifications: result.commits,
    verifications: result.verifications,
    synthesis: result.synthesis,
    batches: result.batches,
  })
  const issueLabels = buildIssueLabels(result.synthesis, result.config.toTag)

  const batchPrSpecs = result.batches.map((batch) => {
    const pushFailed =
      batch.pushOutcome !== undefined && batch.pushOutcome !== "ok"
    return {
      batch: batch.batch,
      branchName: batch.branchName,
      title: `[${batch.batch}] Upstream sync ${result.config.fromTag} → ${result.config.toTag}`,
      body: buildBatchPrBody(batch, result.commits, null),
      skipped: batch.skipped || batch.appliedCommits.length === 0 || pushFailed,
      pushOutcome: batch.pushOutcome ?? "not-pushed",
    }
  })

  return { issueTitle, issueBody, issueLabels, batchPrSpecs }
}

async function writeWorkflowArtifacts(outputDir: string, artifacts: WorkflowArtifacts): Promise<void> {
  await writeFile(join(outputDir, "issue-title.txt"), artifacts.issueTitle, "utf8")
  await writeFile(join(outputDir, "issue-body.md"), artifacts.issueBody, "utf8")
  await writeFile(join(outputDir, "issue-labels.json"), JSON.stringify(artifacts.issueLabels), "utf8")
  await writeFile(
    join(outputDir, "batch-pr-specs.json"),
    JSON.stringify(artifacts.batchPrSpecs, null, 2),
    "utf8",
  )
}

async function emitGithubOutputs(artifacts: WorkflowArtifacts): Promise<void> {
  const outputPath = process.env.GITHUB_OUTPUT
  if (!outputPath) return
  const lines: string[] = []
  lines.push(`issue_title<<EOF_TITLE`, artifacts.issueTitle, `EOF_TITLE`)
  lines.push(`issue_labels<<EOF_LABELS`, JSON.stringify(artifacts.issueLabels), `EOF_LABELS`)
  lines.push(`batch_specs<<EOF_SPECS`, JSON.stringify(artifacts.batchPrSpecs), `EOF_SPECS`)
  lines.push(`has_commits=${artifacts.batchPrSpecs.some((s) => !s.skipped) ? "true" : "false"}`)
  await appendFile(outputPath, `${lines.join("\n")}\n`, "utf8")
}

async function main(): Promise<void> {
  const config = loadConfigFromEnv()
  const pushBranches = shouldPushBranches()

  console.log("[analyzer] starting pipeline")
  console.log(`[analyzer] upstream=${config.upstreamRepo} ${config.fromTag} -> ${config.toTag}`)
  const verifyChain = [config.modelSlopVerify, ...config.modelSlopVerifyFallbacks].join(" -> ")
  console.log(
    `[analyzer] models: classify=${config.modelClassify} verify=${verifyChain} synth=${config.modelSynthesis}`,
  )
  console.log(`[analyzer] pushBranches=${pushBranches}`)

  const result = await runPipeline({ config, pushBranches })
  const artifacts = buildWorkflowArtifacts(result)
  await writeWorkflowArtifacts(config.outputDir, artifacts)
  await emitGithubOutputs(artifacts)

  console.log("[analyzer] pipeline complete")
  console.log(`[analyzer] recommendation: ${result.synthesis.recommendation}`)
  console.log(`[analyzer] slop ratio: ${result.synthesis.slopRatioPercent}%`)
}

main().catch((err) => {
  console.error("[analyzer] failed:", err)
  process.exit(1)
})
