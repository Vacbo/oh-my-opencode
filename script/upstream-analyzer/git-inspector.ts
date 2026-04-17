import { $ } from "bun"
import type { CommitMeta } from "./types"

const DEFAULT_DIFF_CHARS = 24000

export async function ensureUpstreamRemote(upstreamRepo: string): Promise<void> {
  await $`git remote remove upstream`.quiet().nothrow()
  await $`git remote add upstream https://github.com/${upstreamRepo}.git`.quiet()
  // --force: upstream wins when its tag SHA differs from the fork's. Forks
  // sometimes rewrite tag history during sync; without --force the fetch
  // exits non-zero and the whole pipeline aborts. The CI clone is ephemeral
  // and never pushed, so overwriting local tags here is safe.
  await $`git fetch --force --tags upstream`.quiet()
}

export async function tagExists(tag: string): Promise<boolean> {
  const result = await $`git rev-parse --verify ${tag}`.quiet().nothrow()
  return result.exitCode === 0
}

export async function listCommitsInRange(fromTag: string, toTag: string): Promise<CommitMeta[]> {
  const format = "%H%x09%h%x09%s%x09%an%x09%aI"
  const output = await $`git log --reverse --no-merges --format=${format} ${fromTag}..${toTag}`.text()

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, shortSha, subject, author, date] = line.split("\t")
      return { sha, shortSha, subject, author, date }
    })
}

export async function getCommitDiff(sha: string, maxChars: number = DEFAULT_DIFF_CHARS): Promise<string> {
  const diff = await $`git show --no-color --format=fuller ${sha}`.text()
  if (diff.length <= maxChars) return diff
  return `${diff.slice(0, maxChars)}\n\n...[diff truncated at ${maxChars} chars]`
}

export async function getReleaseDiffStat(fromTag: string, toTag: string): Promise<string> {
  return (await $`git diff --stat ${fromTag}..${toTag}`.text()).trim()
}

export async function getDependencyChanges(fromTag: string, toTag: string): Promise<string> {
  const result = await $`git diff ${fromTag}..${toTag} -- package.json`.quiet().nothrow()
  if (result.exitCode !== 0) return ""
  return result.text()
}

export async function resetWorkingTree(): Promise<void> {
  // `bun install` modifies bun.lock, which blocks `git checkout -b` with
  // "local changes would be overwritten". Reset discards tracked-file
  // modifications in the ephemeral CI clone so the batch-build phase
  // starts from a clean slate. Untracked files (.analyzer-output,
  // node_modules) stay intact because we deliberately skip `git clean`.
  await $`git reset --hard HEAD`.quiet().nothrow()
}

export async function commitTouchesWorkflow(sha: string): Promise<boolean> {
  const files = await $`git show --name-only --format= ${sha}`.text()
  return files
    .split("\n")
    .map((line) => line.trim())
    .some((file) => file.startsWith(".github/workflows/"))
}

export async function createBranchFromTag(branchName: string, baseTag: string): Promise<void> {
  await $`git branch -D ${branchName}`.quiet().nothrow()
  await $`git checkout -b ${branchName} ${baseTag}`.quiet()
}

export async function cherryPickCommit(sha: string): Promise<"ok" | "conflict"> {
  const result = await $`git cherry-pick --allow-empty --keep-redundant-commits ${sha}`.quiet().nothrow()
  if (result.exitCode === 0) return "ok"
  await $`git cherry-pick --abort`.quiet().nothrow()
  return "conflict"
}

export async function getCurrentBranch(): Promise<string> {
  return (await $`git rev-parse --abbrev-ref HEAD`.text()).trim()
}

export type PushOutcome = "ok" | "blocked-by-workflow-permission" | "failed"

export async function pushBranch(branch: string): Promise<PushOutcome> {
  const result = await $`git push origin ${branch} --force-with-lease`.quiet().nothrow()
  if (result.exitCode === 0) return "ok"
  const stderr = result.stderr.toString()
  // GITHUB_TOKEN cannot create or modify files under .github/workflows/
  // without the `workflows` scope, which it never has. Surface this as a
  // distinct outcome so the issue body can flag it rather than failing
  // the whole pipeline.
  if (/without `?workflows`? permission/i.test(stderr)) {
    return "blocked-by-workflow-permission"
  }
  return "failed"
}
