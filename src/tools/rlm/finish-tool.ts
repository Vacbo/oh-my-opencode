import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import type { RlmBlobVariable } from "../../features/rlm-context/types"
import { coordinator } from "../../features/rlm-context/coordinator"
import { rlmError, toErrorJson, RlmErrorCode } from "../../features/rlm-context/error-codes"
import { RlmFinishInputSchema } from "./types"

export function createRlmFinishTool(): ToolDefinition {
  return tool({
    description: "Session-terminal RLM tool. Accept exactly one of variable_name or value and return terminal JSON.",
    args: {
      variable_name: tool.schema.string().optional(),
      value: tool.schema.string().optional(),
    },
    execute: async (args, context): Promise<string> => {
      const { sessionID: chatSessionId } = context
      const binding = coordinator.resolve(chatSessionId)
      if (!binding) {
        return JSON.stringify(toErrorJson(rlmError(RlmErrorCode.SESSION_NOT_FOUND, { sessionID: chatSessionId })))
      }

      const contextManager = binding.manager

      const parsed = RlmFinishInputSchema.safeParse(args)
      if (!parsed.success) {
        return JSON.stringify(toErrorJson(rlmError(RlmErrorCode.INVALID_INPUT)))
      }

      if (parsed.data.variable_name !== undefined) {
        const variable = await contextManager.getVariableByName(binding.rlmSessionId, parsed.data.variable_name)
        if (!variable) {
          return JSON.stringify(toErrorJson(rlmError(RlmErrorCode.VARIABLE_NOT_FOUND, { variable_name: parsed.data.variable_name })))
        }
        if (variable.storageKind === "manifest") {
          return JSON.stringify(toErrorJson(rlmError(RlmErrorCode.MANIFEST_REJECTED, { variable_name: parsed.data.variable_name })))
        }

        const content = await contextManager.readBlobContent(variable as RlmBlobVariable)
        return JSON.stringify({ final_answer: content, source: "variable", terminal: true })
      }

      return JSON.stringify({ final_answer: parsed.data.value, source: "literal", terminal: true })
    },
  })
}
