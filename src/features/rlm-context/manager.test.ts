import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { RlmBlobVariable, RlmContextVariable, RlmManifestVariable, RlmSessionState } from "./types"

type ExpectChain = {
  toBe: (expected: unknown) => void
  toEqual: (expected: unknown) => void
  toBeDefined: () => void
  toBeUndefined: () => void
}

type BunTestModule = {
  afterEach: (fn: () => void) => void
  describe: (name: string, fn: () => void) => void
  it: (name: string, fn: () => void | Promise<void>) => void
  expect: (value: unknown) => ExpectChain
}

const bunTestSpecifier = "bun:test"
const { afterEach, describe, expect, it } = (await import(bunTestSpecifier)) as BunTestModule

type RlmContextManagerLike = {
  initSession: (sessionId: string, options: unknown) => RlmSessionState | Promise<RlmSessionState>
  getSession: (sessionId: string) => RlmSessionState | undefined | Promise<RlmSessionState | undefined>
  createBlobVariable: (sessionId: string, input: unknown, options?: unknown) => RlmBlobVariable | Promise<RlmBlobVariable>
  createManifestVariable: (sessionId: string, input: unknown, options?: unknown) => RlmManifestVariable | Promise<RlmManifestVariable>
  readManifest: (variable: RlmManifestVariable) => string[] | Promise<string[]>
  resolveManifestItems: (sessionId: string, manifestName: string) => RlmBlobVariable[] | Promise<RlmBlobVariable[]>
  getVariableByName: (sessionId: string, name: string) => RlmContextVariable | undefined | Promise<RlmContextVariable | undefined>
  listVariables: (sessionId: string) => RlmContextVariable[] | Promise<RlmContextVariable[]>
  deleteSession: (sessionId: string) => void | Promise<void>
}

const tempDirs: string[] = []
const managerModulePath = "./manager"

function createTempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "omo-rlm-context-"))
  tempDirs.push(directory)
  return directory
}

function isMissingManagerModule(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes("Cannot find module") && message.includes("./manager")
}

async function createManager(): Promise<RlmContextManagerLike> {
  try {
    const module = (await import(managerModulePath)) as { RlmContextManager?: new () => RlmContextManagerLike }
    if (!module.RlmContextManager) {
      throw new Error("RlmContextManager export is missing")
    }
    return new module.RlmContextManager()
  } catch (error) {
    if (isMissingManagerModule(error)) {
      throw new Error("RlmContextManager is not implemented yet")
    }
    throw error
  }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop()
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  }
})

describe("rlm-context manager (RED)", () => {
  it("init session stores query, depth=0, and shouldDistill=false", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    await manager.initSession("ses-root", { contextDir, maxDepth: 2, query: "What is in the context?" })
    const session = await manager.getSession("ses-root")

    expect(session).toBeDefined()
    expect(session?.query).toBe("What is in the context?")
    expect(session?.depth).toBe(0)
    expect(session?.shouldDistill).toBe(false)
  })

  it("creates blob variable from content", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-blob-content"
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, query: "summarize" })
    const variable = await manager.createBlobVariable(
      sessionId,
      { name: "context", content: "line-1\nline-2\nline-3" },
      { semanticType: "context" },
    )

    expect(variable.name).toBe("context")
    expect(variable.storageKind).toBe("blob")
    expect(variable.semanticType).toBe("context")
  })

  it("creates blob variable from file_path", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sourcePath = join(contextDir, "source.txt")
    writeFileSync(sourcePath, "alpha\nbeta\ngamma\n", "utf8")
    const sessionId = "ses-blob-file"
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, query: "summarize source" })
    const variable = await manager.createBlobVariable(
      sessionId,
      { name: "source_blob", file_path: sourcePath },
      { semanticType: "derived" },
    )

    expect(variable.name).toBe("source_blob")
    expect(variable.storageKind).toBe("blob")
    expect(variable.semanticType).toBe("derived")
  })

  it("creates manifest variable from ordered child variable names", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-manifest-create"
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, query: "order check" })
    await manager.createBlobVariable(sessionId, { name: "part_a", content: "A" })
    await manager.createBlobVariable(sessionId, { name: "part_b", content: "B" })
    const manifest = await manager.createManifestVariable(
      sessionId,
      { name: "ordered_parts", variableNames: ["part_b", "part_a"] },
      { semanticType: "derived" },
    )

    expect(manifest.name).toBe("ordered_parts")
    expect(manifest.storageKind).toBe("manifest")
    expect(manifest.semanticType).toBe("derived")
  })

  it("readManifest preserves manifest item order", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-manifest-read"
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, query: "read order" })
    await manager.createBlobVariable(sessionId, { name: "left", content: "L" })
    await manager.createBlobVariable(sessionId, { name: "right", content: "R" })
    const manifest = await manager.createManifestVariable(sessionId, {
      name: "ordered",
      variableNames: ["right", "left"],
    })

    expect(await manager.readManifest(manifest)).toEqual(["right", "left"])
  })

  it("resolveManifestItems returns expected blob variables", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-manifest-resolve"
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, query: "resolve" })
    await manager.createBlobVariable(sessionId, { name: "first", content: "1" })
    await manager.createBlobVariable(sessionId, { name: "second", content: "2" })
    await manager.createManifestVariable(sessionId, {
      name: "ordered_blob_refs",
      variableNames: ["second", "first"],
    })
    const resolved = await manager.resolveManifestItems(sessionId, "ordered_blob_refs")

    expect(resolved.map((item) => item.name)).toEqual(["second", "first"])
    expect(resolved.every((item) => item.storageKind === "blob")).toBe(true)
  })

  it("getVariableByName returns metadata", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-get-by-name"
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, query: "metadata" })
    await manager.createBlobVariable(sessionId, { name: "meta_blob", content: "payload" })
    const variable = await manager.getVariableByName(sessionId, "meta_blob")

    expect(variable).toBeDefined()
    expect(variable?.storageKind).toBe("blob")
    expect((variable as Record<string, unknown> | undefined)?.content).toBeUndefined()
  })

  it("listVariables returns blob and manifest metadata", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-list-vars"
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, query: "list variables" })
    await manager.createBlobVariable(sessionId, { name: "blob_one", content: "one" })
    await manager.createBlobVariable(sessionId, { name: "blob_two", content: "two" })
    await manager.createManifestVariable(sessionId, {
      name: "manifest_one",
      variableNames: ["blob_two", "blob_one"],
    })
    const variables = await manager.listVariables(sessionId)
    const variableKinds = new Set(variables.map((variable) => variable.storageKind))
    const variableNames = new Set(variables.map((variable) => variable.name))

    expect(variableKinds).toEqual(new Set(["blob", "manifest"]))
    expect(variableNames.has("blob_one")).toBe(true)
    expect(variableNames.has("manifest_one")).toBe(true)
  })

  it("deleteSession removes in-memory state and on-disk files", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-delete"
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, query: "delete me" })
    await manager.createBlobVariable(sessionId, { name: "to_delete", content: "payload" })
    const sessionDir = join(contextDir, sessionId)
    expect(existsSync(sessionDir)).toBe(true)

    await manager.deleteSession(sessionId)

    expect(await manager.getSession(sessionId)).toBeUndefined()
    expect(existsSync(sessionDir)).toBe(false)
  })
})
