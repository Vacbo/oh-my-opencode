import {
  KEYWORD_DETECTORS,
  CODE_BLOCK_PATTERN,
  INLINE_CODE_PATTERN,
} from "./constants"
import { getDynamicKeywordDetectors } from "./dynamic-detectors"

export interface DetectedKeyword {
  type: string
  message: string
}

export function removeCodeBlocks(text: string): string {
  return text.replace(CODE_BLOCK_PATTERN, "").replace(INLINE_CODE_PATTERN, "")
}

/**
 * Resolves message to string, handling both static strings and dynamic functions.
 */
function resolveMessage(
  message: string | ((agentName?: string, modelID?: string) => string),
  agentName?: string,
  modelID?: string
): string {
  return typeof message === "function" ? message(agentName, modelID) : message
}

export function detectKeywords(text: string, agentName?: string, modelID?: string): string[] {
  const textWithoutCode = removeCodeBlocks(text)
  return KEYWORD_DETECTORS.filter(({ pattern }) =>
    pattern.test(textWithoutCode)
  ).map(({ message }) => resolveMessage(message, agentName, modelID))
}

export function detectKeywordsWithType(text: string, agentName?: string, modelID?: string): DetectedKeyword[] {
  const textWithoutCode = removeCodeBlocks(text)
  const staticTypes: Array<"ultrawork" | "search" | "analyze"> = ["ultrawork", "search", "analyze"]

  const staticResults = KEYWORD_DETECTORS.map(({ pattern, message }, index) => ({
    matches: pattern.test(textWithoutCode),
    type: staticTypes[index],
    message: resolveMessage(message, agentName, modelID),
  }))

  const dynamicResults = getDynamicKeywordDetectors().map(({ type, pattern, message }) => ({
    matches: pattern.test(textWithoutCode),
    type,
    message: resolveMessage(message, agentName, modelID),
  }))

  return [...staticResults, ...dynamicResults]
    .filter((result) => result.matches)
    .map(({ type, message }) => ({ type, message }))
}

export function extractPromptText(
  parts: Array<{ type: string; text?: string }>
): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => p.text || "")
    .join(" ")
}
