import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { PersistedSession } from "./persistence"

type ExpectChain = {
  toBe: (expected: unknown) => void
  toEqual: (expected: unknown) => void
  toBeDefined: () => void
  toBeUndefined: () => void
  toBeGreaterThan: (expected: number) => void
  toBeLessThanOrEqual: (expected: number) => void
}

type BunTestModule = {
  afterEach: (fn: () => void) => void
  describe: (name: string, fn: () => void) => void
  it: (name: string, fn: () => void | Promise<void>) => void
  expect: (value: unknown) => ExpectChain
}

const bunTestSpecifier = "bun:test"
const { afterEach, describe, expect, it } = (await import(bunTestSpecifier)) as BunTestModule

const persistenceModulePath = "./persistence"
const coordinatorModulePath = "./coordinator"
const managerModulePath = "./manager"

type CreateRlmPersistenceFn = typeof import("./persistence").createRlmPersistence
type RlmSessionCoordinatorClass = typeof import("./coordinator").RlmSessionCoordinator
type RlmContextManagerClass = typeof import("./manager").RlmContextManager

async function loadModules() {
  const persistenceMod = (await import(persistenceModulePath)) as { createRlmPersistence: CreateRlmPersistenceFn }
  const coordinatorMod = (await import(coordinatorModulePath)) as { RlmSessionCoordinator: RlmSessionCoordinatorClass }
  const managerMod = (await import(managerModulePath)) as { RlmContextManager: RlmContextManagerClass }
  return {
    createRlmPersistence: persistenceMod.createRlmPersistence,
    RlmSessionCoordinator: coordinatorMod.RlmSessionCoordinator,
    RlmContextManager: managerMod.RlmContextManager,
  }
}

const tempDirs: string[] = []

function createTempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "omo-rlm-persist-"))
  tempDirs.push(directory)
  return directory
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop()
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  }
})

function createValidMetadata(overrides: Partial<PersistedSession> = {}): PersistedSession {
  return {
    rootChatSessionId: "root-chat-1",
    rlmSessionId: "rlm-ses-1",
    query: "test query",
    depth: 0,
    maxDepth: 2,
    contextVariableName: "context",
    trusted: true,
    variableManifest: [],
    timestamp: Date.now(),
    ...overrides,
  }
}

describe("rlm persistence", () => {
  describe("#given persistence is enabled", () => {
    describe("#when a valid session is persisted", () => {
      it("#then recovers it correctly with binding and session state", async () => {
        const { createRlmPersistence, RlmSessionCoordinator, RlmContextManager } = await loadModules()
        const storageDir = createTempDir()
        const persistence = createRlmPersistence({
          enabled: true,
          context_storage_dir: storageDir,
        })
        const manager = new RlmContextManager()
        const coordinator = new RlmSessionCoordinator()

        const session = await manager.initSession("rlm-ses-1", {
          maxDepth: 2,
          contextDir: storageDir,
          query: "test query",
        })
        await manager.createBlobVariable("rlm-ses-1", { name: "ctx", content: "hello world" })

        await persistence.persist("root-chat-1", {
          manager,
          rlmSessionId: "rlm-ses-1",
          depth: 0,
          query: "test query",
          contextVariableName: "context",
          trusted: true,
        }, manager)

        const metadataPath = join(storageDir, "rlm-ses-1", "metadata.json")
        expect(existsSync(metadataPath)).toBe(true)

        const freshManager = new RlmContextManager()
        const freshCoordinator = new RlmSessionCoordinator()
        const recovered = await persistence.recover(freshCoordinator, freshManager)

        expect(recovered).toBe(1)
        const binding = freshCoordinator.resolve("root-chat-1")
        expect(binding).toBeDefined()
        expect(binding?.rlmSessionId).toBe("rlm-ses-1")
        expect(binding?.query).toBe("test query")
        expect(binding?.trusted).toBe(true)

        const restoredSession = await freshManager.getSession("rlm-ses-1")
        expect(restoredSession).toBeDefined()
        expect(restoredSession?.variables.has("ctx")).toBe(true)
      })
    })

    describe("#when metadata JSON is corrupt", () => {
      it("#then quarantines the session and does not load it", async () => {
        const { createRlmPersistence, RlmSessionCoordinator, RlmContextManager } = await loadModules()
        const storageDir = createTempDir()
        const persistence = createRlmPersistence({
          enabled: true,
          context_storage_dir: storageDir,
        })

        const sessionDir = join(storageDir, "corrupt-ses")
        mkdirSync(sessionDir, { recursive: true })
        writeFileSync(join(sessionDir, "metadata.json"), "{ invalid json !!!", "utf8")

        const coordinator = new RlmSessionCoordinator()
        const manager = new RlmContextManager()
        const recovered = await persistence.recover(coordinator, manager)

        expect(recovered).toBe(0)
        expect(coordinator.resolve("root-chat-1")).toBeUndefined()

        const quarantinePath = join(storageDir, ".quarantine", "corrupt-ses")
        expect(existsSync(quarantinePath)).toBe(true)
        const reason = readFileSync(join(quarantinePath, "reason.txt"), "utf8")
        expect(reason.length).toBeGreaterThan(0)
      })
    })

    describe("#when a blob file is missing", () => {
      it("#then quarantines the session", async () => {
        const { createRlmPersistence, RlmSessionCoordinator, RlmContextManager } = await loadModules()
        const storageDir = createTempDir()
        const persistence = createRlmPersistence({
          enabled: true,
          context_storage_dir: storageDir,
        })

        const sessionDir = join(storageDir, "missing-blob-ses")
        mkdirSync(sessionDir, { recursive: true })
        const metadata = createValidMetadata({
          rlmSessionId: "missing-blob-ses",
          variableManifest: [{
            name: "ctx",
            storageKind: "blob",
            semanticType: "context",
            filePath: "ctx-nonexistent.blob",
            byteSize: 100,
            lineCount: 5,
            source: "content",
          }],
        })
        writeFileSync(join(sessionDir, "metadata.json"), JSON.stringify(metadata), "utf8")

        const coordinator = new RlmSessionCoordinator()
        const manager = new RlmContextManager()
        const recovered = await persistence.recover(coordinator, manager)

        expect(recovered).toBe(0)
        expect(existsSync(join(storageDir, ".quarantine", "missing-blob-ses"))).toBe(true)
      })
    })

    describe("#when a blob file has wrong size", () => {
      it("#then quarantines the session", async () => {
        const { createRlmPersistence, RlmSessionCoordinator, RlmContextManager } = await loadModules()
        const storageDir = createTempDir()
        const persistence = createRlmPersistence({
          enabled: true,
          context_storage_dir: storageDir,
        })

        const sessionDir = join(storageDir, "wrong-size-ses")
        mkdirSync(sessionDir, { recursive: true })
        writeFileSync(join(sessionDir, "data.blob"), "short", "utf8")
        const metadata = createValidMetadata({
          rlmSessionId: "wrong-size-ses",
          variableManifest: [{
            name: "data",
            storageKind: "blob",
            semanticType: "context",
            filePath: "data.blob",
            byteSize: 999,
            lineCount: 1,
            source: "content",
          }],
        })
        writeFileSync(join(sessionDir, "metadata.json"), JSON.stringify(metadata), "utf8")

        const coordinator = new RlmSessionCoordinator()
        const manager = new RlmContextManager()
        const recovered = await persistence.recover(coordinator, manager)

        expect(recovered).toBe(0)
        const quarantineReason = readFileSync(
          join(storageDir, ".quarantine", "wrong-size-ses", "reason.txt"),
          "utf8",
        )
        expect(quarantineReason.length).toBeGreaterThan(0)
      })
    })

    describe("#when recovery takes too long", () => {
      it("#then returns 0 after timeout", async () => {
        const { createRlmPersistence, RlmSessionCoordinator, RlmContextManager } = await loadModules()
        const storageDir = createTempDir()

        const sessionDir = join(storageDir, "slow-ses")
        mkdirSync(sessionDir, { recursive: true })
        const metadata = createValidMetadata({ rlmSessionId: "slow-ses" })
        writeFileSync(join(sessionDir, "metadata.json"), JSON.stringify(metadata), "utf8")

        const slowManager = new RlmContextManager()
        const originalInit = slowManager.initSession.bind(slowManager)
        slowManager.initSession = async (...args) => {
          await new Promise((r) => setTimeout(r, 5000))
          return originalInit(...args)
        }

        const persistence = createRlmPersistence({
          enabled: true,
          context_storage_dir: storageDir,
          recovery_timeout_ms: 500,
        })
        const coordinator = new RlmSessionCoordinator()

        const start = Date.now()
        const recovered = await persistence.recover(coordinator, slowManager)
        const elapsed = Date.now() - start

        expect(recovered).toBe(0)
        expect(elapsed).toBeLessThanOrEqual(2000)
      })
    })
  })

  describe("#given persistence is disabled", () => {
    it("#then persist is a no-op", async () => {
      const { createRlmPersistence, RlmContextManager } = await loadModules()
      const storageDir = createTempDir()
      const persistence = createRlmPersistence({
        enabled: false,
        context_storage_dir: storageDir,
      })
      const manager = new RlmContextManager()
      await manager.initSession("ses-1", {
        maxDepth: 2,
        contextDir: storageDir,
        query: "q",
      })

      await persistence.persist("root-1", {
        manager,
        rlmSessionId: "ses-1",
        depth: 0,
        query: "q",
        contextVariableName: "ctx",
        trusted: false,
      }, manager)

      expect(existsSync(join(storageDir, "ses-1", "metadata.json"))).toBe(false)
    })

    it("#then recover returns 0 without errors", async () => {
      const { createRlmPersistence, RlmSessionCoordinator, RlmContextManager } = await loadModules()
      const storageDir = createTempDir()
      const persistence = createRlmPersistence({
        enabled: false,
        context_storage_dir: storageDir,
      })

      const recovered = await persistence.recover(
        new RlmSessionCoordinator(),
        new RlmContextManager(),
      )
      expect(recovered).toBe(0)
    })

    it("#then cleanup is a no-op without errors", async () => {
      const { createRlmPersistence } = await loadModules()
      const storageDir = createTempDir()
      const persistence = createRlmPersistence({
        enabled: false,
        context_storage_dir: storageDir,
      })

      await persistence.cleanup("nonexistent")
      expect(true).toBe(true)
    })
  })
})
