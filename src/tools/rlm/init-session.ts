import type {
  RlmBlobVariable,
  RlmSemanticType,
  RlmSessionState,
  InitRlmSessionOptions,
} from "../../features/rlm-context/types"
import { InitRlmSessionInputSchema } from "./types"

export interface RlmContextManagerForInit {
  initSession(
    sessionId: string,
    options: InitRlmSessionOptions,
  ): RlmSessionState | Promise<RlmSessionState>

  getSession(
    sessionId: string,
  ): RlmSessionState | undefined | Promise<RlmSessionState | undefined>

  createBlobVariable(
    sessionId: string,
    input: { name: string; content?: string; file_path?: string },
    options?: { semanticType?: RlmSemanticType },
  ): RlmBlobVariable | Promise<RlmBlobVariable>
}

export interface InitRlmSessionResult {
  sessionId: string
  depth: number
  maxDepth: number
  query: string
  shouldDistill: boolean
  parentSessionId?: string
  contextMetadata: {
    contextVariableName: string
    contextSize: number
    contextType: string
    lineCount: number
  }
}

export async function initRlmSession(
  contextManager: RlmContextManagerForInit,
  input: {
    sessionId: string
    query: string
    content?: string
    file_path?: string
    depth?: number
    parentSessionId?: string
    maxDepth: number
    contextDir: string
    shouldDistill?: boolean
  },
): Promise<InitRlmSessionResult> {
  const validated = InitRlmSessionInputSchema.parse(input)

  let session = await contextManager.getSession(validated.sessionId)

  if (!session) {
    session = await contextManager.initSession(validated.sessionId, {
      maxDepth: validated.maxDepth,
      contextDir: validated.contextDir,
      query: validated.query,
      depth: validated.depth,
      parentSessionId: validated.parentSessionId,
      shouldDistill: validated.shouldDistill,
    })
  }

  const blobInput: { name: string; content?: string; file_path?: string } = {
    name: "context",
  }
  if (validated.content !== undefined) {
    blobInput.content = validated.content
  } else {
    blobInput.file_path = validated.file_path
  }

  const contextVariable = await contextManager.createBlobVariable(
    validated.sessionId,
    blobInput,
    { semanticType: "context" },
  )

  return {
    sessionId: session.sessionId,
    depth: session.depth,
    maxDepth: session.maxDepth,
    query: session.query,
    shouldDistill: session.shouldDistill,
    parentSessionId: session.parentSessionId,
    contextMetadata: {
      contextVariableName: contextVariable.name,
      contextSize: contextVariable.byteSize,
      contextType: contextVariable.source,
      lineCount: contextVariable.lineCount,
    },
  }
}
