import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import type {
  InitRlmSessionOptions,
  RlmBlobVariable,
  RlmContextVariable,
  RlmManifestVariable,
  RlmSessionState,
} from "./types"
import { assertSafeSegment, resolveSessionDir, resolveSessionFilePath } from "./path-guards"
import {
  parseBlobInput,
  parseManifestInput,
  type CreateBlobVariableInput,
  type CreateManifestVariableInput,
  type VariableOptions,
} from "./variable-input-parser"
import { RlmErrorCode, rlmError } from "./error-codes"

function countLines(content: string): number {
  if (content.length === 0) {
    return 0
  }
  const lines = content.replace(/\r\n/g, "\n").split("\n")
  if (lines.at(-1) === "") {
    lines.pop()
  }
  return lines.length
}

export class RlmContextManager {
  private readonly sessions = new Map<string, RlmSessionState>()

  async initSession(sessionId: string, options: InitRlmSessionOptions): Promise<RlmSessionState> {
    const existing = this.sessions.get(sessionId)
    if (existing) {
      return existing
    }

    const sessionDir = resolveSessionDir(options.contextDir, sessionId)
    await mkdir(sessionDir, { recursive: true })

    const session: RlmSessionState = {
      sessionId,
      depth: options.depth ?? 0,
      maxDepth: options.maxDepth,
      contextDir: options.contextDir,
      rootQuery: options.rootQuery,
      taskPrompt: options.taskPrompt,
      shouldDistill: options.shouldDistill ?? false,
      parentSessionId: options.parentSessionId,
      variables: new Map(),
    }

    this.sessions.set(sessionId, session)
    return session
  }

  getSession(sessionId: string): RlmSessionState | undefined {
    return this.sessions.get(sessionId)
  }

  async createBlobVariable(
    sessionId: string,
    input: CreateBlobVariableInput,
    options: VariableOptions = {},
  ): Promise<RlmBlobVariable> {
    const session = this.getRequiredSession(sessionId)
    const normalizedInput = parseBlobInput(input)
    this.assertVariableNameAvailable(session, normalizedInput.name)

    const content = normalizedInput.source === "content"
      ? normalizedInput.content
      : await readFile(normalizedInput.file_path, "utf8")

    const filePath = this.createVariableFileName(normalizedInput.name, "blob")
    const outputPath = resolveSessionFilePath(session.contextDir, session.sessionId, filePath)
    await writeFile(outputPath, content, "utf8")

    const variable: RlmBlobVariable = {
      sessionId,
      name: normalizedInput.name,
      storageKind: "blob",
      semanticType: options.semanticType ?? "context",
      createdAt: Date.now(),
      filePath,
      byteSize: Buffer.byteLength(content, "utf8"),
      source: normalizedInput.source,
      lineCount: countLines(content),
    }

    session.variables.set(variable.name, variable)
    return variable
  }

  async createManifestVariable(
    sessionId: string,
    input: CreateManifestVariableInput,
    options: VariableOptions = {},
  ): Promise<RlmManifestVariable> {
    const session = this.getRequiredSession(sessionId)
    const normalizedInput = parseManifestInput(input)
    this.assertVariableNameAvailable(session, normalizedInput.name)

    for (const variableName of normalizedInput.variableNames) {
      const variable = session.variables.get(variableName)
      if (!variable || variable.storageKind !== "blob") {
        throw new Error(`Manifest references unknown blob variable: ${variableName}`)
      }
    }

    const manifestPayload = JSON.stringify(normalizedInput.variableNames)
    const filePath = this.createVariableFileName(normalizedInput.name, "manifest.json")
    const outputPath = resolveSessionFilePath(session.contextDir, session.sessionId, filePath)
    await writeFile(outputPath, manifestPayload, "utf8")

    const variable: RlmManifestVariable = {
      sessionId,
      name: normalizedInput.name,
      storageKind: "manifest",
      semanticType: options.semanticType ?? "derived",
      createdAt: Date.now(),
      filePath,
      byteSize: Buffer.byteLength(manifestPayload, "utf8"),
      itemCount: normalizedInput.variableNames.length,
    }

    session.variables.set(variable.name, variable)
    return variable
  }

  async getVariableByName(sessionId: string, name: string): Promise<RlmContextVariable | undefined> {
    const session = this.getSession(sessionId)
    return session?.variables.get(name)
  }

  async readBlobContent(variable: RlmBlobVariable): Promise<string> {
    const storedVariable = this.getStoredBlobVariable(variable.sessionId, variable.name)
    const sourcePath = resolveSessionFilePath(storedVariable.session.contextDir, storedVariable.session.sessionId, storedVariable.variable.filePath)
    return await readFile(sourcePath, "utf8")
  }

  async readManifest(variable: RlmManifestVariable): Promise<string[]> {
    const storedVariable = this.getStoredManifestVariable(variable.sessionId, variable.name)
    const manifestPath = resolveSessionFilePath(storedVariable.session.contextDir, storedVariable.session.sessionId, storedVariable.variable.filePath)
    const content = await readFile(manifestPath, "utf8")

    let names: unknown
    try {
      names = JSON.parse(content)
    } catch {
      throw rlmError(RlmErrorCode.MANIFEST_CORRUPT_ERROR, {
        message: `Manifest file contains invalid JSON for variable: ${variable.name}`,
        variableName: variable.name,
      })
    }

    if (!Array.isArray(names) || !names.every((name) => typeof name === "string")) {
      throw rlmError(RlmErrorCode.MANIFEST_CORRUPT_ERROR, {
        message: `Manifest must be an array of strings for variable: ${variable.name}`,
        variableName: variable.name,
      })
    }

    const blobFilePaths = new Map<string, string>()
    for (const [, v] of storedVariable.session.variables) {
      if (v.storageKind === "blob") {
        const blobPath = resolveSessionFilePath(storedVariable.session.contextDir, storedVariable.session.sessionId, v.filePath)
        blobFilePaths.set(v.name, blobPath)
      }
    }

    const missingBlobs: string[] = []
    for (const name of names) {
      const blobPath = blobFilePaths.get(name)
      if (!blobPath || !existsSync(blobPath)) {
        missingBlobs.push(name)
      }
    }

    if (missingBlobs.length > 0) {
      throw rlmError(RlmErrorCode.MANIFEST_INTEGRITY_ERROR, {
        message: `Manifest references missing blob variables: ${missingBlobs.join(", ")}`,
        missingVariables: missingBlobs,
        variableName: variable.name,
      })
    }

    return names
  }

  async resolveManifestItems(sessionId: string, manifestName: string): Promise<RlmBlobVariable[]> {
    const { session, variable: manifestVariable } = this.getStoredManifestVariable(sessionId, manifestName)
    const variableNames = await this.readManifest(manifestVariable)

    return variableNames.map((name) => {
      const variable = session.variables.get(name)
      if (!variable || variable.storageKind !== "blob") {
        throw new Error(`Manifest references unknown blob variable: ${name}`)
      }
      return variable
    })
  }

  async listVariables(sessionId: string): Promise<RlmContextVariable[]> {
    const session = this.getRequiredSession(sessionId)
    return Array.from(session.variables.values())
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }

    this.sessions.delete(sessionId)
    const sessionDir = resolveSessionDir(session.contextDir, sessionId)
    await rm(sessionDir, { recursive: true, force: true })
  }

  private getRequiredSession(sessionId: string): RlmSessionState {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    return session
  }

  private getStoredBlobVariable(sessionId: string, name: string): { session: RlmSessionState; variable: RlmBlobVariable } {
    const session = this.getRequiredSession(sessionId)
    const variable = session.variables.get(name)
    if (!variable || variable.storageKind !== "blob") {
      throw new Error(`Blob variable not found: ${name}`)
    }
    return { session, variable }
  }

  private getStoredManifestVariable(sessionId: string, name: string): { session: RlmSessionState; variable: RlmManifestVariable } {
    const session = this.getRequiredSession(sessionId)
    const variable = session.variables.get(name)
    if (!variable || variable.storageKind !== "manifest") {
      throw new Error(`Manifest variable not found: ${name}`)
    }
    return { session, variable }
  }

  private assertVariableNameAvailable(session: RlmSessionState, name: string): void {
    assertSafeSegment(name, "Variable name")
    if (session.variables.has(name)) {
      throw new Error(`Variable already exists: ${name}`)
    }
  }

  private createVariableFileName(name: string, extension: string): string {
    assertSafeSegment(name, "Variable name")
    return `${name}-${Date.now()}-${randomUUID().slice(0, 8)}.${extension}`
  }
}
