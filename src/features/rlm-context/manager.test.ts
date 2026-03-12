import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { RlmBlobVariable, RlmContextVariable, RlmManifestVariable, RlmSessionState } from "./types"
import { RlmErrorCode } from "./error-codes"

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
  readBlobContent: (variable: RlmBlobVariable) => string | Promise<string>
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
    await manager.initSession("ses-root", { contextDir, maxDepth: 2, rootQuery: "What is in the context?", taskPrompt: "What is in the context?" })
    const session = await manager.getSession("ses-root")

    expect(session).toBeDefined()
    expect(session?.rootQuery).toBe("What is in the context?")
    expect(session?.taskPrompt).toBe("What is in the context?")
    expect(session?.depth).toBe(0)
    expect(session?.shouldDistill).toBe(false)
  })

  it("creates blob variable from content", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-blob-content"
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, rootQuery: "summarize", taskPrompt: "summarize" })
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
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, rootQuery: "summarize source", taskPrompt: "summarize source" })
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
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, rootQuery: "order check", taskPrompt: "order check" })
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
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, rootQuery: "read order", taskPrompt: "read order" })
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
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, rootQuery: "resolve", taskPrompt: "resolve" })
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
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, rootQuery: "metadata", taskPrompt: "metadata" })
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
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, rootQuery: "list variables", taskPrompt: "list variables" })
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
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, rootQuery: "delete me", taskPrompt: "delete me" })
    await manager.createBlobVariable(sessionId, { name: "to_delete", content: "payload" })
    const sessionDir = join(contextDir, sessionId)
    expect(existsSync(sessionDir)).toBe(true)

    await manager.deleteSession(sessionId)

    expect(await manager.getSession(sessionId)).toBeUndefined()
    expect(existsSync(sessionDir)).toBe(false)
  })
})

describe("rlm-context manager edge cases (SCENARIO 3)", () => {
  it("throws error when session not found for createBlobVariable", async () => {
    const manager = await createManager()
    
    try {
      await manager.createBlobVariable("nonexistent-session", { name: "blob", content: "data" })
      expect(false).toBe(true) // Should not reach here
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message.includes("Session not found")).toBe(true)
    }
  })

  it("throws error when session not found for createManifestVariable", async () => {
    const manager = await createManager()
    
    try {
      await manager.createManifestVariable("nonexistent-session", { name: "manifest", variableNames: [] })
      expect(false).toBe(true) // Should not reach here
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message.includes("Session not found")).toBe(true)
    }
  })

  it("throws error when variable name already exists", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-duplicate-name"
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, rootQuery: "test", taskPrompt: "test" })
    await manager.createBlobVariable(sessionId, { name: "duplicate", content: "first" })
    
    try {
      await manager.createBlobVariable(sessionId, { name: "duplicate", content: "second" })
      expect(false).toBe(true) // Should not reach here
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message.includes("Variable already exists")).toBe(true)
    }
  })

  it("throws error for invalid variable name with path traversal", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-invalid-name"
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, rootQuery: "test", taskPrompt: "test" })
    
    try {
      await manager.createBlobVariable(sessionId, { name: "../evil", content: "data" })
      expect(false).toBe(true) // Should not reach here
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message.includes("invalid characters")).toBe(true)
    }
  })

  it("throws error for invalid variable name with special characters", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-special-chars"
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, rootQuery: "test", taskPrompt: "test" })
    
    try {
      await manager.createBlobVariable(sessionId, { name: "var@name!", content: "data" })
      expect(false).toBe(true) // Should not reach here
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message.includes("invalid characters")).toBe(true)
    }
  })

  it("throws error when blob input missing both content and file_path", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-missing-source"
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, rootQuery: "test", taskPrompt: "test" })
    
    try {
      await manager.createBlobVariable(sessionId, { name: "incomplete" } as unknown as any)
      expect(false).toBe(true) // Should not reach here
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message.includes("exactly one of content or file_path")).toBe(true)
    }
  })

  it("throws error when blob input has both content and file_path", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-both-sources"
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, rootQuery: "test", taskPrompt: "test" })
    
    try {
      await manager.createBlobVariable(sessionId, { name: "both", content: "data", file_path: "/path" } as any)
      expect(false).toBe(true) // Should not reach here
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message.includes("exactly one of content or file_path")).toBe(true)
    }
  })

  it("throws error when blob input missing name", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-no-name"
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, rootQuery: "test", taskPrompt: "test" })
    
    try {
      await manager.createBlobVariable(sessionId, { content: "data" } as any)
      expect(false).toBe(true) // Should not reach here
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message.includes("must include a string name")).toBe(true)
    }
  })

  it("throws error when manifest input missing name", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-manifest-no-name"
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, rootQuery: "test", taskPrompt: "test" })
    
    try {
      await manager.createManifestVariable(sessionId, { variableNames: [] } as any)
      expect(false).toBe(true) // Should not reach here
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message.includes("must include a string name")).toBe(true)
    }
  })

  it("throws error when manifest variableNames is not an array", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-manifest-bad-array"
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, rootQuery: "test", taskPrompt: "test" })
    
    try {
      await manager.createManifestVariable(sessionId, { name: "bad", variableNames: "not-array" } as any)
      expect(false).toBe(true) // Should not reach here
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message.includes("must be a string array")).toBe(true)
    }
  })

  it("throws error when manifest references non-existent blob variable", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-manifest-missing-ref"
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, rootQuery: "test", taskPrompt: "test" })
    await manager.createBlobVariable(sessionId, { name: "exists", content: "data" })
    
    try {
      await manager.createManifestVariable(sessionId, { name: "bad_manifest", variableNames: ["exists", "missing"] })
      expect(false).toBe(true) // Should not reach here
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message.includes("unknown blob variable")).toBe(true)
    }
  })

  it("throws error when getVariableByName called on non-existent session", async () => {
    const manager = await createManager()
    const result = await manager.getVariableByName("nonexistent", "var")
    expect(result).toBeUndefined()
  })

  it("throws error when listVariables called on non-existent session", async () => {
    const manager = await createManager()
    
    try {
      await manager.listVariables("nonexistent")
      expect(false).toBe(true) // Should not reach here
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message.includes("Session not found")).toBe(true)
    }
  })

  it("handles empty manifest variable names array", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-empty-manifest"
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, rootQuery: "test", taskPrompt: "test" })
    
    const manifest = await manager.createManifestVariable(sessionId, { name: "empty", variableNames: [] })
    expect(manifest.itemCount).toBe(0)
    
    const items = await manager.resolveManifestItems(sessionId, "empty")
    expect(items.length).toBe(0)
  })

  it("handles empty blob content", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-empty-blob"
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, rootQuery: "test", taskPrompt: "test" })
    
    const variable = await manager.createBlobVariable(sessionId, { name: "empty", content: "" })
    expect(variable.lineCount).toBe(0)
    expect(variable.byteSize).toBe(0)
  })

  it("handles single-line blob content without newline", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-single-line"
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, rootQuery: "test", taskPrompt: "test" })
    
    const variable = await manager.createBlobVariable(sessionId, { name: "single", content: "one line" })
    expect(variable.lineCount).toBe(1)
  })

  it("handles multi-line blob content with various line endings", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-multiline"
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, rootQuery: "test", taskPrompt: "test" })
    
    const content = "line1\r\nline2\nline3\r\nline4"
    const variable = await manager.createBlobVariable(sessionId, { name: "multiline", content })
    expect(variable.lineCount).toBe(4)
  })

  it("handles large blob content", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-large"
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, rootQuery: "test", taskPrompt: "test" })
    
    const largeContent = "x".repeat(1000000) // 1MB
    const variable = await manager.createBlobVariable(sessionId, { name: "large", content: largeContent })
    expect(variable.byteSize).toBe(1000000)
    expect(variable.lineCount).toBe(1)
  })

  it("throws error when reading non-existent blob variable", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-read-missing"
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, rootQuery: "test", taskPrompt: "test" })
    
    try {
      await manager.readBlobContent({ sessionId, name: "missing" } as any)
      expect(false).toBe(true) // Should not reach here
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message.includes("Blob variable not found")).toBe(true)
    }
  })

  it("throws error when reading non-existent manifest variable", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-manifest-read-missing"
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, rootQuery: "test", taskPrompt: "test" })
    
    try {
      await manager.readManifest({ sessionId, name: "missing" } as any)
      expect(false).toBe(true) // Should not reach here
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message.includes("Manifest variable not found")).toBe(true)
    }
  })

  it("throws error when resolving manifest items with missing blob reference", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-resolve-missing"
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, rootQuery: "test", taskPrompt: "test" })
    await manager.createBlobVariable(sessionId, { name: "exists", content: "data" })
    
    await manager.createManifestVariable(sessionId, { name: "manifest", variableNames: ["exists"] })
    
    const session = await manager.getSession(sessionId)
    if (session) {
      session.variables.delete("exists")
    }
    
    try {
      await manager.resolveManifestItems(sessionId, "manifest")
      expect(false).toBe(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message.includes("missing blob")).toBe(true)
    }
  })

  it("deleteSession handles non-existent session gracefully", async () => {
    const manager = await createManager()
    
    // Should not throw
    await manager.deleteSession("nonexistent")
    expect(true).toBe(true)
  })

  it("deleteSession removes session from in-memory map", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-cleanup"
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, rootQuery: "test", taskPrompt: "test" })
    
    expect(await manager.getSession(sessionId)).toBeDefined()
    await manager.deleteSession(sessionId)
    expect(await manager.getSession(sessionId)).toBeUndefined()
  })

  it("enforces maxDepth constraint in session state", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-max-depth"
    const maxDepth = 3
    
    const session = await manager.initSession(sessionId, { contextDir, maxDepth, rootQuery: "test", taskPrompt: "test", depth: 0 })
    expect(session.maxDepth).toBe(maxDepth)
    expect(session.depth).toBe(0)
  })

  it("respects depth parameter in initSession", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-depth-param"
    
    const session = await manager.initSession(sessionId, { contextDir, maxDepth: 5, rootQuery: "test", taskPrompt: "test", depth: 2 })
    expect(session.depth).toBe(2)
  })

  it("defaults depth to 0 when not provided", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-default-depth"
    
    const session = await manager.initSession(sessionId, { contextDir, maxDepth: 5, rootQuery: "test", taskPrompt: "test" })
    expect(session.depth).toBe(0)
  })

  it("defaults shouldDistill to false when not provided", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-default-distill"
    
    const session = await manager.initSession(sessionId, { contextDir, maxDepth: 5, rootQuery: "test", taskPrompt: "test" })
    expect(session.shouldDistill).toBe(false)
  })

  it("respects shouldDistill parameter in initSession", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-distill-param"
    
    const session = await manager.initSession(sessionId, { contextDir, maxDepth: 5, rootQuery: "test", taskPrompt: "test", shouldDistill: true })
    expect(session.shouldDistill).toBe(true)
  })

  it("returns existing session when initSession called twice with same ID", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-idempotent"
    
    const session1 = await manager.initSession(sessionId, { contextDir, maxDepth: 5, rootQuery: "first", taskPrompt: "first" })
    const session2 = await manager.initSession(sessionId, { contextDir, maxDepth: 10, rootQuery: "second", taskPrompt: "second" })
    
    expect(session1.sessionId).toBe(session2.sessionId)
    expect(session1.rootQuery).toBe("first") // Original query preserved
  })
})

describe("manifest integrity verification (T3)", () => {
  it("readManifest throws MANIFEST_INTEGRITY_ERROR when referenced blob file is missing", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-integrity-missing"
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, rootQuery: "test", taskPrompt: "test" })
    
    const blob = await manager.createBlobVariable(sessionId, { name: "existing", content: "data" })
    
    const manifest = await manager.createManifestVariable(sessionId, {
      name: "test_manifest",
      variableNames: ["existing"],
    })
    
    const sessionDir = join(contextDir, sessionId)
    const blobPath = join(sessionDir, blob.filePath)
    rmSync(blobPath, { force: true })
    
    try {
      await manager.readManifest(manifest)
      expect(false).toBe(true)
    } catch (error) {
      const err = error as { code?: RlmErrorCode; message?: string }
      expect(err.code).toBe(RlmErrorCode.MANIFEST_INTEGRITY_ERROR)
      expect(err.message?.includes("existing")).toBe(true)
    }
  })

  it("readManifest throws MANIFEST_INTEGRITY_ERROR with all missing blob names when multiple are missing", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-integrity-multiple"
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, rootQuery: "test", taskPrompt: "test" })
    
    // Create two blob variables
    await manager.createBlobVariable(sessionId, { name: "blob_a", content: "A" })
    await manager.createBlobVariable(sessionId, { name: "blob_b", content: "B" })
    
    // Create a manifest referencing both blobs
    const manifest = await manager.createManifestVariable(sessionId, {
      name: "multi_manifest",
      variableNames: ["blob_a", "blob_b"],
    })
    
    // Delete both blob files from disk
    const session = await manager.getSession(sessionId)
    if (session) {
      for (const [, variable] of session.variables) {
        if (variable.storageKind === "blob") {
          const blobPath = join(contextDir, sessionId, variable.filePath)
          rmSync(blobPath, { force: true })
        }
      }
    }
    
    // readManifest should throw MANIFEST_INTEGRITY_ERROR with both missing names
    try {
      await manager.readManifest(manifest)
      expect(false).toBe(true) // Should not reach here
    } catch (error) {
      const err = error as { code?: RlmErrorCode; message?: string }
      expect(err.code).toBe(RlmErrorCode.MANIFEST_INTEGRITY_ERROR)
      expect(err.message?.includes("blob_a")).toBe(true)
      expect(err.message?.includes("blob_b")).toBe(true)
    }
  })

  it("readManifest throws MANIFEST_CORRUPT_ERROR when manifest file contains invalid JSON", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-corrupt-json"
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, rootQuery: "test", taskPrompt: "test" })
    
    // Create a blob variable
    await manager.createBlobVariable(sessionId, { name: "blob", content: "data" })
    
    // Create a manifest
    const manifest = await manager.createManifestVariable(sessionId, {
      name: "corrupt_manifest",
      variableNames: ["blob"],
    })
    
    // Corrupt the manifest file on disk
    const manifestPath = join(contextDir, sessionId, manifest.filePath)
    writeFileSync(manifestPath, "{ invalid json }", "utf8")
    
    // readManifest should throw MANIFEST_CORRUPT_ERROR
    try {
      await manager.readManifest(manifest)
      expect(false).toBe(true) // Should not reach here
    } catch (error) {
      const err = error as { code?: RlmErrorCode; message?: string }
      expect(err.code).toBe(RlmErrorCode.MANIFEST_CORRUPT_ERROR)
    }
  })

  it("readManifest throws MANIFEST_CORRUPT_ERROR when manifest is not an array", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-not-array"
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, rootQuery: "test", taskPrompt: "test" })
    
    // Create a blob variable
    await manager.createBlobVariable(sessionId, { name: "blob", content: "data" })
    
    // Create a manifest
    const manifest = await manager.createManifestVariable(sessionId, {
      name: "not_array_manifest",
      variableNames: ["blob"],
    })
    
    // Corrupt the manifest to be an object instead of array
    const manifestPath = join(contextDir, sessionId, manifest.filePath)
    writeFileSync(manifestPath, '{"items": ["blob"]}', "utf8")
    
    // readManifest should throw MANIFEST_CORRUPT_ERROR
    try {
      await manager.readManifest(manifest)
      expect(false).toBe(true) // Should not reach here
    } catch (error) {
      const err = error as { code?: RlmErrorCode; message?: string }
      expect(err.code).toBe(RlmErrorCode.MANIFEST_CORRUPT_ERROR)
    }
  })

  it("readManifest throws MANIFEST_CORRUPT_ERROR when manifest contains non-string items", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-non-string"
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, rootQuery: "test", taskPrompt: "test" })
    
    // Create a manifest
    const manifest = await manager.createManifestVariable(sessionId, {
      name: "non_string_manifest",
      variableNames: [],
    })
    
    // Corrupt the manifest to have non-string items
    const manifestPath = join(contextDir, sessionId, manifest.filePath)
    writeFileSync(manifestPath, '["string", 123, null]', "utf8")
    
    // readManifest should throw MANIFEST_CORRUPT_ERROR
    try {
      await manager.readManifest(manifest)
      expect(false).toBe(true) // Should not reach here
    } catch (error) {
      const err = error as { code?: RlmErrorCode; message?: string }
      expect(err.code).toBe(RlmErrorCode.MANIFEST_CORRUPT_ERROR)
    }
  })

  it("readManifest succeeds when all referenced blob files exist", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-valid-manifest"
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, rootQuery: "test", taskPrompt: "test" })
    
    // Create blob variables
    await manager.createBlobVariable(sessionId, { name: "blob1", content: "content1" })
    await manager.createBlobVariable(sessionId, { name: "blob2", content: "content2" })
    
    // Create a manifest
    const manifest = await manager.createManifestVariable(sessionId, {
      name: "valid_manifest",
      variableNames: ["blob1", "blob2"],
    })
    
    // readManifest should succeed and return the variable names
    const items = await manager.readManifest(manifest)
    expect(items).toEqual(["blob1", "blob2"])
  })

  it("readManifest succeeds with empty manifest when no blobs are referenced", async () => {
    const manager = await createManager()
    const contextDir = createTempDir()
    const sessionId = "ses-empty-manifest-valid"
    await manager.initSession(sessionId, { contextDir, maxDepth: 2, rootQuery: "test", taskPrompt: "test" })
    
    // Create an empty manifest
    const manifest = await manager.createManifestVariable(sessionId, {
      name: "empty_manifest",
      variableNames: [],
    })
    
    // readManifest should succeed and return empty array
    const items = await manager.readManifest(manifest)
    expect(items).toEqual([])
  })
})
