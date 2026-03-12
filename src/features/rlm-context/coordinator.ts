import type {
  RlmBlobVariable,
  RlmContextVariable,
  RlmManifestVariable,
  RlmSemanticType,
  RlmSessionState,
} from './types'
import {
  addOutputBytes as addOutputBytesToBudget,
  incrementSubcallCount as incrementBudgetSubcallCount,
  toSessionBudgetSummary,
  type SessionBudget,
  type SessionBudgetSummary,
} from './budget'
import type { RlmPersistence } from './persistence'
import type { RlmTracer } from './tracer'

/**
 * Structural interface covering all methods used by RLM tools via coordinator binding.
 * RlmContextManager (real), InMemoryRlmManager, and test mocks all satisfy this interface.
 */
export interface RlmContextManagerLike {
  // Read-only access (probe, search, finish)
  getVariableByName(sessionId: string, name: string): RlmContextVariable | undefined | Promise<RlmContextVariable | undefined>
  readBlobContent(variable: RlmBlobVariable): string | Promise<string>
  readManifest(variable: RlmManifestVariable): string[] | Promise<string[]>
  listVariables(sessionId: string): RlmContextVariable[] | Promise<RlmContextVariable[]>
  // Session and variable management (plan)
  initSession(sessionId: string, options: { maxDepth: number; contextDir: string; rootQuery: string; taskPrompt: string; depth?: number; parentSessionId?: string; shouldDistill?: boolean }): RlmSessionState | Promise<RlmSessionState>
  getSession(sessionId: string): RlmSessionState | undefined | Promise<RlmSessionState | undefined>
  createBlobVariable(sessionId: string, input: { name: string; content?: string; file_path?: string }, options?: { semanticType?: RlmSemanticType }): RlmBlobVariable | Promise<RlmBlobVariable>
  createManifestVariable(sessionId: string, input: { name: string; variableNames: string[] }, options?: { semanticType?: RlmSemanticType }): RlmManifestVariable | Promise<RlmManifestVariable>
  resolveManifestItems(sessionId: string, manifestName: string): RlmBlobVariable[] | Promise<RlmBlobVariable[]>
  deleteSession(sessionId: string): void | Promise<void>
}

export interface RlmBinding {
  manager: RlmContextManagerLike
  rlmSessionId: string
  rootRlmSessionId?: string
  depth: number
  rootQuery: string
  taskPrompt: string
  contextVariableName: string
  trusted: boolean
  budget?: SessionBudget
  tracer?: RlmTracer
}

export class RlmSessionCoordinator {
  private bindings = new Map<string, RlmBinding>()
  private rootChatSessions = new Map<string, string>()
  private persistence?: RlmPersistence

  setPersistence(p: RlmPersistence): void {
    this.persistence = p
  }

  bind(rootChatSessionId: string, binding: RlmBinding): void {
    const normalizedBinding: RlmBinding = {
      ...binding,
      rootRlmSessionId: binding.rootRlmSessionId ?? binding.rlmSessionId,
    }

    this.bindings.set(rootChatSessionId, normalizedBinding)
    if (normalizedBinding.rootRlmSessionId === normalizedBinding.rlmSessionId) {
      this.rootChatSessions.set(normalizedBinding.rootRlmSessionId, rootChatSessionId)
    }

    if (normalizedBinding.tracer) {
      const span = normalizedBinding.tracer.startSpan(rootChatSessionId, normalizedBinding.rlmSessionId, "coordinator.bind")
      normalizedBinding.tracer.endSpan(span.spanId, "ok")
    }
    if (this.persistence) {
      this.persistence.persist(rootChatSessionId, normalizedBinding, normalizedBinding.manager).catch((error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error)
        process.stderr.write(`RLM persist failed for ${rootChatSessionId}: ${msg}\n`)
      })
    }
  }

  resolve(rootChatSessionId: string): RlmBinding | undefined {
    return this.bindings.get(rootChatSessionId)
  }

  initializeRootBudget(rootChatSessionId: string, budget: SessionBudget): SessionBudget | undefined {
    const binding = this.bindings.get(rootChatSessionId)
    if (!binding) {
      return undefined
    }

    const rootChatId = binding.rootRlmSessionId
      ? this.rootChatSessions.get(binding.rootRlmSessionId) ?? rootChatSessionId
      : rootChatSessionId
    const rootBinding = this.bindings.get(rootChatId)
    if (!rootBinding) {
      return undefined
    }

    rootBinding.budget ??= budget
    return rootBinding.budget
  }

  getRootBudget(rootChatSessionId: string): SessionBudget | undefined {
    const binding = this.bindings.get(rootChatSessionId)
    if (!binding?.rootRlmSessionId) {
      return binding?.budget
    }

    const rootChatId = this.rootChatSessions.get(binding.rootRlmSessionId)
    return rootChatId ? this.bindings.get(rootChatId)?.budget : binding.budget
  }

  incrementSubcallCount(rootChatSessionId: string): number | undefined {
    const budget = this.getRootBudget(rootChatSessionId)
    return budget ? incrementBudgetSubcallCount(budget) : undefined
  }

  addOutputBytes(rootChatSessionId: string, bytes: number): number | undefined {
    const budget = this.getRootBudget(rootChatSessionId)
    return budget ? addOutputBytesToBudget(budget, bytes) : undefined
  }

  getBudgetSummary(rootChatSessionId: string): SessionBudgetSummary | undefined {
    const budget = this.getRootBudget(rootChatSessionId)
    return budget ? toSessionBudgetSummary(budget) : undefined
  }

  unbind(rootChatSessionId: string): void {
    const binding = this.bindings.get(rootChatSessionId)
    if (binding?.tracer) {
      const span = binding.tracer.startSpan(rootChatSessionId, binding.rlmSessionId, "coordinator.unbind")
      binding.tracer.endSpan(span.spanId, "ok")
    }

    if (binding && binding.rootRlmSessionId === binding.rlmSessionId) {
      this.rootChatSessions.delete(binding.rootRlmSessionId)
    }

    this.bindings.delete(rootChatSessionId)
  }
}

export const coordinator = new RlmSessionCoordinator()
