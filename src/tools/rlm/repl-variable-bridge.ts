import type {
  RlmBlobVariable,
  RlmContextVariable,
  RlmSessionState,
} from "../../features/rlm-context/types"

interface BlobReader {
  getVariableByName(
    sessionID: string,
    name: string,
  ): Promise<RlmContextVariable | undefined> | RlmContextVariable | undefined
  readBlobContent(variable: RlmBlobVariable): Promise<string> | string
}

interface BlobWriter {
  getSession(
    sessionID: string,
  ): Promise<RlmSessionState | undefined> | RlmSessionState | undefined
  createBlobVariable(
    sessionID: string,
    input: { name: string; content?: string; file_path?: string },
    options?: { semanticType?: "context" | "derived" | "result" | "scratch" },
  ): Promise<RlmBlobVariable> | RlmBlobVariable
}

export async function readBlobContent(
  manager: BlobReader,
  sessionID: string,
  name: string,
): Promise<string> {
  const variable = await manager.getVariableByName(sessionID, name)
  if (!variable || variable.storageKind !== "blob") {
    throw new Error(`Blob variable not found: ${name}`)
  }
  return manager.readBlobContent(variable)
}

export async function upsertBlobVariable(
  manager: BlobWriter,
  sessionID: string,
  name: string,
  content: string,
): Promise<void> {
  const session = await manager.getSession(sessionID)
  if (!session) {
    throw new Error(`Session not found: ${sessionID}`)
  }
  session.variables.delete(name)
  await manager.createBlobVariable(
    sessionID,
    { name, content },
    { semanticType: "scratch" },
  )
}

export function toStoredContent(value: unknown): string {
  if (typeof value === "string") {
    return value
  }
  return formatPrintedValue(value)
}

export function formatPrintedValue(value: unknown): string {
  if (typeof value === "string") {
    return value
  }
  try {
    return JSON.stringify(value) ?? String(value)
  } catch (_error) {
    return String(value)
  }
}

export function truncatePrintedOutput(current: string, chunk: string, limit: number): string {
  const next = `${current}${chunk}`
  if (Buffer.byteLength(next, "utf8") <= limit) {
    return next
  }
  return Buffer.from(next, "utf8").subarray(0, limit).toString("utf8")
}