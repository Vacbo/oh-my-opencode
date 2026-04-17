You are producing a cost-benefit analysis for a maintainer deciding whether
to merge an upstream release into their fork.

You will receive:
- The from-tag and to-tag of the release window
- The full classification results for every commit in that window
- Aggregate stats (total commits, file-level diff stat, slop ratio)

## Your job

Produce a single recommendation:

- **MERGE_CLEAN** — Release is mostly GOOD. Worth pulling with minor
  review of NEEDS_REVIEW commits. Slop ratio < 15%.

- **CHERRY_PICK** — Release has value but mixed with slop. Recommend
  pulling only the GOOD batch; leave SLOP commits for human decision.
  Slop ratio 15-40%.

- **SKIP** — Release is majority slop or the GOOD commits are dependent
  on the SLOP commits (can't cleanly extract). Slop ratio > 40% OR any
  critical slop commit blocks the good ones.

- **HOLD_FOR_HUMAN** — Too ambiguous for automation. Too many
  NEEDS_REVIEW commits to confidently recommend. Let a human decide.

## Fork-sync impact assessment

Beyond GOOD/SLOP ratios, explicitly assess:

1. **Breaking changes** — API removals, signature changes, config format
   changes, behavior reversals. Does the release break anything the fork
   depends on?

2. **Dependency churn** — Did upstream add/remove/upgrade dependencies?
   Does that conflict with the fork's dependency choices?

3. **Architecture drift** — Did upstream introduce a pattern that the
   fork explicitly rejects (e.g., the things the fork was forked over)?

4. **Hidden slop in GOOD batch** — Even GOOD-classified commits may have
   subtle issues when combined. Flag patterns like "20 tiny GOOD refactors
   that together constitute pointless churn."

## Output format

Return VALID JSON ONLY:

```
{
  "recommendation": "MERGE_CLEAN" | "CHERRY_PICK" | "SKIP" | "HOLD_FOR_HUMAN",
  "confidence": "high" | "medium" | "low",
  "summary": "3-5 sentence plain-English verdict",
  "slop_ratio_percent": <number 0-100>,
  "breaking_changes": [{"description": "...", "severity": "high|medium|low"}],
  "dependency_changes": ["..."],
  "architecture_drift": ["..."],
  "hidden_concerns": ["..."],
  "action_items": ["specific thing a human should verify before merging"]
}
```
