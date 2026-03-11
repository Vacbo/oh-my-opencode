import { tool, type ToolContext, type ToolDefinition } from "@opencode-ai/plugin/tool"
import type { RlmBlobVariable } from "../../features/rlm-context/types"
import { coordinator } from "../../features/rlm-context/coordinator"
import { rlmError, toErrorJson, RlmErrorCode } from "../../features/rlm-context/error-codes"
import { RlmSearchInputSchema } from "./types"

const DEFAULT_MAX_RESULTS = 20
const MAX_MAX_RESULTS = 100
const CONTEXT_RADIUS = 2
const MAX_EXCERPT_CHARS = 240
const DEFAULT_REGEX_TIMEOUT_MS = 75
const DEFAULT_MAX_REGEX_LINES = 10_000
const DEFAULT_MAX_REGEX_LINE_CHARS = 20_000

type SearchLineContext = { line_number: number; excerpt: string }
type SearchMatch = {
  line_number: number
  excerpt: string
  context_before: SearchLineContext[]
  context_after: SearchLineContext[]
}

export interface RlmSearchToolOptions {
  regexTimeoutMs?: number
  maxRegexLines?: number
  maxRegexLineChars?: number
  now?: () => number
}

const toJson = (payload: unknown): string => JSON.stringify(payload)

function toLines(content: string): string[] {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const lines = normalized.split("\n")
  if (lines.at(-1) === "") {
    lines.pop()
  }
  return lines
}

function toExcerpt(line: string): string {
  if (line.length <= MAX_EXCERPT_CHARS) {
    return line
  }
  return `${line.slice(0, MAX_EXCERPT_CHARS - 3)}...`
}

function buildContext(lines: string[], lineIndex: number, direction: -1 | 1): SearchLineContext[] {
  const entries: SearchLineContext[] = []
  if (direction < 0) {
    const start = Math.max(0, lineIndex - CONTEXT_RADIUS)
    for (let index = start; index < lineIndex; index += 1) {
      entries.push({ line_number: index + 1, excerpt: toExcerpt(lines[index]) })
    }
    return entries
  }

  const end = Math.min(lines.length - 1, lineIndex + CONTEXT_RADIUS)
  for (let index = lineIndex + 1; index <= end; index += 1) {
    entries.push({ line_number: index + 1, excerpt: toExcerpt(lines[index]) })
  }
  return entries
}

function createMatch(lines: string[], lineIndex: number): SearchMatch {
  return {
    line_number: lineIndex + 1,
    excerpt: toExcerpt(lines[lineIndex]),
    context_before: buildContext(lines, lineIndex, -1),
    context_after: buildContext(lines, lineIndex, 1),
  }
}

function createRegex(inputPattern: string): RegExp | { error: string } {
  try {
    return new RegExp(inputPattern)
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

function toMaxResults(inputMaxResults?: number): number {
  return Math.min(inputMaxResults ?? DEFAULT_MAX_RESULTS, MAX_MAX_RESULTS)
}

export function createRlmSearchTool(
  options: RlmSearchToolOptions = {},
): ToolDefinition {
  const now = options.now ?? Date.now
  const regexTimeoutMs = options.regexTimeoutMs ?? DEFAULT_REGEX_TIMEOUT_MS
  const maxRegexLines = options.maxRegexLines ?? DEFAULT_MAX_REGEX_LINES
  const maxRegexLineChars = options.maxRegexLineChars ?? DEFAULT_MAX_REGEX_LINE_CHARS

  return tool({
    description: "Search RLM blob variables using literal or regex mode, returning bounded matches with line numbers and nearby context.",
    args: {
      variable_name: tool.schema.string().describe("Name of the blob variable to search"),
      pattern: tool.schema.string().describe("Literal substring or regex pattern to search"),
      mode: tool.schema.enum(["literal", "regex"]).optional().describe("Search mode (default: literal)"),
      max_results: tool.schema.number().int().min(1).optional().describe("Maximum matches to return (bounded internally)"),
    },
    execute: async (args: unknown, context: ToolContext): Promise<string> => {
      const { sessionID: chatSessionId } = context
      const binding = coordinator.resolve(chatSessionId)
      if (!binding) {
        return toJson(toErrorJson(rlmError(RlmErrorCode.SESSION_NOT_FOUND, undefined, { sessionID: chatSessionId })))
      }

      const contextManager = binding.manager

      const parsed = RlmSearchInputSchema.safeParse(args)
      if (!parsed.success) {
        return toJson(toErrorJson(rlmError(RlmErrorCode.INVALID_INPUT)))
      }
      if (parsed.data.pattern.length === 0) {
        return toJson(toErrorJson(rlmError(RlmErrorCode.INVALID_PATTERN, "pattern must not be empty")))
      }

      const variable = await contextManager.getVariableByName(binding.rlmSessionId, parsed.data.variable_name)
      if (!variable) {
        return toJson(toErrorJson(rlmError(RlmErrorCode.VARIABLE_NOT_FOUND, undefined, { variable_name: parsed.data.variable_name })))
      }
      if (variable.storageKind !== "blob") {
        return toJson(toErrorJson(rlmError(RlmErrorCode.UNSUPPORTED_VARIABLE_KIND, "rlm_search currently supports blob variables only", {
          variable_name: parsed.data.variable_name,
          storage_kind: variable.storageKind,
        })))
      }

      const content = await contextManager.readBlobContent(variable as RlmBlobVariable)
      const lines = toLines(content)
      const maxResults = toMaxResults(parsed.data.max_results)
      const matches: SearchMatch[] = []
      let truncated = false

      if (parsed.data.mode === "literal") {
        for (let index = 0; index < lines.length; index += 1) {
          if (!lines[index].includes(parsed.data.pattern)) {
            continue
          }
          matches.push(createMatch(lines, index))
          if (matches.length >= maxResults) {
            truncated = true
            break
          }
        }
      } else {
        const regex = createRegex(parsed.data.pattern)
        if (!(regex instanceof RegExp)) {
          return toJson(toErrorJson(rlmError(RlmErrorCode.REGEX_ERROR, regex.error, { pattern: parsed.data.pattern })))
        }

        const startedAt = now()
        for (let index = 0; index < lines.length; index += 1) {
          if (index + 1 > maxRegexLines) {
            return toJson(toErrorJson(rlmError(RlmErrorCode.REGEX_GUARD_FAILURE, undefined, {
              reason: "line_limit_exceeded",
              max_lines: maxRegexLines,
              line_count: lines.length,
            })))
          }
          if (now() - startedAt > regexTimeoutMs) {
            return toJson(toErrorJson(rlmError(RlmErrorCode.REGEX_TIMEOUT, undefined, { timeout_ms: regexTimeoutMs, lines_scanned: index })))
          }
          if (lines[index].length > maxRegexLineChars) {
            return toJson(toErrorJson(rlmError(RlmErrorCode.REGEX_GUARD_FAILURE, undefined, {
              reason: "line_too_long",
              max_line_chars: maxRegexLineChars,
              line_number: index + 1,
              line_char_count: lines[index].length,
            })))
          }

          regex.lastIndex = 0
          if (!regex.test(lines[index])) {
            continue
          }
          matches.push(createMatch(lines, index))
          if (matches.length >= maxResults) {
            truncated = true
            break
          }
        }
      }

      return toJson({
        variable_name: parsed.data.variable_name,
        mode: parsed.data.mode,
        pattern: parsed.data.pattern,
        max_results: maxResults,
        result_count: matches.length,
        truncated,
        matches,
      })
    },
  })
}
