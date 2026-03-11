import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { RlmConfig } from "../../config/schema/experimental"
import type { RlmPlanExecutorDeps } from "./plan-deps"
import type { RlmContextManagerForPlan, RlmPlanToolOptions } from "./plan-tool"
import { assertExecTrusted } from "./repl-exec-config"
import { readBlobContent, upsertBlobVariable } from "./repl-variable-bridge"
import { coordinator } from "../../features/rlm-context/coordinator"

type OffloadedOutput = {
  ref: string
  variableName: string
}

export async function executeExecOperation(
  contextManager: RlmContextManagerForPlan,
  options: RlmPlanToolOptions,
  context: ToolContext,
  rlmSessionId: string,
  operation: { op: "exec"; code: string; output_variable?: string },
  replBackend: RlmPlanExecutorDeps["replBackend"],
  config: RlmConfig,
): Promise<{ executed: true; output_variable?: string; output_ref?: string }> {
  const { sessionID: chatSessionId } = context
  const tracer = coordinator.resolve(chatSessionId)?.tracer
  const execSpan = tracer?.startSpan(chatSessionId, rlmSessionId, "exec")
  try {
    const binding = assertExecTrusted(chatSessionId, config)
    const output = await replBackend.execute(operation.code, {
      sessionID: chatSessionId,
      rlmSessionId,
      query: binding.query,
      manager: binding.manager,
      toolContext: context,
      client: options.client,
      directory: options.directory,
      subcallAgent: options.subcallAgent,
      subcallModel: options.subcallModel,
      config,
    })
    const offloaded = parseOffloadedOutput(output)

    if (operation.output_variable) {
      const storedOutput = offloaded
        ? await readBlobContent(contextManager, rlmSessionId, offloaded.variableName)
        : output
      await upsertBlobVariable(
        contextManager,
        rlmSessionId,
        operation.output_variable,
        storedOutput,
      )
    }

    tracer?.endSpan(execSpan!.spanId, "ok")
    return {
      executed: true,
      ...(operation.output_variable ? { output_variable: operation.output_variable } : {}),
      ...(offloaded ? { output_ref: offloaded.ref } : {}),
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    tracer?.endSpan(execSpan!.spanId, "error", errorMsg)
    throw error
  }
}

function parseOffloadedOutput(output: string): OffloadedOutput | undefined {
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>
    if (typeof parsed.ref === "string" && typeof parsed.variableName === "string") {
      return {
        ref: parsed.ref,
        variableName: parsed.variableName,
      }
    }
  } catch (_error) {
    return undefined
  }
  return undefined
}
