import type { BatchResult } from "./batch-builder"
import type {
  AnalyzerConfig,
  CommitClassification,
  CommitVerdict,
  SlopVerification,
  SynthesisResult,
} from "./types"

const RECOMMENDATION_EMOJI: Record<SynthesisResult["recommendation"], string> = {
  MERGE_CLEAN: "🟢",
  CHERRY_PICK: "🟡",
  SKIP: "🔴",
  HOLD_FOR_HUMAN: "⚪",
}

function countByVerdict(classifications: CommitClassification[]): Record<CommitVerdict, number> {
  return {
    GOOD: classifications.filter((c) => c.verdict === "GOOD").length,
    NEEDS_REVIEW: classifications.filter((c) => c.verdict === "NEEDS_REVIEW").length,
    SLOP: classifications.filter((c) => c.verdict === "SLOP").length,
  }
}

function renderCommitLines(commits: CommitClassification[]): string {
  if (commits.length === 0) return "_(none)_"
  return commits
    .map((c) => `- \`${c.shortSha}\` **${c.subject}** -- ${c.reason}`)
    .join("\n")
}

function renderBatchNotes(batch: BatchResult | undefined, pushAttempted: boolean): string {
  if (!batch || batch.skipped) return ""
  const branchOnOrigin = pushAttempted && batch.pushOutcome === "ok"
  const branchLabel = branchOnOrigin
    ? `Branch: \`${batch.branchName}\` (on origin)`
    : `Branch: \`${batch.branchName}\` (local only; not on origin)`
  const notes: string[] = [branchLabel]

  if (batch.conflictCommits.length > 0) {
    notes.push(
      `> ⚠️ ${batch.conflictCommits.length} commit(s) failed to cherry-pick and are NOT in the draft PR.`,
    )
  }
  if (batch.pushOutcome === "blocked-by-workflow-permission") {
    notes.push(
      "> 🚫 Push to origin was rejected. `GITHUB_TOKEN` cannot create or modify files under `.github/workflows/`. The batch branch exists only in the workflow runner and was discarded. To merge this batch, run the analyzer with a PAT that has the `workflow` scope, or cherry-pick locally.",
    )
  } else if (batch.pushOutcome === "failed") {
    notes.push("> 🚫 Push to origin failed for an unexpected reason. Check the workflow logs.")
  } else if (!pushAttempted) {
    notes.push(
      "> ℹ️ Push was not attempted (`push_branches=false`). The batch branch was built in the runner but not uploaded; re-run with `push_branches=true` to open a draft PR.",
    )
  }
  if (batch.workflowTouchingCommits.length > 0) {
    const shortShas = batch.workflowTouchingCommits.map((sha) => `\`${sha.slice(0, 7)}\``).join(", ")
    notes.push(
      `> 📝 ${batch.workflowTouchingCommits.length} commit(s) touch \`.github/workflows/\` and require elevated permissions to sync: ${shortShas}`,
    )
  }
  return `\n${notes.join("\n")}`
}

function renderBatchSection(
  heading: string,
  description: string,
  commits: CommitClassification[],
  batch: BatchResult | undefined,
  pushAttempted: boolean,
): string {
  const notes = renderBatchNotes(batch, pushAttempted)
  return [`### ${heading}`, `_${description}_`, "", renderCommitLines(commits), notes, ""].join("\n")
}

function renderVerifications(verifications: SlopVerification[]): string {
  if (verifications.length === 0) return ""
  const lines = verifications.map(
    (v) =>
      `- \`${v.sha.slice(0, 7)}\` ${v.verifyResult} (behavior delta: ${v.behaviorDelta}): ${v.reasoning}`,
  )
  return ["### Slop verifier second-pass notes", "", ...lines, ""].join("\n")
}

function renderBreakingChanges(items: SynthesisResult["breakingChanges"]): string {
  if (items.length === 0) return "_(none detected)_"
  return items.map((bc) => `- **[${bc.severity}]** ${bc.description}`).join("\n")
}

function renderStringList(items: string[]): string {
  if (items.length === 0) return "_(none)_"
  return items.map((item) => `- ${item}`).join("\n")
}

function renderActionItems(items: string[]): string {
  if (items.length === 0) return "_(none)_"
  return items.map((item) => `- [ ] ${item}`).join("\n")
}

interface IssueReportInput {
  config: AnalyzerConfig
  classifications: CommitClassification[]
  verifications: SlopVerification[]
  synthesis: SynthesisResult
  batches: BatchResult[]
  pushAttempted: boolean
}

function buildHeader(input: IssueReportInput): string {
  const { config, synthesis } = input
  const emoji = RECOMMENDATION_EMOJI[synthesis.recommendation]
  return [
    `# ${emoji} Upstream cost-benefit: ${config.fromTag} → ${config.toTag}`,
    "",
    `**Upstream:** \`${config.upstreamRepo}\`  `,
    `**Recommendation:** \`${synthesis.recommendation}\` (confidence: ${synthesis.confidence})  `,
    `**Slop ratio:** ${synthesis.slopRatioPercent}%  `,
    "",
    synthesis.summary,
    "",
  ].join("\n")
}

function buildBatchSummary(input: IssueReportInput): string {
  const counts = countByVerdict(input.classifications)
  const findBatch = (v: CommitVerdict) => input.batches.find((b) => b.batch === v)
  return [
    "## Batch classification",
    "",
    `| Verdict | Count | Branch |`,
    `|---|---|---|`,
    `| 🟢 GOOD | ${counts.GOOD} | \`${findBatch("GOOD")?.branchName ?? "n/a"}\` |`,
    `| 🟡 NEEDS_REVIEW | ${counts.NEEDS_REVIEW} | \`${findBatch("NEEDS_REVIEW")?.branchName ?? "n/a"}\` |`,
    `| 🔴 SLOP | ${counts.SLOP} | \`${findBatch("SLOP")?.branchName ?? "n/a"}\` |`,
    "",
  ].join("\n")
}

function buildBatchDetails(input: IssueReportInput): string {
  const goodBatch = input.batches.find((b) => b.batch === "GOOD")
  const reviewBatch = input.batches.find((b) => b.batch === "NEEDS_REVIEW")
  const slopBatch = input.batches.find((b) => b.batch === "SLOP")

  const goodCommits = input.classifications.filter((c) => c.verdict === "GOOD")
  const reviewCommits = input.classifications.filter((c) => c.verdict === "NEEDS_REVIEW")
  const slopCommits = input.classifications.filter((c) => c.verdict === "SLOP")

  return [
    renderBatchSection(
      "🟢 Good batch",
      "Classified as real value. Candidate for merge.",
      goodCommits,
      goodBatch,
      input.pushAttempted,
    ),
    renderBatchSection(
      "🟡 Review batch",
      "Ambiguous. Human should review before merging.",
      reviewCommits,
      reviewBatch,
      input.pushAttempted,
    ),
    renderBatchSection(
      "🔴 Slop batch",
      "Classified as AI slop or pointless churn. Do not merge as-is; rewrite intent if salvageable.",
      slopCommits,
      slopBatch,
      input.pushAttempted,
    ),
  ].join("\n")
}

function buildSynthesisDetails(synthesis: SynthesisResult): string {
  return [
    "## Fork-sync impact assessment",
    "",
    "### Breaking changes",
    renderBreakingChanges(synthesis.breakingChanges),
    "",
    "### Dependency changes",
    renderStringList(synthesis.dependencyChanges),
    "",
    "### Architecture drift",
    renderStringList(synthesis.architectureDrift),
    "",
    "### Hidden concerns",
    renderStringList(synthesis.hiddenConcerns),
    "",
    "### Action items before merging",
    renderActionItems(synthesis.actionItems),
    "",
  ].join("\n")
}

function buildFooter(config: AnalyzerConfig): string {
  return [
    "---",
    "",
    "_Generated by `upstream-analyzer` workflow. This issue is advisory: no merges or publishes happen automatically. Phase 1: draft PRs only. The prompt lives in `.github/prompts/` and is editable without touching workflow code._",
    "",
    `_Models: classify=\`${config.modelClassify}\` | verify=\`${[config.modelSlopVerify, ...config.modelSlopVerifyFallbacks].join(" → ")}\` | synthesis=\`${config.modelSynthesis}\`._`,
  ].join("\n")
}

export function buildIssueTitle(config: AnalyzerConfig, synthesis: SynthesisResult): string {
  const emoji = RECOMMENDATION_EMOJI[synthesis.recommendation]
  return `${emoji} Upstream ${config.fromTag} → ${config.toTag}: ${synthesis.recommendation} (slop ${synthesis.slopRatioPercent}%)`
}

export function buildIssueBody(input: IssueReportInput): string {
  return [
    buildHeader(input),
    buildBatchSummary(input),
    buildBatchDetails(input),
    renderVerifications(input.verifications),
    buildSynthesisDetails(input.synthesis),
    buildFooter(input.config),
  ]
    .filter(Boolean)
    .join("\n")
}

export function buildIssueLabels(synthesis: SynthesisResult, toTag: string): string[] {
  const recommendationLabel = `upstream:${synthesis.recommendation.toLowerCase().replace("_", "-")}`
  const tagLabel = `upstream-tag:${toTag}`
  return ["cost-benefit", "upstream-review", recommendationLabel, tagLabel]
}

export function buildBatchPrBody(
  batch: BatchResult,
  classifications: CommitClassification[],
  issueNumber: number | null,
): string {
  const commits = classifications.filter((c) => c.verdict === batch.batch)
  const issueRef = issueNumber ? `Closes analysis issue: #${issueNumber}\n\n` : ""
  const conflictWarning =
    batch.conflictCommits.length > 0
      ? `\n> ⚠️ ${batch.conflictCommits.length} commit(s) failed to cherry-pick and were skipped. See issue for full list.\n`
      : ""
  return [
    `Draft PR for the **${batch.batch}** batch of upstream ${batch.baseTag} → \`${batch.branchName}\`.`,
    "",
    issueRef,
    `This PR is **not auto-mergeable**. Phase 1 of the upstream-analyzer pipeline is advisory only.`,
    conflictWarning,
    "### Commits in this batch",
    "",
    renderCommitLines(commits),
  ].join("\n")
}
