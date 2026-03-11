import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import type { RlmBlobVariable } from "../../features/rlm-context/types"
import { coordinator } from "../../features/rlm-context/coordinator"
import { RlmFinishInputSchema } from "./types"

function jsonError(error: string, details: Record<string, unknown> = {}): string {
  return JSON.stringify({ error, ...details })
}

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
        return jsonError("session_not_found", { sessionID: chatSessionId })
      }

      const contextManager = binding.manager

      const parsed = RlmFinishInputSchema.safeParse(args)
      if (!parsed.success) {
        return jsonError("invalid_arguments")
      }

      if (parsed.data.variable_name !== undefined) {
        const variable = await contextManager.getVariableByName(binding.rlmSessionId, parsed.data.variable_name)
        if (!variable) {
          return jsonError("variable_not_found", { variable_name: parsed.data.variable_name })
        }
        if (variable.storageKind === "manifest") {
          return jsonError("manifest_not_allowed", { variable_name: parsed.data.variable_name })
        }

        const content = await contextManager.readBlobContent(variable as RlmBlobVariable)
        return JSON.stringify({ final_answer: content, source: "variable", terminal: true })
      }

      return JSON.stringify({ final_answer: parsed.data.value, source: "literal", terminal: true })
    },
  })
}
