import type { ToolContext } from "@opencode-ai/plugin/tool"
import { coordinator, type RlmContextManagerLike } from "../../features/rlm-context/coordinator"
import type { RlmSessionState } from "../../features/rlm-context/types"
import {
  executeConcatOperation,
  executeSelectOperation,
  executeSplitCodeOperation,
  executeSplitOperation,
  executeWriteVarOperation,
} from "./plan-basic-ops"
import { executeExecOperation } from "./exec-op"
import type { RlmPlanExecutorDeps } from "./plan-deps"
import {
  executeParallelMapLlmOperation,
  executeParallelMapRlmOperation,
} from "./parallel-executor"
import type { RlmPlanToolOptions } from "./plan-tool"
import { executeMapLlmOperation, executeMapRlmOperation, executeReduceLlmOperation } from "./plan-subcall-ops"
import type { RlmPlanInput } from "./types"

type RlmPlanOperation = RlmPlanInput["operations"][number]

export async function executePlanOperation(
  contextManager: RlmContextManagerLike,
  options: RlmPlanToolOptions,
  context: ToolContext,
  rlmSessionId: string,
  session: RlmSessionState,
  operation: RlmPlanOperation,
  deps: RlmPlanExecutorDeps,
  rlmConfig: NonNullable<RlmPlanToolOptions["config"]>,
): Promise<Record<string, unknown> | undefined> {
  const shouldParallelizeMap = rlmConfig.parallel_map_concurrency > 1
  if (operation.op === "split") return executeSplitOperation(contextManager, rlmSessionId, operation)
  if (operation.op === "split_code") return executeSplitCodeOperation(contextManager, rlmSessionId, operation)
  if (operation.op === "select") return executeSelectOperation(contextManager, rlmSessionId, operation)
  if (operation.op === "map_llm") {
    return shouldParallelizeMap
      ? executeParallelMapLlmOperation(contextManager, options, context, rlmSessionId, session, operation, deps)
      : executeMapLlmOperation(contextManager, options, context, rlmSessionId, session, operation, deps)
  }
  if (operation.op === "map_rlm") {
    return shouldParallelizeMap
      ? executeParallelMapRlmOperation(contextManager, options, context, rlmSessionId, session, operation, deps)
      : executeMapRlmOperation(contextManager, options, context, rlmSessionId, session, operation, deps)
  }
  if (operation.op === "concat") return executeConcatOperation(contextManager, rlmSessionId, operation)
  if (operation.op === "reduce_llm") return executeReduceLlmOperation(contextManager, options, context, rlmSessionId, session, operation, deps)
  if (operation.op === "exec") {
    return executeExecOperation(contextManager, options, context, rlmSessionId, operation, deps.replBackend, rlmConfig)
  }
  if (operation.op === "write_var") return executeWriteVarOperation(contextManager, rlmSessionId, operation)
  return undefined
}

export function createFinalVarResult(
  chatSessionId: string,
  operation: Extract<RlmPlanOperation, { op: "final_var" }>,
  opIndex: number,
  opResults: Array<Record<string, unknown>>,
): Record<string, unknown> {
  const budget = coordinator.getBudgetSummary(chatSessionId)
  return {
    terminal: false,
    halted: true,
    result_variable: operation.variable_name,
    final_variable: operation.variable_name,
    executed_ops: opIndex + 1,
    operation_results: opResults,
    ...(budget ? { budget } : {}),
  }
}
