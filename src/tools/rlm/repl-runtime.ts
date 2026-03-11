import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { RlmConfig } from "../../config/schema/experimental"
import type { RlmContextManagerLike } from "../../features/rlm-context/coordinator"
import { applyFeedback } from "../../features/rlm-context/turn-feedback"
import { normalizeExecError } from "./repl-exec-errors"
import { assertExecTrusted, resolveRlmExecConfig } from "./repl-exec-config"
import {
  formatPrintedValue,
  readBlobContent,
  toStoredContent,
  truncatePrintedOutput,
  upsertBlobVariable,
} from "./repl-variable-bridge"
import {
  cleanupSyncSubcallSession,
  runSyncSubcall,
} from "./subcall-runner"
import { createVmSandboxRlmReplBackend } from "./vm-sandbox"

type RlmSubcallModel = { providerID: string; modelID: string; variant?: string }
type RlmLlmQueryOptions = { title?: string }
type RlmReplBackendConfig = RlmConfig & { sandbox?: { enabled?: boolean } }
type AsyncFunctionConstructor = new (
  ...args: string[]
) => (scope: Record<string, unknown>) => Promise<unknown>

const AsyncFunction = Object.getPrototypeOf(async function noop() {}).constructor as AsyncFunctionConstructor
const sessionNamespaces = new Map<string, Record<string, unknown>>()
const helperNames = new Set(["getQuery", "getVar", "llm_query", "print", "setVar"])

export interface RlmReplContext {
  sessionID: string
  rlmSessionId: string
  query: string
  manager: RlmContextManagerLike
  toolContext: ToolContext
  client: PluginInput["client"]
  directory: string
  subcallAgent?: string
  subcallModel?: RlmSubcallModel
  config: RlmConfig
}

export interface RlmReplBackend {
  execute(code: string, context: RlmReplContext): Promise<string>
}

interface RlmReplBackendDeps {
  cleanupSyncSubcallSession: typeof cleanupSyncSubcallSession
  runSyncSubcall: typeof runSyncSubcall
}

export function clearRlmReplNamespace(sessionID?: string): void {
  if (sessionID) {
    sessionNamespaces.delete(sessionID)
    return
  }
  sessionNamespaces.clear()
}

export function createRlmReplBackend(config: RlmReplBackendConfig): RlmReplBackend {
  const backend = config.sandbox?.enabled
    ? createVmSandboxRlmReplBackend()
    : createTrustedLocalRlmReplBackend()

  return {
    execute: async (code, context) => {
      try {
        return await backend.execute(code, context)
      } catch (error) {
        throw normalizeExecError(error)
      }
    },
  }
}

export function createTrustedLocalRlmReplBackend(
  deps: Partial<RlmReplBackendDeps> = {},
): RlmReplBackend {
  const runtimeDeps: RlmReplBackendDeps = {
    cleanupSyncSubcallSession,
    runSyncSubcall,
    ...deps,
  }

  return {
    execute: async (code, context) => {
      const { sessionID: chatSessionId } = context
      const binding = assertExecTrusted(chatSessionId, context.config)
      const execConfig = resolveRlmExecConfig(context.config)
      const namespace = sessionNamespaces.get(context.rlmSessionId) ?? {}
      if (!("context" in namespace)) {
        namespace.context = await readBlobContent(
          context.manager,
          context.rlmSessionId,
          binding.contextVariableName,
        )
      }

      let printed = ""
      const scope: Record<string, unknown> = { ...namespace }
      scope.getQuery = (): string => binding.query
      scope.getVar = async (name: string): Promise<string> =>
        readBlobContent(context.manager, context.rlmSessionId, name)
      scope.setVar = async (name: string, value: unknown): Promise<void> => {
        await upsertBlobVariable(
          context.manager,
          context.rlmSessionId,
          name,
          toStoredContent(value),
        )
        scope[name] = value
      }
      scope.llm_query = async (prompt: string, options?: RlmLlmQueryOptions): Promise<string> => {
        const subcall = await runtimeDeps.runSyncSubcall({
          client: context.client,
          parentSessionID: chatSessionId,
          defaultDirectory: context.directory,
          title: options?.title ?? "RLM llm_query",
          prompt,
          agent: context.subcallAgent ?? context.toolContext.agent,
          model: context.subcallModel,
          tools: { rlm_finish: false, rlm_plan: false, rlm_probe: false, rlm_search: false },
          abortSignal: context.toolContext.abort,
        })
        try {
          if (!subcall.ok) {
            throw new Error(subcall.error)
          }
          return subcall.terminalPayload?.final_answer ?? subcall.textOutput
        } finally {
          if (subcall.sessionID) {
            runtimeDeps.cleanupSyncSubcallSession(subcall.sessionID)
          }
        }
      }
      scope.print = (value: unknown): void => {
        printed = truncatePrintedOutput(
          printed,
          `${formatPrintedValue(value)}\n`,
          execConfig.print_limit_bytes,
        )
      }

      const scopeProxy = new Proxy(scope, {
        deleteProperty: (target, property) => Reflect.deleteProperty(target, property),
        get: (target, property, receiver) => {
          if (property === Symbol.unscopables) {
            return undefined
          }
          if (Reflect.has(target, property)) {
            return Reflect.get(target, property, receiver)
          }
          return Reflect.get(globalThis, property)
        },
        has: () => true,
        set: (target, property, value) => Reflect.set(target, property, value),
      })

      await Promise.race([
        new AsyncFunction("scope", `with (scope) { ${code} }`)(scopeProxy),
        timeoutAfter(execConfig.timeout_ms),
      ])

      syncNamespace(context.rlmSessionId, namespace, scope)
      return applyFeedback(printed, context.rlmSessionId, "rlm_plan", binding, context.config)
    },
  }
}

function syncNamespace(
  sessionID: string,
  namespace: Record<string, unknown>,
  scope: Record<string, unknown>,
): void {
  for (const key of Object.keys(namespace)) {
    if (!(key in scope) && !helperNames.has(key)) {
      delete namespace[key]
    }
  }
  for (const [key, value] of Object.entries(scope)) {
    if (!helperNames.has(key)) {
      namespace[key] = value
    }
  }
  sessionNamespaces.set(sessionID, namespace)
}

function timeoutAfter(timeoutMs: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`exec timed out after ${timeoutMs}ms`)), timeoutMs)
  })
}
