import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import type { RlmBinding, RlmContextManagerLike, RlmSessionCoordinator } from "./coordinator"
import type { RlmContextManager } from "./manager"
import type { RlmBlobVariable, RlmContextVariable, RlmManifestVariable, RlmSemanticType } from "./types"
import { quarantineSession, validateBlobIntegrity } from "./persistence-helpers"

const METADATA_FILE = "metadata.json"
const QUARANTINE_DIR = ".quarantine"
const DEFAULT_RECOVERY_TIMEOUT_MS = 5000

export interface PersistedVariableInfo {
  name: string
  storageKind: "blob" | "manifest"
  semanticType: string
  filePath: string
  byteSize: number
  lineCount?: number
  source?: "content" | "file_path"
  itemCount?: number
}

export interface PersistedSession {
  rootChatSessionId: string
  rlmSessionId: string
  query: string
  depth: number
  maxDepth: number
  contextVariableName: string
  trusted: boolean
  variableManifest: PersistedVariableInfo[]
  timestamp: number
}

export interface RlmPersistence {
  persist(sessionId: string, binding: RlmBinding, manager: RlmContextManagerLike): Promise<void>
  recover(coordinator: RlmSessionCoordinator, manager: RlmContextManager): Promise<number>
  cleanup(sessionId: string): Promise<void>
}

function serializeVariable(v: RlmContextVariable): PersistedVariableInfo {
  const base: PersistedVariableInfo = {
    name: v.name,
    storageKind: v.storageKind,
    semanticType: v.semanticType,
    filePath: v.filePath,
    byteSize: v.byteSize,
  }
  if (v.storageKind === "blob") {
    base.lineCount = v.lineCount
    base.source = v.source
  } else {
    base.itemCount = v.itemCount
  }
  return base
}

function reconstructVariable(sessionId: string, info: PersistedVariableInfo): RlmContextVariable {
  if (info.storageKind === "blob") {
    return {
      sessionId,
      name: info.name,
      storageKind: "blob",
      semanticType: info.semanticType as RlmSemanticType,
      createdAt: Date.now(),
      filePath: info.filePath,
      byteSize: info.byteSize,
      source: info.source ?? "content",
      lineCount: info.lineCount ?? 0,
    }
  }
  return {
    sessionId,
    name: info.name,
    storageKind: "manifest",
    semanticType: info.semanticType as RlmSemanticType,
    createdAt: Date.now(),
    filePath: info.filePath,
    byteSize: info.byteSize,
    itemCount: info.itemCount ?? 0,
  }
}

async function recoverSessions(
  storageDir: string,
  maxSessions: number,
  coordinator: RlmSessionCoordinator,
  manager: RlmContextManager,
): Promise<number> {
  let entries: string[]
  try {
    entries = await readdir(storageDir)
  } catch (readError: unknown) {
    const msg = readError instanceof Error ? readError.message : String(readError)
    process.stderr.write(`RLM recovery: cannot read storage dir: ${msg}\n`)
    return 0
  }

  let recovered = 0
  for (const entry of entries) {
    if (recovered >= maxSessions) break
    if (entry === QUARANTINE_DIR || entry.startsWith(".")) continue
    const sessionDir = resolve(storageDir, entry)
    const metadataPath = resolve(sessionDir, METADATA_FILE)
    try {
      const raw = await readFile(metadataPath, "utf8")
      const persisted = JSON.parse(raw) as PersistedSession
      await validateBlobIntegrity(sessionDir, persisted.variableManifest)
      const session = await manager.initSession(persisted.rlmSessionId, {
        maxDepth: persisted.maxDepth,
        contextDir: storageDir,
        query: persisted.query,
        depth: persisted.depth,
      })
      for (const varInfo of persisted.variableManifest) {
        session.variables.set(varInfo.name, reconstructVariable(persisted.rlmSessionId, varInfo))
      }
      coordinator.bind(persisted.rootChatSessionId, {
        manager,
        rlmSessionId: persisted.rlmSessionId,
        depth: persisted.depth,
        query: persisted.query,
        contextVariableName: persisted.contextVariableName,
        trusted: persisted.trusted,
      })
      recovered++
    } catch (error: unknown) {
      await quarantineSession(storageDir, entry, error)
    }
  }
  return recovered
}

const NOOP_PERSISTENCE: RlmPersistence = {
  persist: async () => {},
  recover: async () => 0,
  cleanup: async () => {},
}

interface PersistenceConfig {
  enabled?: boolean
  max_sessions?: number
  context_storage_dir: string
  recovery_timeout_ms?: number
}

export function createRlmPersistence(config: PersistenceConfig): RlmPersistence {
  if (!config.enabled) {
    return NOOP_PERSISTENCE
  }
  const storageDir = config.context_storage_dir
  const maxSessions = config.max_sessions ?? 100
  const recoveryTimeout = config.recovery_timeout_ms ?? DEFAULT_RECOVERY_TIMEOUT_MS

  return {
    async persist(rootChatSessionId, binding, manager) {
      const variables = await manager.listVariables(binding.rlmSessionId)
      const session = await manager.getSession(binding.rlmSessionId)
      if (!session) return
      const persisted: PersistedSession = {
        rootChatSessionId,
        rlmSessionId: binding.rlmSessionId,
        query: binding.query,
        depth: binding.depth,
        maxDepth: session.maxDepth,
        contextVariableName: binding.contextVariableName,
        trusted: binding.trusted,
        variableManifest: variables.map(serializeVariable),
        timestamp: Date.now(),
      }
      const sessionDir = resolve(storageDir, binding.rlmSessionId)
      await mkdir(sessionDir, { recursive: true })
      const metadataPath = resolve(sessionDir, METADATA_FILE)
      const tempPath = `${metadataPath}.tmp`
      await writeFile(tempPath, JSON.stringify(persisted, null, 2), "utf8")
      await rename(tempPath, metadataPath)
    },

    async recover(coord, mgr) {
      return Promise.race([
        recoverSessions(storageDir, maxSessions, coord, mgr),
        new Promise<number>((res) => setTimeout(() => res(0), recoveryTimeout)),
      ])
    },

    async cleanup(sessionId) {
      const metadataPath = resolve(storageDir, sessionId, METADATA_FILE)
      await rm(metadataPath, { force: true })
    },
  }
}
