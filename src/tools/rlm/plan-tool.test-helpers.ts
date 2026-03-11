import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import type {
  RlmBlobVariable,
  RlmContextVariable,
  RlmManifestVariable,
  RlmSessionState,
} from "../../features/rlm-context/types"
import type { RlmContextManagerForPlan } from "./plan-tool"
import { coordinator, type RlmContextManagerLike } from "../../features/rlm-context/coordinator"

export class InMemoryRlmManager implements RlmContextManagerForPlan, RlmContextManagerLike {
  private readonly sessions = new Map<string, RlmSessionState>()
  private readonly blobs = new Map<string, string>()
  readonly deletedSessions: string[] = []

  seedSession(session: RlmSessionState): void {
    this.sessions.set(session.sessionId, session)
  }

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
  ): RlmSessionState {
    const session = {
      sessionId,
      depth: options.depth ?? 0,
      maxDepth: options.maxDepth,
      contextDir: options.contextDir,
      query: options.query,
      shouldDistill: options.shouldDistill ?? false,
      parentSessionId: options.parentSessionId,
      variables: new Map(),
    } satisfies RlmSessionState
    this.sessions.set(sessionId, session)
    return session
  }

  getSession(sessionId: string): RlmSessionState | undefined {
    return this.sessions.get(sessionId)
  }

  getVariableByName(sessionId: string, name: string): RlmContextVariable | undefined {
    return this.sessions.get(sessionId)?.variables.get(name)
  }

  createBlobVariable(sessionId: string, input: { name: string; content?: string; file_path?: string }): RlmBlobVariable {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`session not found: ${sessionId}`)
    const content = input.content ?? ""
    const variable: RlmBlobVariable = {
      sessionId,
      name: input.name,
      storageKind: "blob",
      semanticType: "derived",
      createdAt: Date.now(),
      filePath: `${input.name}.blob`,
      byteSize: Buffer.byteLength(content, "utf8"),
      source: input.file_path ? "file_path" : "content",
      lineCount: content.length === 0 ? 0 : content.split("\n").length,
    }
    session.variables.set(input.name, variable)
    this.blobs.set(`${sessionId}:${input.name}`, content)
    return variable
  }

  createManifestVariable(sessionId: string, input: { name: string; variableNames: string[] }): RlmManifestVariable {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`session not found: ${sessionId}`)
    const variable: RlmManifestVariable = {
      sessionId,
      name: input.name,
      storageKind: "manifest",
      semanticType: "derived",
      createdAt: Date.now(),
      filePath: `${input.name}.manifest.json`,
      byteSize: 0,
      itemCount: input.variableNames.length,
    }
    session.variables.set(input.name, variable)
    this.blobs.set(`${sessionId}:${input.name}`, JSON.stringify(input.variableNames))
    return variable
  }

  readBlobContent(variable: RlmBlobVariable): string {
    return this.blobs.get(`${variable.sessionId}:${variable.name}`) ?? ""
  }

  resolveManifestItems(sessionId: string, manifestName: string): RlmBlobVariable[] {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`session not found: ${sessionId}`)
    const raw = this.blobs.get(`${sessionId}:${manifestName}`) ?? "[]"
    const names = JSON.parse(raw) as string[]
    return names.map((name) => {
      const variable = session.variables.get(name)
      if (!variable || variable.storageKind !== "blob") {
        throw new Error(`blob not found: ${name}`)
      }
      return variable
    })
  }

  readManifest(variable: RlmManifestVariable): string[] {
    const raw = this.blobs.get(`${variable.sessionId}:${variable.name}`) ?? "[]"
    return JSON.parse(raw) as string[]
  }

  listVariables(sessionId: string): RlmContextVariable[] {
    const session = this.sessions.get(sessionId)
    if (!session) return []
    return Array.from(session.variables.values())
  }

  deleteSession(sessionId: string): void {
    this.deletedSessions.push(sessionId)
    this.sessions.delete(sessionId)
  }
}

export function createSession(sessionId: string, query: string, depth: number, maxDepth: number): RlmSessionState {
  return {
    sessionId,
    depth,
    maxDepth,
    contextDir: "/tmp/rlm",
    query,
    shouldDistill: false,
    variables: new Map(),
  }
}

export function createToolContext(sessionID: string): ToolContext {
  return {
    sessionID,
    messageID: "msg-1",
    agent: "sisyphus",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  } as ToolContext
}

export const dummyClient = {} as PluginInput["client"]

export function testRlmSessionId(sessionId: string): string {
  return `rlm-test-${sessionId}`
}

export function bindTestCoordinator(sessionId: string, manager: RlmContextManagerLike, overrides: Partial<Omit<Parameters<typeof coordinator.bind>[1], "manager">> = {}): void {
  coordinator.bind(sessionId, {
    manager,
    rlmSessionId: testRlmSessionId(sessionId),
    depth: 0,
    query: "test query",
    contextVariableName: "context",
    trusted: true,
    ...overrides,
  })
}

export function unbindTestCoordinator(sessionId: string): void {
  coordinator.unbind(sessionId)
}
