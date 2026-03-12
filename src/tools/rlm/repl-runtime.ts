import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { RlmConfig } from "../../config/schema/experimental"
import type { RlmContextManagerLike } from "../../features/rlm-context/coordinator"
import { applyFeedback } from "../../features/rlm-context/turn-feedback"
import { normalizeExecError } from "./repl-exec-errors"
import { assertExecTrusted, resolveRlmExecConfig } from "./repl-exec-config"
import {
  readBlobContent,
  truncatePrintedOutput,
} from "./repl-variable-bridge"
import {
  cleanupSyncSubcallSession,
  runSyncSubcall,
} from "./subcall-runner"
import { SessionLock } from "./session-lock"
import { createVmSandboxRlmReplBackend } from "./vm-sandbox"
import { helperNames, installExecNamespace } from "./exec-namespace"

type RlmSubcallModel = { providerID: string; modelID: string; variant?: string }
type RlmReplBackendConfig = RlmConfig & { sandbox?: { enabled?: boolean } }
type AsyncFunctionConstructor = new (
  ...args: string[]
) => (scope: Record<string, unknown>) => Promise<unknown>

const AsyncFunction = Object.getPrototypeOf(async function noop() {}).constructor as AsyncFunctionConstructor
const sessionNamespaces = new Map<string, Record<string, unknown>>()
const sessionLock = new SessionLock()

export interface RlmReplContext {
  sessionID: string
  rlmSessionId: string
  rootQuery: string
  taskPrompt: string
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
      const release = await sessionLock.acquire(context.rlmSessionId)
      try {
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
        installExecNamespace(scope, context, context.config, (chunk) => {
          printed = truncatePrintedOutput(
            printed,
            chunk,
            execConfig.print_limit_bytes,
          )
        }, runtimeDeps)

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
      } finally {
        release()
      }
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
