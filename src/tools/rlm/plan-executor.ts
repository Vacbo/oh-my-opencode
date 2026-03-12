import type { ToolContext } from "@opencode-ai/plugin/tool"
import { RlmConfigSchema } from "../../config/schema/experimental"
import { createSessionBudget } from "../../features/rlm-context/budget"
import { coordinator, type RlmContextManagerLike } from "../../features/rlm-context/coordinator"
import { detectContextRot, shouldCheckContextRot } from "../../features/rlm-context/context-rot"
import { rlmError, toErrorJson, RlmErrorCode } from "../../features/rlm-context/error-codes"
import { log } from "../../shared/logger"
import { createFinalVarResult, executePlanOperation as executePlanOp } from "./plan-operation-runner"
import type { RlmPlanInput } from "./types"
import type { RlmPlanToolOptions } from "./plan-tool"
import {
  defaultRlmPlanExecutorDeps,
  type RlmPlanExecutorDeps,
} from "./plan-deps"
import { requireSession } from "./plan-utils"
import { createProgressEmitter } from "./progress-emitter"
import { lookupSiblingCacheResult } from "./sibling-cache"
import { buildRlmSystemPrompt } from "./system-prompt"

const toPlanResult = (payload: Record<string, unknown>): string => JSON.stringify(payload)

function toOperationArgs(operation: RlmPlanInput["operations"][number]): Record<string, unknown> {
  return { ...operation }
}

function hiddenVariableNameFromRef(ref: unknown): string | undefined {
  if (typeof ref !== "string" || !ref.startsWith("hidden://")) {
    return undefined
  }
  return `__hidden_${ref.slice("hidden://".length)}`
}

function getCreatedVariables(
  operation: RlmPlanInput["operations"][number],
  result: Record<string, unknown>,
): string[] {
  const variables = new Set<string>()

  if (operation.op === "write_var") {
    variables.add(operation.variable_name)
  }

  if (typeof result.output_variable === "string") {
    variables.add(result.output_variable)
  }

  const hiddenVariable = hiddenVariableNameFromRef(result.output_ref)
  if (hiddenVariable) {
    variables.add(hiddenVariable)
  }

  return Array.from(variables)
}

function runContextRotCheck(
  chatSessionId: string,
  rlmSessionId: string,
  planSpanId: string | undefined,
  rlmConfig: ReturnType<typeof RlmConfigSchema.parse>,
): void {
  const binding = coordinator.resolve(chatSessionId)
  const tracer = binding?.tracer
  const contextRotConfig = rlmConfig.context_rot
  if (!tracer || !contextRotConfig?.enabled) {
    return
  }

  const spans = tracer.getSpans(rlmSessionId)
  const operationCount = spans.filter((span) => span.operation_name !== undefined && span.operation_name !== "context_rot_check").length
  if (!shouldCheckContextRot(operationCount, contextRotConfig)) {
    return
  }

  const signal = detectContextRot(spans, contextRotConfig)
  const span = tracer.startSpan(chatSessionId, rlmSessionId, "plan.context_rot", planSpanId, {
    operation_name: "context_rot_check",
    operation_args: { after_operations: operationCount },
    metadata: { signal },
  })
  tracer.endSpan(span.spanId, "ok")
}

export async function executeRlmPlan(
  contextManager: RlmContextManagerLike,
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

  const rlmConfig = options.config ?? RlmConfigSchema.parse({})
  coordinator.initializeRootBudget(
    context.sessionID,
    createSessionBudget(rlmConfig, binding.rootRlmSessionId ?? binding.rlmSessionId),
  )

  const rlmSessionId = binding.rlmSessionId
  const chatSessionId = context.sessionID
  const tracer = binding.tracer
  const session = await requireSession(contextManager, rlmSessionId)
  const opResults: Array<Record<string, unknown>> = []

  const siblingCacheResult = await lookupSiblingCacheResult({
    cache: rlmConfig.cache,
    cacheDir: options.siblingCache?.cacheDir,
    sessionId: binding.rootRlmSessionId ?? rlmSessionId,
    rootQuery: session.rootQuery,
    model: options.subcallModel?.modelID,
    provider: options.subcallModel?.providerID,
    version: options.siblingCache?.version,
    temperature: options.siblingCache?.temperature,
    systemPrompt: options.siblingCache?.systemPrompt
      ?? buildRlmSystemPrompt({
        depth: binding.depth,
        maxDepth: session.maxDepth,
        contextMetadata: { contextVariableName: binding.contextVariableName },
        mode: "canonical",
        printLimitBytes: rlmConfig.exec?.print_limit_bytes,
      }),
  })
  if (siblingCacheResult) {
    log("[rlm-plan] sibling cache hit", {
      sessionID: chatSessionId,
      rlmSessionId,
      rootRlmSessionId: binding.rootRlmSessionId ?? rlmSessionId,
    })
    return siblingCacheResult
  }

  const planSpan = tracer?.startSpan(chatSessionId, rlmSessionId, "plan.execute")

  const progressConfig = rlmConfig.progress
  const progressEmitter = progressConfig?.enabled
    ? createProgressEmitter({
        throttleMs: progressConfig.throttle_ms,
        streamingEnabled: progressConfig.streaming_enabled ?? true,
        streamingThrottleMs: progressConfig.streaming_throttle_ms ?? 100,
        offloadThresholdBytes: rlmConfig.feedback?.output_threshold_bytes,
      }, log)
    : undefined

  for (let opIndex = 0; opIndex < args.operations.length; opIndex += 1) {
    const operation = args.operations[opIndex]
    const opSpan = tracer?.startSpan(chatSessionId, rlmSessionId, `plan.op.${operation.op}`, planSpan?.spanId, {
      operation_name: operation.op,
      operation_args: toOperationArgs(operation),
    })
    const opStartTime = Date.now()

    progressEmitter?.emitBefore(chatSessionId, rlmSessionId, opIndex, args.operations.length, operation.op)

    try {
      if (operation.op === "final_var") {
        tracer?.endSpan(opSpan!.spanId, "ok", undefined, { variables_created: [] })
        runContextRotCheck(chatSessionId, rlmSessionId, planSpan?.spanId, rlmConfig)
        tracer?.endSpan(planSpan!.spanId, "ok")
        return toPlanResult(createFinalVarResult(chatSessionId, operation, opIndex, opResults))
      }

      const opResult = await executePlanOp(contextManager, options, context, rlmSessionId, session, operation, deps, rlmConfig)

      if (!opResult) {
        continue
      }

      opResults.push({ op: operation.op, ...opResult })
      tracer?.endSpan(opSpan!.spanId, "ok", undefined, { variables_created: getCreatedVariables(operation, opResult) })
      runContextRotCheck(chatSessionId, rlmSessionId, planSpan?.spanId, rlmConfig)
      const opDuration = Date.now() - opStartTime
      progressEmitter?.emitAfter(chatSessionId, rlmSessionId, opIndex, args.operations.length, operation.op, opDuration)
      const percent = Math.round(((opIndex + 1) / args.operations.length) * 100)
      progressEmitter?.emitStreamingResult(chatSessionId, rlmSessionId, opIndex, operation.op, JSON.stringify(opResult), percent)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      tracer?.endSpan(opSpan!.spanId, "error", errorMsg)
      tracer?.endSpan(planSpan!.spanId, "error", errorMsg)
      progressEmitter?.emitAfter(chatSessionId, rlmSessionId, opIndex, args.operations.length, operation.op, Date.now() - opStartTime, errorMsg)
      return toPlanResult(toErrorJson(rlmError(RlmErrorCode.PLAN_OP_FAILED, { message: errorMsg, op_index: opIndex, op: operation.op })))
    }
  }

  const budget = coordinator.getBudgetSummary(context.sessionID)
  tracer?.endSpan(planSpan!.spanId, "ok")
  return toPlanResult({
    terminal: false,
    halted: false,
    executed_ops: args.operations.length,
    operation_results: opResults,
    ...(budget ? { budget } : {}),
  })
}
