# Fork Sync & Upgrade Methodology

**Package**: `@vacbo/oh-my-opencode`
**Upstream**: `code-yeongyu/oh-my-openagent`
**Last updated**: 2026-04-21

This document is the canonical reference for how this fork stays synced with
upstream, how fork-only fixes land, how we guard against AI slop, and when we
publish npm releases. It describes what is already built and what the human
maintainer still owns.

## 0. DeepWiki is not an MCP

For the record: upstream PR #868 ("feat/deepwiki", merged as `987ae468`) added a
single line to `README.md` — a [deepwiki.com](https://deepwiki.com) badge
pointing to the auto-generated wiki for `code-yeongyu/oh-my-openagent`. That is
the entire content of the PR. There is no DeepWiki MCP server, no tool
registration, no plugin code. Any suggestion to "install DeepWiki MCP" in this
fork is unverified and should be treated as speculation until independent
evidence is produced.

## 1. Ground truth snapshot

| Field | Value |
| --- | --- |
| Published version | `@vacbo/oh-my-opencode@3.18.0` |
| Last upstream tag synced (`upstream-version.txt`) | `v3.17.0` |
| Latest upstream stable tag | `v3.18.0` |
| Fork `dev` vs `upstream/dev` | 43 ahead / 60 behind |
| Sync pipeline | `upstream-tag-watcher.yml` + `upstream-analyzer.yml` (3-pass AI classifier) |
| Release pipeline | `publish.yml` (main package + 11 platform binaries + GitHub release) |
| Legacy pipeline | `sync-upstream.yml` — **disabled**, kept for reference |
| Slop rubric | `.github/prompts/{commit-classify,slop-verify,release-synthesis}.md` |
| Deviation register | `docs/fork-deviations.md` |

## 2. Automated pipeline

```
upstream-tag-watcher.yml (cron */15)
  │
  │ new upstream v* tag?
  ▼
repository_dispatch: upstream-tag-detected
  │
  ▼
upstream-analyzer.yml  (AI 3-pass)
  │
  │  Pass 1  classify each commit    GOOD / NEEDS_REVIEW / SLOP
  │  Pass 2  verify SLOP candidates  (stronger model)
  │  Pass 3  synthesize release      cost-benefit summary
  │
  │  Cherry-pick into   sync/upstream/{tag}-{good|review|slop}
  │
  ▼
1 analysis issue + up to 3 draft PRs  (maintainer merges; no auto-merge)
```

Everything up to "draft PRs" runs without a human. Nothing is ever auto-merged
or auto-published. The analyzer is advisory.

Providers and chains are configured in `upstream-analyzer.yml` workflow inputs
and `script/upstream-analyzer/providers.ts`. Default chain order is best-free
first (OpenRouter → NVIDIA → GitHub Models).

## 3. Manual gate — the six steps after the analyzer fires

### Step A. Triage the analysis issue

The analyzer opens a labeled issue with the release-level verdict. Read it
before touching any PR. If the verdict is "mostly slop" across the window, you
can legitimately skip this upstream release entirely — leave
`upstream-version.txt` at its current value so the next analyzer run includes
the skipped commits in a wider window.

### Step B. Process the `-good` batch

Default: merge after CI passes.

Exception — **the classifier is known to be charitable** on administrative
commits. Before merging, scan the batch for and drop:

- CLA signature commits (`@X has signed the CLA in code-yeongyu/...`)
- Release/version bump commits
- Date-only or count-only doc churn
- Minor visibility churn (`export` → internal with no caller benefit)

Rebase or cherry-pick-minus to drop those, then merge.

### Step C. Process the `-needs-review` batch

Read each diff against the rubric in `.github/prompts/commit-classify.md`:

- **Maze rule**: wrappers/adapters/hooks/indirection instead of a direct fix →
  drop, unless the diff proves a real external constraint forced that design.
- **AI-on-every-edit rule**: external model wired into routine edit actions by
  default → drop, unless the diff proves a hard requirement.
- Commits with measurable behavior delta and a real bug/feature → keep.

### Step D. Process the `-slop` batch

Default: close the draft PR, do not merge. These were flagged by two passes.
If you override, document the reason in the close comment so the next reviewer
sees the precedent.

### Step E. Update `upstream-version.txt`

After B-D conclude, bump `upstream-version.txt` to the tag you just processed.
This is what the watcher reads to avoid re-firing on the same tag. Only bump
after the work is actually merged.

### Step F. Publish the fork release

Dispatch `publish.yml` with `bump: patch` (or `minor` / `major` as appropriate).
The workflow:

1. Runs `bun test` + `bun run typecheck`
2. Bumps version in root + all 11 platform `package.json` files
3. Publishes `@vacbo/oh-my-opencode` with provenance
4. Builds and publishes 11 platform binaries
5. Tags `v{version}`, generates changelog, creates GitHub release
6. Merges `dev` → `master`

## 4. Fork-only fixes (changes that do not come from upstream)

Path:

1. Branch from `dev`: `feat/<scope>`, `fix/<scope>`, or `docs/<scope>`.
2. PR to `dev` (not `master`). Reviewer applies the same slop rubric as upstream
   commits — see §6.
3. CI gates: `bun test`, `bun run typecheck`, publish workflow smoke tests.
4. On merge, add a row to `docs/fork-deviations.md` with the SHA, category,
   reason, and upstream plan (see §7).
5. Next `publish.yml` dispatch folds the change into a release.

Fork-only fixes must not land on `sync/upstream/*` branches — those are reserved
for upstream cherry-picks so the analyzer's lineage tracking stays clean.

## 5. Conflict resolution

When a `sync/upstream/{tag}-{verdict}` cherry-pick conflicts:

| Conflict type | Rule |
| --- | --- |
| Upstream changed a file we rewrote for slop | Prefer fork version. Re-classify upstream's change in next window. |
| Upstream fixed a bug in code we no longer have | Drop the commit — not applicable. |
| Upstream feature collides with a fork-only feature | Prefer fork version. Open an issue to either port the upstream approach or justify the permanent delta. |
| Trivial formatting / line endings / timestamps | Take either side; auto-resolve if possible. |

If resolving a single commit's conflict takes more than 10 minutes of manual
work, stop and record it as a divergence-tax data point in a comment on the
draft PR. Repeated high-tax conflicts are a signal that the relevant fork
patches should be proposed upstream or reconsidered.

## 6. Anti-slop checklist (apply to every PR — upstream-origin or fork-origin)

Default to NEEDS_REVIEW when unsure. 60 seconds of human read is cheaper than a
permanent slop merge.

Reject any commit matching:

- Abstraction with one caller and no clear growth path
- Comments that restate the code
- Commit message using "enhanced/improved/comprehensive/robust" without a
  measurable metric or behavior delta
- Docs that expand without new facts
- Tautological tests (`expect(x).toBe(x)`)
- Features gated behind flags with no consumer requesting them
- Renamed symbols with no call-site benefit (pure churn)
- Defensive `try/catch` around code that cannot throw
- New dependency for trivial functionality
- **Maze**: workaround via wrappers/adapters/hooks instead of a direct fix
- Always-on hooks / wrappers / adapters with no root-cause justification
- **AI-on-every-edit**: external model wired into routine edit actions by
  default

Category-first taxonomy (apply before the verdict):

| Category | Examples | Default verdict |
| --- | --- | --- |
| Code-value | `real_bug_fix`, `real_test`, `real_feature`, `refactor_with_clear_value` | GOOD |
| Suspicious | `refactor_churn`, `docs_churn`, `minor_visibility_churn`, `workflow_or_tooling_maze` | Lean SLOP |
| Admin | `cla_admin`, `release_version_bump`, `governance_noise`, `date_count_metadata_churn` | Never GOOD |
| Unclear | — | NEEDS_REVIEW |

The canonical rubric lives in `.github/prompts/commit-classify.md`. This table
is a human-facing summary; the prompt file is the source of truth.

## 7. Deviation register

`docs/fork-deviations.md` contains one row per fork-only commit with:

- Commit SHA (short)
- Category (analyzer-infra / scoped-package / sync-cherrypick / fork-only-fix /
  ci-hardening / release-bot)
- Reason the fork carries it
- Upstream plan (never-upstream / try-to-upstream / already-from-upstream)

Every new fork-only PR must add a row. Reviewer enforces. The register prevents
drift-amnesia and gives future maintainers evidence when they ask "why do we
have this?".

## 8. Salvageable upstream PR backlog

Upstream has PRs that were closed unmerged but look useful to us. Tracking them
manually in `docs/salvageable-upstream-prs.md` (create on demand).
Columns:

- PR number and title
- Upstream status (closed, stale, blocked)
- Why it wasn't merged (if known)
- Why this fork might want it
- Decision: port now / port later / skip

A future analyzer pass could classify closed-unmerged PRs automatically. That
work is not yet scheduled.

## 9. Release cadence

| Trigger | Bump | Timing |
| --- | --- | --- |
| Upstream tag synced (merged `-good` + reviewed `-review`) | patch | 1-2 days after the tag |
| Fork-only bug fix merged | patch | Batch with other recent work |
| Fork-only feature merged | minor | When production-ready |
| Breaking change | major | Deliberate; announce + migration guide |
| Beta / RC | pre | Use `version` override with `-beta.N` / `-rc.N`; auto-publishes to `beta`/`rc` dist-tag |

Do not release for every commit. The `publish.yml` run spans 11 platform
binaries with provenance, costs CI time, and creates real npm state. Release
when you have something a user would notice.

## 10. What this document deliberately excludes

- The analyzer's internal prompt engineering — owned by `.github/prompts/`.
- The OmO source-code diagnostic plan (slop + performance audit of this fork
  itself) — owned by `p10`, blocked on the diagnostic from `p9`.
- The opencode-fork feasibility study — owned by `p11`.
- Any changes to tool routing for subagents (WarpGrep, DeepWiki, GitHub MCP,
  recursion depth) — separate research track, out of scope for sync methodology.

## 11. Immediate backlog (as of 2026-04-21)

Ordered by dependency.

- [ ] Bump `upstream-version.txt` → `v3.17.4` to reflect what was actually
      synced in the p9 window (per handoff plan §Context, lines 45-51).
- [ ] Dispatch the analyzer for `v3.17.4 → v3.18.0` to catch up on the
      60-commit gap on `upstream/dev`.
- [ ] Review the 3 draft PRs it produces, applying §3 Steps B-D.
- [ ] Bump `upstream-version.txt` → `v3.18.0` after the merge decisions
      conclude.
- [ ] Dispatch `publish.yml` with `bump: patch` → `@vacbo/oh-my-opencode@3.18.1`.
- [ ] Optional: extend the analyzer with a pass over upstream's
      closed-unmerged PRs (§8 future work).
- [ ] Optional: turn the slop rubric inward onto this fork's own commits
      (owned by `p10`).
