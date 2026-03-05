import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import type { RlmBlobVariable, RlmContextVariable } from "../../features/rlm-context/types"
import { RlmFinishInputSchema } from "./types"

export interface RlmContextManagerForFinish {
  getVariableByName(
    sessionId: string,
    name: string,
  ): Promise<RlmContextVariable | undefined> | RlmContextVariable | undefined

  readBlobContent(variable: RlmBlobVariable): Promise<string> | string
}

function jsonError(error: string, details: Record<string, unknown> = {}): string {
  return JSON.stringify({ error, ...details })
}

export function createRlmFinishTool(contextManager?: RlmContextManagerForFinish): ToolDefinition {
  return tool({
    description: "Session-terminal RLM tool. Accept exactly one of variable_name or value and return terminal JSON.",
    args: {
      variable_name: tool.schema.string().optional(),
      value: tool.schema.string().optional(),
    },
    execute: async (args, context): Promise<string> => {
      if (!contextManager) {
        return jsonError("context_manager_unavailable")
      }

      const parsed = RlmFinishInputSchema.safeParse(args)
      if (!parsed.success) {
        return jsonError("invalid_arguments")
      }

      if (parsed.data.variable_name !== undefined) {
        const variable = await contextManager.getVariableByName(context.sessionID, parsed.data.variable_name)
        if (!variable) {
          return jsonError("variable_not_found", { variable_name: parsed.data.variable_name })
        }
        if (variable.storageKind === "manifest") {
          return jsonError("manifest_not_allowed", { variable_name: parsed.data.variable_name })
        }

        const content = await contextManager.readBlobContent(variable)
        return JSON.stringify({ final_answer: content, source: "variable", terminal: true })
      }

      return JSON.stringify({ final_answer: parsed.data.value, source: "literal", terminal: true })
    },
  })
}
