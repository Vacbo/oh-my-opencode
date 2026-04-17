import { z } from "zod"

export const commitVerdictSchema = z.object({
  verdict: z.enum(["GOOD", "NEEDS_REVIEW", "SLOP"]).describe("Classification verdict"),
  confidence: z.enum(["high", "medium", "low"]).describe("Confidence in the verdict"),
  reason: z.string().min(1).max(500).describe("One concrete sentence referencing the actual change"),
  slop_signals: z
    .array(z.string().min(1).max(200))
    .describe("Matched symptoms from the slop checklist (empty array if none)"),
})

export type CommitVerdictRaw = z.infer<typeof commitVerdictSchema>

export const slopVerifyResultSchema = z.object({
  verdict: z
    .enum(["CONFIRMED_SLOP", "DEMOTE_TO_REVIEW", "DEMOTE_TO_GOOD"])
    .describe("Second-pass verdict after deeper analysis"),
  reasoning: z.string().min(1).max(1000).describe("2-4 sentences walking through the analysis"),
  behavior_delta: z
    .enum(["none", "minor", "significant"])
    .describe("Did this commit meaningfully change runtime behavior?"),
  first_pass_was_correct: z.boolean().describe("Did the first-pass reviewer classify correctly?"),
})

export type SlopVerifyResultRaw = z.infer<typeof slopVerifyResultSchema>

const breakingChangeSchema = z.object({
  description: z.string().min(1).max(500),
  severity: z.enum(["high", "medium", "low"]),
})

export const releaseSynthesisSchema = z.object({
  recommendation: z
    .enum(["MERGE_CLEAN", "CHERRY_PICK", "SKIP", "HOLD_FOR_HUMAN"])
    .describe("Overall merge recommendation"),
  confidence: z.enum(["high", "medium", "low"]),
  summary: z.string().min(1).max(2000).describe("3-5 sentence plain-English verdict"),
  slop_ratio_percent: z.number().int().min(0).max(100),
  breaking_changes: z.array(breakingChangeSchema),
  dependency_changes: z.array(z.string().min(1).max(300)),
  architecture_drift: z.array(z.string().min(1).max(300)),
  hidden_concerns: z.array(z.string().min(1).max(300)),
  action_items: z.array(z.string().min(1).max(300)),
})

export type ReleaseSynthesisRaw = z.infer<typeof releaseSynthesisSchema>
