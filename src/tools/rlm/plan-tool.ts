import type { PluginInput } from "@opencode-ai/plugin"
import { tool, type ToolContext, type ToolDefinition } from "@opencode-ai/plugin/tool"
import type {
  RlmBlobVariable,
  RlmContextVariable,
  RlmManifestVariable,
  RlmSemanticType,
  RlmSessionState,
} from "../../features/rlm-context/types"
import type { RlmConfig } from "../../config/schema/experimental"
import { coordinator } from "../../features/rlm-context/coordinator"
import { createTracer } from "../../features/rlm-context/tracer"
import { rlmError, toErrorJson, RlmErrorCode } from "../../features/rlm-context/error-codes"
import { executeRlmPlan } from "./plan-executor"
import type { RlmPlanExecutorDeps } from "./plan-deps"
import { RlmPlanInputSchema } from "./types"

const MAX_PLAN_OPERATIONS = 50

export interface RlmContextManagerForPlan {
  initSession(
    sessionId: string,
    options: {
      maxDepth: number
      contextDir: string
      query: string
      depth?: number
      parentSessionId?: string
      shouldDistill?: boolean
    },
  ): RlmSessionState | Promise<RlmSessionState>
  getSession(
    sessionId: string,
  ): RlmSessionState | undefined | Promise<RlmSessionState | undefined>
  getVariableByName(
    sessionId: string,
    name: string,
  ): RlmContextVariable | undefined | Promise<RlmContextVariable | undefined>
  createBlobVariable(
    sessionId: string,
    input: { name: string; content?: string; file_path?: string },
    options?: { semanticType?: RlmSemanticType },
  ): RlmBlobVariable | Promise<RlmBlobVariable>
  createManifestVariable(
    sessionId: string,
    input: { name: string; variableNames: string[] },
    options?: { semanticType?: RlmSemanticType },
  ): RlmManifestVariable | Promise<RlmManifestVariable>
  readBlobContent(variable: RlmBlobVariable): string | Promise<string>
  resolveManifestItems(
    sessionId: string,
    manifestName: string,
  ): RlmBlobVariable[] | Promise<RlmBlobVariable[]>
  deleteSession(sessionId: string): void | Promise<void>
}

export interface RlmPlanToolOptions {
  client: PluginInput["client"]
  directory: string
  subcallAgent?: string
  subcallModel?: { providerID: string; modelID: string; variant?: string }
  deps?: Partial<RlmPlanExecutorDeps>
  config?: RlmConfig
}

const toJson = (payload: unknown): string => JSON.stringify(payload)

function parsePlanArgs(args: unknown):
  | { ok: true; value: { operations: Array<Record<string, unknown>> } }
  | { ok: false } {
  if (!args || typeof args !== "object") {
    return { ok: false }
  }
  const record = args as Record<string, unknown>
  if (!Array.isArray(record.operations)) {
    return { ok: false }
  }
  return {
    ok: true,
    value: { operations: record.operations as Array<Record<string, unknown>> },
  }
}

export function createRlmPlanTool(
  options: RlmPlanToolOptions,
): ToolDefinition {
  return tool({
    description: "Execute a manifest-aware RLM plan with split/select/map/concat/reduce/exec/write/final operations.",
    args: {
      operations: tool.schema.array(tool.schema.unknown()).describe("Ordered list of plan operations"),
    },
    execute: async (args: unknown, context: ToolContext): Promise<string> => {
      const binding = coordinator.resolve(context.sessionID)
      if (!binding) {
        return toJson(toErrorJson(rlmError(RlmErrorCode.SESSION_NOT_FOUND)))
      }

      if (!binding.tracer && options.config?.tracing) {
        binding.tracer = createTracer(options.config.tracing)
      }

      const contextManager = binding.manager

      const coarse = parsePlanArgs(args)
      if (!coarse.ok) {
        return toJson(toErrorJson(rlmError(RlmErrorCode.INVALID_INPUT)))
      }

      const parsed = RlmPlanInputSchema.safeParse(coarse.value)
      if (!parsed.success) {
        return toJson(toErrorJson(rlmError(RlmErrorCode.INVALID_INPUT)))
      }

      if (parsed.data.operations.length > MAX_PLAN_OPERATIONS) {
        return toJson(toErrorJson(rlmError(RlmErrorCode.TOO_MANY_OPERATIONS, undefined, {
          max_operations: MAX_PLAN_OPERATIONS,
          operation_count: parsed.data.operations.length,
        })))
      }

      return executeRlmPlan(
        contextManager,
        options,
        parsed.data,
        context,
        options.deps,
      )
    },
  })
}
