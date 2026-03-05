export type ParsedFinal =
  | { type: "final"; content: string }
  | { type: "final_var"; variableName: string }

const FINAL_VAR_PATTERN = /^FINAL_VAR\(([^)]*)\)/m
const FINAL_PATTERN = /^FINAL\(([\s\S]*)\)/m

export function parseFinalAnswer(text: string): ParsedFinal | null {
  const finalVarMatch = text.match(FINAL_VAR_PATTERN)
  if (finalVarMatch) {
    return {
      type: "final_var",
      variableName: finalVarMatch[1],
    }
  }

  const finalMatch = text.match(FINAL_PATTERN)
  if (finalMatch) {
    return {
      type: "final",
      content: finalMatch[1],
    }
  }

  return null
}
