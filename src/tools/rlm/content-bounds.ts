import { estimateTokenCount } from "../delegate-task/token-limiter"

const CHARACTERS_PER_TOKEN = 4

export interface ContentBounds {
  maxBytes?: number
  maxTokens?: number
  maxLines?: number
}

export interface BoundedContent {
  content: string
  returnedBytes: number
  returnedTokens: number
  returnedLines: number
}

export function applyContentBounds(content: string, bounds: ContentBounds): BoundedContent {
  let result = content

  if (bounds.maxLines !== undefined) {
    const lines = toLines(result)
    result = lines.slice(0, bounds.maxLines).join("\n")
  }

  const maxCharsFromTokens = bounds.maxTokens !== undefined ? bounds.maxTokens * CHARACTERS_PER_TOKEN : undefined
  const maxCharsFromBytes = bounds.maxBytes

  const effectiveMaxChars = (maxCharsFromTokens !== undefined && maxCharsFromBytes !== undefined)
    ? Math.min(maxCharsFromTokens, maxCharsFromBytes)
    : (maxCharsFromTokens ?? maxCharsFromBytes)

  if (effectiveMaxChars !== undefined && result.length > effectiveMaxChars) {
    result = result.slice(0, effectiveMaxChars)
  }

  return {
    content: result,
    returnedBytes: result.length,
    returnedTokens: estimateTokenCount(result),
    returnedLines: toLines(result).length,
  }
}

function toLines(content: string): string[] {
  if (content.length === 0) {
    return []
  }
  const lines = content.replace(/\r\n/g, "\n").split("\n")
  if (lines.at(-1) === "") {
    lines.pop()
  }
  return lines
}