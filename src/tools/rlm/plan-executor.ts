import type { ToolContext } from "@opencode-ai/plugin/tool"
import { RlmConfigSchema } from "../../config/schema/experimental"
import { coordinator } from "../../features/rlm-context/coordinator"
import { rlmError, toErrorJson, RlmErrorCode } from "../../features/rlm-context/error-codes"
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
import { executeExecOperation } from "./exec-op"
import { requireSession } from "./plan-utils"

const toPlanResult = (payload: Record<string, unknown>): string => JSON.stringify(payload)

export async function executeRlmPlan(
  contextManager: RlmContextManagerForPlan,
  options: RlmPlanToolOptions,
  args: RlmPlanInput,
  context: ToolContext,
  depsInput: Partial<RlmPlanExecutorDeps> = {},
): Promise<string> {
  const deps: RlmPlanExecutorDeps = { ...defaultRlmPlanExecutorDeps, ...depsInput }
  const binding = coordinator.resolve(context.sessionID)
  if (!binding) {
    return toPlanResult(toErrorJson(rlmError(RlmErrorCode.SESSION_NOT_FOUND)))
  }
  const rlmSessionId = binding.rlmSessionId
  const chatSessionId = context.sessionID
  const tracer = binding.tracer
  const session = await requireSession(contextManager, rlmSessionId)
  const opResults: Array<Record<string, unknown>> = []

  const planSpan = tracer?.startSpan(chatSessionId, rlmSessionId, "plan.execute")

  for (let opIndex = 0; opIndex < args.operations.length; opIndex += 1) {
    const operation = args.operations[opIndex]
    const opSpan = tracer?.startSpan(chatSessionId, rlmSessionId, `plan.op.${operation.op}`, planSpan?.spanId)

    try {
      if (operation.op === "split") {
        opResults.push({ op: operation.op, ...(await executeSplitOperation(contextManager, rlmSessionId, operation)) })
        tracer?.endSpan(opSpan!.spanId, "ok")
        continue
      }
      if (operation.op === "select") {
        opResults.push({ op: operation.op, ...(await executeSelectOperation(contextManager, rlmSessionId, operation)) })
        tracer?.endSpan(opSpan!.spanId, "ok")
        continue
      }
      if (operation.op === "map_llm") {
        opResults.push({ op: operation.op, ...(await executeMapLlmOperation(contextManager, options, context, rlmSessionId, session, operation, deps)) })
        tracer?.endSpan(opSpan!.spanId, "ok")
        continue
      }
      if (operation.op === "map_rlm") {
        opResults.push({ op: operation.op, ...(await executeMapRlmOperation(contextManager, options, context, rlmSessionId, session, operation, deps)) })
        tracer?.endSpan(opSpan!.spanId, "ok")
        continue
      }
      if (operation.op === "concat") {
        opResults.push({ op: operation.op, ...(await executeConcatOperation(contextManager, rlmSessionId, operation)) })
        tracer?.endSpan(opSpan!.spanId, "ok")
        continue
      }
      if (operation.op === "reduce_llm") {
        opResults.push({ op: operation.op, ...(await executeReduceLlmOperation(contextManager, options, context, rlmSessionId, session, operation, deps)) })
        tracer?.endSpan(opSpan!.spanId, "ok")
        continue
      }
      if (operation.op === "exec") {
        opResults.push({
          op: operation.op,
          ...(await executeExecOperation(
            contextManager,
            options,
            context,
            rlmSessionId,
            operation,
            deps.replBackend,
            options.config ?? RlmConfigSchema.parse({}),
          )),
        })
        tracer?.endSpan(opSpan!.spanId, "ok")
        continue
      }
      if (operation.op === "write_var") {
        opResults.push({ op: operation.op, ...(await executeWriteVarOperation(contextManager, rlmSessionId, operation)) })
        tracer?.endSpan(opSpan!.spanId, "ok")
        continue
      }
      if (operation.op === "final_var") {
        tracer?.endSpan(opSpan!.spanId, "ok")
        tracer?.endSpan(planSpan!.spanId, "ok")
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
      const errorMsg = error instanceof Error ? error.message : String(error)
      tracer?.endSpan(opSpan!.spanId, "error", errorMsg)
      tracer?.endSpan(planSpan!.spanId, "error", errorMsg)
      return toPlanResult(toErrorJson(rlmError(RlmErrorCode.PLAN_OP_FAILED, errorMsg, {
        op_index: opIndex,
        op: operation.op,
      })))
    }
  }

  tracer?.endSpan(planSpan!.spanId, "ok")
  return toPlanResult({
    terminal: false,
    halted: false,
    executed_ops: args.operations.length,
    operation_results: opResults,
  })
}
