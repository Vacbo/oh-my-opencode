export type CommitVerdict = "GOOD" | "NEEDS_REVIEW" | "SLOP"

export type SlopVerifyVerdict = "CONFIRMED_SLOP" | "DEMOTE_TO_REVIEW" | "DEMOTE_TO_GOOD"

export type SynthesisRecommendation = "MERGE_CLEAN" | "CHERRY_PICK" | "SKIP" | "HOLD_FOR_HUMAN"

export interface CommitMeta {
  sha: string
  shortSha: string
  subject: string
  author: string
  date: string
}

export interface CommitClassification {
  sha: string
  shortSha: string
  subject: string
  verdict: CommitVerdict
  confidence: "high" | "medium" | "low"
  reason: string
  slopSignals: string[]
}

export interface SlopVerification {
  sha: string
  originalVerdict: CommitVerdict
  finalVerdict: CommitVerdict
  verifyResult: SlopVerifyVerdict
  reasoning: string
  behaviorDelta: "none" | "minor" | "significant"
}

export interface SynthesisResult {
  recommendation: SynthesisRecommendation
  confidence: "high" | "medium" | "low"
  summary: string
  slopRatioPercent: number
  breakingChanges: Array<{ description: string; severity: "high" | "medium" | "low" }>
  dependencyChanges: string[]
  architectureDrift: string[]
  hiddenConcerns: string[]
  actionItems: string[]
}

import type { ChainEntry } from "./providers"

export interface AnalyzerConfig {
  upstreamRepo: string
  fromTag: string
  toTag: string
  classifyChain: ChainEntry[]
  slopVerifyChain: ChainEntry[]
  synthesisChain: ChainEntry[]
  repoOwner: string
  repoName: string
  outputDir: string
}

export interface PipelineOutput {
  config: AnalyzerConfig
  commits: CommitClassification[]
  verifications: SlopVerification[]
  synthesis: SynthesisResult
}
