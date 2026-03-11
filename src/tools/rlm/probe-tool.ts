import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import type { RlmConfig } from "../../config/schema/experimental"
import { getHiddenVariableName } from "../../features/rlm-context/turn-feedback"
import { coordinator } from "../../features/rlm-context/coordinator"
import { rlmError, toErrorJson, RlmErrorCode } from "../../features/rlm-context/error-codes"
import { detectSchema } from "./schema-detector"
import { RlmProbeInputSchema } from "./types"

const DEFAULT_PROBE_MAX_LINES = 200
const DEFAULT_VIEW_LINES = 50
const DEFAULT_LIST_PREVIEW_LINES = 3
const MAX_REF_PREVIEW_CHARS = 200

export function createRlmProbeTool(
  config?: Pick<RlmConfig, "probe_max_lines">,
): ToolDefinition {
  const probeMaxLines = config?.probe_max_lines ?? DEFAULT_PROBE_MAX_LINES

  return tool({
    description: "Bounded inspection of RLM variables (head, tail, slice, stats, schema, list_vars). Returns JSON only.",
    args: {
      operation: tool.schema.string(),
      variable_name: tool.schema.string().optional(),
      ref: tool.schema.string().optional(),
      lines: tool.schema.number().optional(),
      start: tool.schema.number().optional(),
      end: tool.schema.number().optional(),
    },
    execute: async (args, context): Promise<string> => {
      const { sessionID: chatSessionId } = context
      const binding = coordinator.resolve(chatSessionId)
      if (!binding) {
        return JSON.stringify(toErrorJson(rlmError(RlmErrorCode.SESSION_NOT_FOUND, { sessionID: chatSessionId })))
      }

      const contextManager = binding.manager

      const parsed = RlmProbeInputSchema.safeParse(args)
      if (!parsed.success) {
        return JSON.stringify(toErrorJson(rlmError(RlmErrorCode.INVALID_INPUT)))
      }

      const input = parsed.data
      const sessionId = binding.rlmSessionId

      if (input.operation === "list_vars") {
        const variables = await contextManager.listVariables(sessionId)
        const previewLines = Math.min(DEFAULT_LIST_PREVIEW_LINES, probeMaxLines)

        const summaries = await Promise.all(variables.map(async (variable) => {
          if (variable.storageKind === "blob") {
            const content = await contextManager.readBlobContent(variable)
            const preview = toLines(content).slice(0, previewLines)
            return {
              name: variable.name,
              storage_kind: variable.storageKind,
              semantic_type: variable.semanticType,
              byte_size: variable.byteSize,
              line_count: variable.lineCount,
              preview_line_count: preview.length,
              preview: preview.join("\n"),
            }
          }

          const names = await contextManager.readManifest(variable)
          return {
            name: variable.name,
            storage_kind: variable.storageKind,
            semantic_type: variable.semanticType,
            byte_size: variable.byteSize,
            item_count: names.length,
            item_preview: names.slice(0, probeMaxLines),
          }
        }))

        return JSON.stringify({ operation: "list_vars", variables: summaries })
      }

      if (input.operation === "inspect_ref") {
        const variableName = getHiddenVariableName(input.ref)
        if (!variableName) {
          return JSON.stringify(toErrorJson(rlmError(RlmErrorCode.INVALID_REF, { ref: input.ref })))
        }

        const variable = await contextManager.getVariableByName(sessionId, variableName)
        if (!variable) {
          return JSON.stringify(toErrorJson(rlmError(RlmErrorCode.VARIABLE_NOT_FOUND, { ref: input.ref, variable_name: variableName })))
        }
        if (variable.storageKind !== "blob") {
          return JSON.stringify(toErrorJson(rlmError(RlmErrorCode.INVALID_STORAGE_KIND, {
            expected_storage_kind: "blob",
            actual_storage_kind: variable.storageKind,
          })))
        }

        const content = await contextManager.readBlobContent(variable)
        return JSON.stringify({
          operation: "inspect_ref",
          ref: input.ref,
          variable_name: variable.name,
          preview: content.slice(0, MAX_REF_PREVIEW_CHARS),
        })
      }

      const variable = await contextManager.getVariableByName(sessionId, input.variable_name)
      if (!variable) {
        return JSON.stringify(toErrorJson(rlmError(RlmErrorCode.VARIABLE_NOT_FOUND, { variable_name: input.variable_name })))
      }

      if (input.operation === "stats") {
        if (variable.storageKind === "manifest") {
          const names = await contextManager.readManifest(variable)
          return JSON.stringify({
            operation: "stats",
            variable_name: variable.name,
            storage_kind: "manifest",
            semantic_type: variable.semanticType,
            byte_size: variable.byteSize,
            item_count: names.length,
          })
        }

        return JSON.stringify({
          operation: "stats",
          variable_name: variable.name,
          storage_kind: "blob",
          semantic_type: variable.semanticType,
          byte_size: variable.byteSize,
          line_count: variable.lineCount,
          source: variable.source,
        })
      }

      if (variable.storageKind !== "blob") {
        return JSON.stringify(toErrorJson(rlmError(RlmErrorCode.INVALID_STORAGE_KIND, {
          expected_storage_kind: "blob",
          actual_storage_kind: variable.storageKind,
        })))
      }

      const lines = toLines(await contextManager.readBlobContent(variable))

      if (input.operation === "schema") {
        return JSON.stringify({
          operation: "schema",
          variable_name: variable.name,
          storage_kind: "blob",
          schema: detectSchema(lines.join("\n"), lines),
        })
      }

      if (input.operation === "slice") {
        if (input.end < input.start) {
          return JSON.stringify(toErrorJson(rlmError(RlmErrorCode.INVALID_RANGE, { start: input.start, end: input.end })))
        }
        const boundedEnd = Math.min(input.end, input.start + probeMaxLines - 1)
        const range = lines.slice(input.start, boundedEnd + 1)
        return JSON.stringify({ operation: "slice", variable_name: variable.name, returned_lines: range.length, content: range.join("\n") })
      }

      const targetLines = clampRequestedLines(input.lines, probeMaxLines)
      if (input.operation === "head") {
        const selected = lines.slice(0, targetLines)
        return JSON.stringify({ operation: "head", variable_name: variable.name, returned_lines: selected.length, content: selected.join("\n") })
      }

      const selected = lines.slice(Math.max(0, lines.length - targetLines))
      return JSON.stringify({ operation: "tail", variable_name: variable.name, returned_lines: selected.length, content: selected.join("\n") })
    },
  })
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

function clampRequestedLines(lines: number | undefined, probeMaxLines: number): number {
  const requested = lines ?? DEFAULT_VIEW_LINES
  return Math.max(1, Math.min(requested, probeMaxLines))
}
