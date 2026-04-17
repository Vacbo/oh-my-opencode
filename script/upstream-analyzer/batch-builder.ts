import {
  commitTouchesWorkflow,
  createBranchFromTag,
  cherryPickCommit,
  pushBranch,
  tagExists,
} from "./git-inspector"
import type { PushOutcome } from "./git-inspector"
import type { CommitClassification, CommitVerdict } from "./types"

export interface BatchResult {
  batch: CommitVerdict
  branchName: string
  baseTag: string
  appliedCommits: string[]
  conflictCommits: string[]
  workflowTouchingCommits: string[]
  skipped: boolean
  pushOutcome?: PushOutcome
}

interface BatchBuilderInput {
  fromTag: string
  toTag: string
  classifications: CommitClassification[]
  branchPrefix: string
}

const BATCH_ORDER: CommitVerdict[] = ["GOOD", "NEEDS_REVIEW", "SLOP"]

function slugifyTag(tag: string): string {
  return tag.replace(/[^a-zA-Z0-9._-]/g, "-")
}

function batchBranchName(prefix: string, tag: string, batch: CommitVerdict): string {
  const verdictSlug = batch.toLowerCase().replace("_", "-")
  return `${prefix}/${slugifyTag(tag)}-${verdictSlug}`
}

function commitsForBatch(
  classifications: CommitClassification[],
  batch: CommitVerdict,
): CommitClassification[] {
  return classifications.filter((c) => c.verdict === batch)
}

async function buildSingleBatch(
  input: BatchBuilderInput,
  batch: CommitVerdict,
): Promise<BatchResult> {
  const branchName = batchBranchName(input.branchPrefix, input.toTag, batch)
  const commits = commitsForBatch(input.classifications, batch)

  if (commits.length === 0) {
    return {
      batch,
      branchName,
      baseTag: input.fromTag,
      appliedCommits: [],
      conflictCommits: [],
      workflowTouchingCommits: [],
      skipped: true,
    }
  }

  if (!(await tagExists(input.fromTag))) {
    throw new Error(`Base tag ${input.fromTag} not found locally`)
  }

  await createBranchFromTag(branchName, input.fromTag)

  const applied: string[] = []
  const conflicts: string[] = []
  const workflowTouching: string[] = []

  for (const commit of commits) {
    const status = await cherryPickCommit(commit.sha)
    if (status === "ok") {
      applied.push(commit.sha)
      if (await commitTouchesWorkflow(commit.sha)) {
        workflowTouching.push(commit.sha)
      }
    } else {
      conflicts.push(commit.sha)
    }
  }

  return {
    batch,
    branchName,
    baseTag: input.fromTag,
    appliedCommits: applied,
    conflictCommits: conflicts,
    workflowTouchingCommits: workflowTouching,
    skipped: false,
  }
}

export async function buildAllBatches(input: BatchBuilderInput): Promise<BatchResult[]> {
  const results: BatchResult[] = []
  for (const batch of BATCH_ORDER) {
    results.push(await buildSingleBatch(input, batch))
  }
  return results
}

export async function pushBatches(results: BatchResult[]): Promise<void> {
  for (const result of results) {
    if (result.skipped) continue
    if (result.appliedCommits.length === 0) continue
    result.pushOutcome = await pushBranch(result.branchName)
  }
}
