import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { RlmPlanInput } from "./types"
import type { RlmContextManagerForPlan, RlmPlanToolOptions } from "./plan-tool"
import {
  executeConcatOperation,
  executeSelectOperation,
  executeSplitOperation,
  executeWriteVarOperation,
} from "./plan-basic-ops"
import {
  executeMapLlmOperation,
  executeMapRlmOperation,
  executeReduceLlmOperation,
} from "./plan-subcall-ops"
import {
  defaultRlmPlanExecutorDeps,
  type RlmPlanExecutorDeps,
} from "./plan-deps"
import { requireSession } from "./plan-utils"
import { executeExecOperation } from "./exec-op"

const toPlanResult = (payload: Record<string, unknown>): string => JSON.stringify(payload)

export async function executeRlmPlan(
  contextManager: RlmContextManagerForPlan,
  options: RlmPlanToolOptions,
  args: RlmPlanInput,
  context: ToolContext,
  depsInput: Partial<RlmPlanExecutorDeps> = {},
): Promise<string> {
  const deps: RlmPlanExecutorDeps = { ...defaultRlmPlanExecutorDeps, ...depsInput }
  const session = await requireSession(contextManager, context.sessionID)
  const opResults: Array<Record<string, unknown>> = []

  for (let opIndex = 0; opIndex < args.operations.length; opIndex += 1) {
    const operation = args.operations[opIndex]

    try {
      if (operation.op === "split") {
        opResults.push({ op: operation.op, ...(await executeSplitOperation(contextManager, context, operation)) })
        continue
      }
      if (operation.op === "select") {
        opResults.push({ op: operation.op, ...(await executeSelectOperation(contextManager, context, operation)) })
        continue
      }
      if (operation.op === "map_llm") {
        opResults.push({ op: operation.op, ...(await executeMapLlmOperation(contextManager, options, context, session, operation, deps)) })
        continue
      }
      if (operation.op === "map_rlm") {
        opResults.push({ op: operation.op, ...(await executeMapRlmOperation(contextManager, options, context, session, operation, deps)) })
        continue
      }
      if (operation.op === "concat") {
        opResults.push({ op: operation.op, ...(await executeConcatOperation(contextManager, context, operation)) })
        continue
      }
      if (operation.op === "reduce_llm") {
        opResults.push({ op: operation.op, ...(await executeReduceLlmOperation(contextManager, options, context, session, operation, deps)) })
        continue
      }
      if (operation.op === "write_var") {
        opResults.push({ op: operation.op, ...(await executeWriteVarOperation(contextManager, context, operation)) })
        continue
      }
      if (operation.op === "exec") {
        opResults.push({ op: operation.op, ...(await executeExecOperation(contextManager, options, context, operation, deps.replBackend, options.config)) })
        continue
      }
      if (operation.op === "final_var") {
        return toPlanResult({
          terminal: false,
          halted: true,
          result_variable: operation.variable_name,
          final_variable: operation.variable_name,
          executed_ops: opIndex + 1,
          operation_results: opResults,
        })
      }
    } catch (error) {
      return toPlanResult({
        error: "plan_execution_error",
        op_index: opIndex,
        op: operation.op,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return toPlanResult({
    terminal: false,
    halted: false,
    executed_ops: args.operations.length,
    operation_results: opResults,
  })
}
