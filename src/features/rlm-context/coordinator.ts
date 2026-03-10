import type {
  RlmBlobVariable,
  RlmContextVariable,
  RlmManifestVariable,
  RlmSemanticType,
  RlmSessionState,
} from './types'

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
  initSession(sessionId: string, options: { maxDepth: number; contextDir: string; query: string; depth?: number; parentSessionId?: string; shouldDistill?: boolean }): RlmSessionState | Promise<RlmSessionState>
  getSession(sessionId: string): RlmSessionState | undefined | Promise<RlmSessionState | undefined>
  createBlobVariable(sessionId: string, input: { name: string; content?: string; file_path?: string }, options?: { semanticType?: RlmSemanticType }): RlmBlobVariable | Promise<RlmBlobVariable>
  createManifestVariable(sessionId: string, input: { name: string; variableNames: string[] }, options?: { semanticType?: RlmSemanticType }): RlmManifestVariable | Promise<RlmManifestVariable>
  resolveManifestItems(sessionId: string, manifestName: string): RlmBlobVariable[] | Promise<RlmBlobVariable[]>
  deleteSession(sessionId: string): void | Promise<void>
}

export interface RlmBinding {
  manager: RlmContextManagerLike
  rlmSessionId: string
  depth: number
  query: string
  contextVariableName: string
  trusted: boolean
}

export class RlmSessionCoordinator {
  private bindings = new Map<string, RlmBinding>()

  bind(rootChatSessionId: string, binding: RlmBinding): void {
    this.bindings.set(rootChatSessionId, binding)
  }

  resolve(rootChatSessionId: string): RlmBinding | undefined {
    return this.bindings.get(rootChatSessionId)
  }

  unbind(rootChatSessionId: string): void {
    this.bindings.delete(rootChatSessionId)
  }
}

export const coordinator = new RlmSessionCoordinator()
