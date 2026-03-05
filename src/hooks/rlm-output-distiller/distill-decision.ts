const CHARS_PER_TOKEN = 4

export function estimateTokens(charCount: number): number {
  return Math.ceil(charCount / CHARS_PER_TOKEN)
}

export interface DistillDecisionInput {
  outputCharCount: number
  thresholdTokens: number
  sessionShouldDistill: boolean
}

export function shouldDistillOutput(input: DistillDecisionInput): boolean {
  if (input.sessionShouldDistill) return true
  return estimateTokens(input.outputCharCount) > input.thresholdTokens
}

export function distillOutput(output: string, thresholdTokens: number): string {
  const maxChars = thresholdTokens * CHARS_PER_TOKEN
  const truncated = output.slice(0, maxChars)
  const originalTokens = estimateTokens(output.length)
  return `${truncated}\n\n[RLM distiller: output truncated from ~${originalTokens} to ~${thresholdTokens} tokens]`
}
