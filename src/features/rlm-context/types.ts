export type RlmStorageKind = "blob" | "manifest"

export type RlmSemanticType = "context" | "derived" | "result" | "scratch"

interface RlmVariableBase {
  sessionId: string
  name: string
  storageKind: RlmStorageKind
  semanticType: RlmSemanticType
  createdAt: number
  filePath: string
  byteSize: number
}

export interface RlmBlobVariable extends RlmVariableBase {
  storageKind: "blob"
  source: "content" | "file_path"
  lineCount: number
}

export interface RlmManifestVariable extends RlmVariableBase {
  storageKind: "manifest"
  itemCount: number
}

export type RlmContextVariable = RlmBlobVariable | RlmManifestVariable

export interface RlmSessionState {
  sessionId: string
  depth: number
  maxDepth: number
  contextDir: string
  query: string
  shouldDistill: boolean
  parentSessionId?: string
  variables: Map<string, RlmContextVariable>
}

export interface InitRlmSessionOptions {
  maxDepth: number
  contextDir: string
  query: string
  depth?: number
  parentSessionId?: string
  shouldDistill?: boolean
}
