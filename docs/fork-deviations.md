# Fork Deviation Register

**Purpose**: record every commit this fork carries that does not exist on
`upstream/dev`. Prevents drift-amnesia. Gives future maintainers evidence when
they ask "why do we have this?".

**Scope**: commits on `dev` reachable from `HEAD` but not from `upstream/dev`.
At snapshot time: 43 commits.

**Snapshot**: `git log upstream/dev..dev` as of 2026-04-21, fork HEAD
`5cd78886`, upstream HEAD `e0bcf3e2`, last sync target `v3.17.0` per
`upstream-version.txt`.

## Categories

| Category | Meaning | Never-upstream? |
| --- | --- | --- |
| `analyzer-infra` | AI-powered upstream-release analyzer (tool, CI workflows, prompts) | Yes -- fork-specific automation |
| `scoped-package` | Switch from `oh-my-opencode` to `@vacbo/oh-my-opencode` scope, trusted publishing, ancillary test/doc fixes | Yes -- fork identity |
| `sync-cherrypick` | Cherry-picked from upstream in a prior sync window; stays on fork until formal tag sync | No -- already upstream, just not yet rebased-over |
| `fork-only-fix` | Bug fix or behavior change authored here that is not present upstream | Try-to-upstream or never-upstream, per-commit |
| `ci-hardening` | Generic CI maintenance (action version bumps, retry logic) | Usually try-to-upstream |
| `release-bot` | `release: vX.Y.Z` commits the `publish.yml` workflow writes | Never-upstream (per-fork release tracking) |

## Summary

| Category | Count |
| --- | --- |
| `analyzer-infra` | 14 |
| `sync-cherrypick` | 11 |
| `scoped-package` | 8 |
| `fork-only-fix` | 5 |
| `ci-hardening` | 3 |
| `release-bot` | 2 |
| **Total** | **43** |

## Full register (43 commits)

### analyzer-infra (14)

| SHA | Date | Subject | Reason |
| --- | --- | --- | --- |
| `3ade0661` | 2026-04-17 | feat(ci): add AI-powered upstream release analyzer with draft PR batching (#1) | Anchor commit: 3-pass classify/verify/synthesize pipeline in `script/upstream-analyzer/` + `.github/prompts/` + `upstream-analyzer.yml`. |
| `58a97e74` | 2026-04-17 | fix(ci): drop --frozen-lockfile from upstream-analyzer install (#2) | Align with repo-wide `bun install` convention. |
| `21629d09` | 2026-04-17 | fix(analyzer): force-fetch upstream tags to tolerate fork history rewrites (#3) | Tolerate upstream's rewritten `v3.17.2`. |
| `f95402c2` | 2026-04-17 | fix(analyzer): add rate limiting, working-tree reset, and partial persistence (#4) | Three run-2 bugs; persist classifications before pass 2 so crashes produce useful artifacts. |
| `9c5361f5` | 2026-04-17 | fix(analyzer): workflow-permission push handling + gpt-5 max_completion_tokens (#5) | Handle `GITHUB_TOKEN` refusing workflow-file pushes; model-specific param selection. |
| `43518042` | 2026-04-17 | fix(analyzer): write artifacts outside git worktree (use runner.temp) (#6) | Batch-build checkouts were erasing in-worktree `.analyzer-output/`. Centralize via `$GITHUB_ENV`. |
| `859b3546` | 2026-04-17 | feat(analyzer): migrate to Vercel AI SDK with multi-provider harness + tools (#8) | Cross-provider fallback; tool-calling harness (`read_file`, `grep_callers`) with path sandboxing. |
| `6599159d` | 2026-04-17 | feat(analyzer): lead chains with best free models, GitHub last (#9) | Default chain: OpenRouter → NVIDIA → GitHub Models. |
| `b84199a5` | 2026-04-17 | fix(analyzer): retry provider-selection failures in fallback chain (#11) | Treat OpenRouter "No allowed providers" as retriable so the chain falls through. |
| `a7078715` | 2026-04-17 | docs(analyzer): tighten slop rules for workaround-heavy AI hooks | AI-on-every-edit heuristic in `commit-classify.md`. |
| `270dca80` | 2026-04-17 | docs(analyzer): add category-first taxonomy to prompts | Explicit `cla_admin` / `release_version_bump` / `date_count_metadata_churn` categories → never GOOD. |
| `593bff78` | 2026-04-12 | ci(sync): add upstream auto-sync workflow | Legacy `sync-upstream.yml`; superseded by analyzer. Kept gated behind `yes-legacy-force-sync` input for reference. |
| `399261b4` | 2026-04-15 | fix(ci): stop sync-upstream from auto-dispatching publish | Safety cutover when analyzer took over. |
| `582ebc9a` | 2026-04-19 | fix(ci): grant contents:write so tag watcher can create repository_dispatch | `createDispatchEvent` needs `contents: write`, not `actions: write` alone. Watcher was 403'ing every 15 min. |

### sync-cherrypick (11)

| SHA | Date | Subject | Reason |
| --- | --- | --- | --- |
| `b9d5dd22` | 2026-04-14 | Merge commit '1bb59c3e' into dev | Upstream merge, part of p9 conservative sync. |
| `cb15a7b6` | 2026-04-15 | chore(sync): merge upstream v3.17.3 | Upstream v3.17.3 merge; tracker not yet bumped to match. |
| `67bc9613` | 2026-04-16 | feat(tool-metadata): add shared metadata contract and bridge | Upstream author YeonGyu-Kim; picked to unlock subsequent metadata fixes. |
| `0eece31b` | 2026-04-16 | feat(background-agent): add wait-for-task-session helper | Upstream author YeonGyu-Kim. |
| `4b8a23a2` | 2026-04-16 | fix(plugin): harden metadata recovery and extraction | Upstream author YeonGyu-Kim. |
| `e7e67354` | 2026-04-18 | fix(plugin-handlers): hide demoted native plan agent | Real behavior fix from upstream (per p9 handoff §Context). |
| `825da2f6` | 2026-04-18 | refactor(tools): migrate metadata producers to shared bridge | Ancillary to `67bc9613`. |
| `a302d3cf` | 2026-04-18 | fix(shared): support anthropic OAuth auth detection | Real OAuth effort-clamping fix. |
| `bb2d2b23` | 2026-04-18 | fix(cli): preserve hyphenated anthropic IDs in installer output | Installer output correctness. |
| `87e084a6` | 2026-04-18 | fix(testing): avoid stale skill scans and preserve plugin alias | Root-cause fix for local test failures, not suppression. |
| `3b745a04` | 2026-04-18 | fix(testing): widen plugin loader boundary test timeouts | Upstream test-stability fix. |

### scoped-package (8)

| SHA | Date | Subject | Reason |
| --- | --- | --- | --- |
| `da781c6b` | 2026-04-11 | build(publish): switch to @vacbo scope and trusted publishing | Anchor: fork identity. Never upstreamable. |
| `84f41b79` | 2026-04-11 | build(schema): refresh config schema for skill source controls | Regen after scope-affecting schema updates. |
| `5b978031` | 2026-04-11 | ci(publish): consolidate npm publishing into one workflow | Single `publish.yml` for scoped package flow. |
| `7cfc679a` | 2026-04-12 | fix(ci): align tests with scoped package and Claude model IDs | Test updates for `@vacbo/...` imports + Claude ID format. |
| `721a33a5` | 2026-04-12 | fix(ci): update cache sync tests for scoped package name | Scope-aware cache keys. |
| `d30940da` | 2026-04-12 | fix(ci): update session and doctor tests for scoped package | Scope-aware test fixtures. |
| `a8bc6122` | 2026-04-15 | docs(release): align scoped package install guidance | README install commands for `@vacbo/oh-my-opencode`. |
| `42b87b31` | 2026-04-15 | fix(testing): stabilize release verification isolation | Release-verification tests isolation. |

### fork-only-fix (5)

| SHA | Date | Subject | Reason | Upstream plan |
| --- | --- | --- | --- | --- |
| `ceefa988` | 2026-04-11 | fix(skill-loader): continue nested discovery below parent skills | Skill loader wasn't recursing into child dirs; broke nested skill hierarchy. | Try-to-upstream |
| `b45ded4f` | 2026-04-11 | fix(skill-context): add independent Claude and .agents skill gates | Separate gate flags per skill source so one source's skills don't leak. | Try-to-upstream |
| `bea60840` | 2026-04-11 | fix(telemetry): require explicit opt-in and user-provided key | Telemetry off by default unless user actively opts in with their own key. | Fork-only (philosophy divergence) |
| `b74a6215` | 2026-04-15 | fix(task-ui): normalize delegated task labels | Task UI was showing raw internal labels. | Try-to-upstream |
| `d848d7f2` | 2026-04-15 | fix(command-config): honor separate claude skill sources | Companion to `b45ded4f` at command-config layer. | Try-to-upstream |

Categorization note: `84f41b79` (schema regen) could plausibly live here as a
fork-only-fix instead of under `scoped-package`. I placed it under
`scoped-package` because the schema change is coupled to the scoped-package
publishing artifact. Move it here if your mental model prefers the
fork-only-fix framing; totals stay at 43 either way.

### ci-hardening (3)

| SHA | Date | Subject | Reason |
| --- | --- | --- | --- |
| `f9c5d411` | 2026-04-14 | fix(ci): retry publish when npm rejects immutable versions | npm version-collision retry loop; mirrored in `publish.yml`. |
| `01404d28` | 2026-04-14 | fix(ci): upgrade checkout action to v5 | Node 20 → Node 24. |
| `5cd78886` | 2026-04-19 | chore(ci): upgrade actions/github-script v7 -> v9 (node 24) | Kill the Node 20 deprecation warnings. |

### release-bot (2)

| SHA | Date | Subject | Reason |
| --- | --- | --- | --- |
| `e29972a6` | 2026-04-12 | release: v3.17.2 | Automated commit from `publish.yml`'s `release` job. |
| `c9b352e1` | 2026-04-18 | release: v3.18.0 | Automated commit from `publish.yml`'s `release` job. |

## Review notes

- The `scoped-package` vs `fork-only-fix` boundary for `84f41b79` is judgment:
  it's a schema regen whose trigger was skill-source-control work. Left under
  `scoped-package` because the schema change is coupled to the packaged artifact.
- Category totals above count each commit exactly once, by the most specific
  category.
- No commits currently classified as potentially-slop. If future reviewers find
  one, move it here with justification and plan to revert.

## Maintenance

Every PR that lands a fork-only commit must update this file with a new row
before merge. Reviewer enforces. The registry is refreshed (not rewritten) on
each sync-and-release cycle: after `upstream-version.txt` bumps, the
`sync-cherrypick` rows become upstream and can be collapsed.
