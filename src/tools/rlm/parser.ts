export type ParsedFinal =
  | { type: "final"; content: string }
  | { type: "final_var"; variableName: string }

export type ParsedFinalError = {
  type: "error"
  message: string
  raw: string
}

export type ParseFinalResult = ParsedFinal | ParsedFinalError

const FINAL_VAR_PATTERN = /FINAL_VAR\(([^)]*)\)/
const FINAL_PATTERN = /FINAL\(([\s\S]*?)\)/

const MALFORMED_FINAL_VAR = /FINAL_VAR\([^)]*$/m
const MALFORMED_FINAL = /FINAL\([^)]*$/m

/**
 * Parse FINAL(value) or FINAL_VAR(varName) from text.
 *
 * Returns null if no FINAL/FINAL_VAR tag is found.
 * Returns an error result for malformed tags (e.g. unclosed parens).
 * FINAL_VAR is checked first to avoid false-matching "FINAL(" prefix.
 */
export function parseFinalAnswer(text: string): ParseFinalResult | null {
  const finalVarMatch = text.match(FINAL_VAR_PATTERN)
  if (finalVarMatch) {
    const variableName = finalVarMatch[1].trim()
    if (variableName.length === 0) {
      return {
        type: "error",
        message: "FINAL_VAR() called with empty variable name",
        raw: finalVarMatch[0],
      }
    }
    return {
      type: "final_var",
      variableName,
    }
  }

  const finalMatch = text.match(FINAL_PATTERN)
  if (finalMatch) {
    return {
      type: "final",
      content: finalMatch[1],
    }
  }

  if (MALFORMED_FINAL_VAR.test(text)) {
    return {
      type: "error",
      message: "Malformed FINAL_VAR tag: missing closing parenthesis",
      raw: text.match(MALFORMED_FINAL_VAR)?.[0] ?? "",
    }
  }

  if (MALFORMED_FINAL.test(text)) {
    return {
      type: "error",
      message: "Malformed FINAL tag: missing closing parenthesis",
      raw: text.match(MALFORMED_FINAL)?.[0] ?? "",
    }
  }

  return null
}

/**
 * Check if a parsed result is a successful FINAL/FINAL_VAR (not an error).
 */
export function isParsedFinalSuccess(result: ParseFinalResult): result is ParsedFinal {
  return result.type === "final" || result.type === "final_var"
}
