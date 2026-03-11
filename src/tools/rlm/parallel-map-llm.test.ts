import { describe, expect, test } from "bun:test"
import type { RlmBlobVariable, RlmManifestVariable } from "../../features/rlm-context/types"
import type { RlmPlanExecutorDeps } from "./plan-deps"
import type { RlmContextManagerForPlan, RlmPlanToolOptions } from "./plan-tool"
import type { SyncSubcallInput, SyncSubcallResult } from "./subcall-runner"
import { executeMapLlmOperation } from "./plan-subcall-ops"

function makeBlob(name: string, sessionId = "ses-test"): RlmBlobVariable {
  return {
    sessionId,
    name,
    storageKind: "blob",
    semanticType: "context",
    createdAt: Date.now(),
    filePath: `${name}.blob`,
    byteSize: 10,
    source: "content",
    lineCount: 1,
  }
}

function makeManifest(name: string, count: number, sessionId = "ses-test"): RlmManifestVariable {
  return {
    sessionId,
    name,
    storageKind: "manifest",
    semanticType: "result",
    createdAt: Date.now(),
    filePath: `${name}.manifest.json`,
    byteSize: 10,
    itemCount: count,
  }
}

function createMockContextManager(items: { name: string; content: string }[]) {
  const blobs = items.map((item) => makeBlob(item.name))
  const contentMap = new Map(items.map((item) => [item.name, item.content]))
  const createdBlobs: { name: string; content: string }[] = []
  let createdManifest: { name: string; variableNames: string[] } | null = null

  const contextManager: RlmContextManagerForPlan = {
    resolveManifestItems: async () => blobs,
    readBlobContent: async (v: RlmBlobVariable) => contentMap.get(v.name) ?? "",
    createBlobVariable: async (_sid: string, input: { name: string; content?: string }) => {
      createdBlobs.push({ name: input.name, content: input.content ?? "" })
      return makeBlob(input.name)
    },
    createManifestVariable: async (_sid: string, input: { name: string; variableNames: string[] }) => {
      createdManifest = input
      return makeManifest(input.name, input.variableNames.length)
    },
    getSession: () => undefined,
    initSession: async () => ({
      sessionId: "ses-test",
      depth: 0,
      maxDepth: 2,
      contextDir: "/tmp",
      query: "test",
      shouldDistill: false,
      variables: new Map(),
    }),
    getVariableByName: async () => undefined,
    deleteSession: async () => {},
  }

  return { contextManager, getCreatedBlobs: () => createdBlobs, getCreatedManifest: () => createdManifest }
}

function successResult(index: number): SyncSubcallResult {
  return {
    ok: true,
    sessionID: `ses-child-${index}`,
    textOutput: `result-${index}`,
    messages: [],
  }
}

function failureResult(error: string, sessionID?: string): SyncSubcallResult {
  return { ok: false, error, sessionID }
}

const baseSession = {
  sessionId: "ses-test",
  depth: 0,
  maxDepth: 2,
  contextDir: "/tmp",
  query: "test query",
  shouldDistill: false,
  variables: new Map(),
}

const BASE_RLM_SESSION_ID = "rlm-ses-test"

const baseContext = {
  sessionID: "ses-test",
  agent: "test-agent",
  abort: new AbortController().signal,
} as Parameters<typeof executeMapLlmOperation>[2]

function createBaseOptions(parallelConfig?: { enabled: boolean; max_concurrent: number; fallback_chain: string[] }): RlmPlanToolOptions {
  return {
    client: {} as RlmPlanToolOptions["client"],
    directory: "/tmp",
    config: {
      enabled: true,
      max_depth: 2,
      context_storage_dir: "/tmp",
      distill_threshold_tokens: 2000,
      probe_max_lines: 200,
      parallel: parallelConfig,
    },
  }
}

describe("executeMapLlmOperation", () => {
  describe("#given parallel disabled", () => {
    test("#when items are processed #then executes sequentially", async () => {
      //#given
      const callOrder: number[] = []
      const { contextManager } = createMockContextManager([
        { name: "item_0", content: "content-0" },
        { name: "item_1", content: "content-1" },
      ])
      let callIndex = 0
      const deps = {
        runSyncSubcall: async () => {
          const idx = callIndex++
          callOrder.push(idx)
          return successResult(idx)
        },
        cleanupSyncSubcallSession: () => {},
        initRlmSession: () => Promise.resolve(baseSession),
        parseFinalAnswer: () => null,
      } as unknown as RlmPlanExecutorDeps
      const options = createBaseOptions()

      //#when
      const result = await executeMapLlmOperation(
        contextManager, options, baseContext, BASE_RLM_SESSION_ID, baseSession,
        { variable_name: "input", prompt: "{{item}}", output_variable: "output" },
        deps,
      )

      //#then
      expect(result.mapped_count).toBe(2)
      expect(callOrder).toEqual([0, 1])
    })
  })

  describe("#given parallel enabled with max_concurrent=2", () => {
    test("#when 4 items are processed #then completes in 2 batches", async () => {
      //#given
      let concurrentCount = 0
      let maxConcurrent = 0
      const batchBoundaries: number[] = []
      const items = Array.from({ length: 4 }, (_, i) => ({
        name: `item_${i}`,
        content: `content-${i}`,
      }))
      const { contextManager } = createMockContextManager(items)

      const deps = {
        runSyncSubcall: async (input: SyncSubcallInput) => {
          concurrentCount++
          if (concurrentCount > maxConcurrent) {
            maxConcurrent = concurrentCount
          }
          batchBoundaries.push(concurrentCount)
          await new Promise((r) => setTimeout(r, 10))
          concurrentCount--
          const idx = parseInt(input.title.match(/(\d+)\//)?.[1] ?? "0", 10) - 1
          return successResult(idx)
        },
        cleanupSyncSubcallSession: () => {},
        initRlmSession: () => Promise.resolve(baseSession),
        parseFinalAnswer: () => null,
      } as unknown as RlmPlanExecutorDeps
      const options = createBaseOptions({ enabled: true, max_concurrent: 2, fallback_chain: [] })

      //#when
      const result = await executeMapLlmOperation(
        contextManager, options, baseContext, BASE_RLM_SESSION_ID, baseSession,
        { variable_name: "input", prompt: "{{item}}", output_variable: "output" },
        deps,
      )

      //#then
      expect(result.mapped_count).toBe(4)
      expect(maxConcurrent).toBe(2)
    })

    test("#when all items succeed #then results are in correct order", async () => {
      //#given
      const items = Array.from({ length: 4 }, (_, i) => ({
        name: `item_${i}`,
        content: `content-${i}`,
      }))
      const { contextManager, getCreatedBlobs, getCreatedManifest } = createMockContextManager(items)

      const deps = {
        runSyncSubcall: async (input: SyncSubcallInput) => {
          const idx = parseInt(input.title.match(/(\d+)\//)?.[1] ?? "0", 10) - 1
          await new Promise((r) => setTimeout(r, Math.random() * 20))
          return successResult(idx)
        },
        cleanupSyncSubcallSession: () => {},
        initRlmSession: () => Promise.resolve(baseSession),
        parseFinalAnswer: () => null,
      } as unknown as RlmPlanExecutorDeps
      const options = createBaseOptions({ enabled: true, max_concurrent: 2, fallback_chain: [] })

      //#when
      await executeMapLlmOperation(
        contextManager, options, baseContext, BASE_RLM_SESSION_ID, baseSession,
        { variable_name: "input", prompt: "{{item}}", output_variable: "output" },
        deps,
      )

      //#then
      const blobs = getCreatedBlobs()
      expect(blobs.map((b) => b.name)).toEqual(["output_0", "output_1", "output_2", "output_3"])
      expect(blobs.map((b) => b.content)).toEqual(["result-0", "result-1", "result-2", "result-3"])

      const manifest = getCreatedManifest()
      expect(manifest).not.toBeNull()
      expect(manifest?.variableNames).toEqual(["output_0", "output_1", "output_2", "output_3"])
    })

    test("#when one item fails #then cleans up and throws with no partial manifest", async () => {
      //#given
      const items = Array.from({ length: 4 }, (_, i) => ({
        name: `item_${i}`,
        content: `content-${i}`,
      }))
      const { contextManager, getCreatedBlobs, getCreatedManifest } = createMockContextManager(items)
      const cleanedSessions: string[] = []

      const deps = {
        runSyncSubcall: async (input: SyncSubcallInput) => {
          const idx = parseInt(input.title.match(/(\d+)\//)?.[1] ?? "0", 10) - 1
          if (idx === 1) {
            return failureResult("model unavailable", "ses-fail-1")
          }
          return successResult(idx)
        },
        cleanupSyncSubcallSession: (sid: string) => {
          cleanedSessions.push(sid)
        },
        initRlmSession: () => Promise.resolve(baseSession),
        parseFinalAnswer: () => null,
      } as unknown as RlmPlanExecutorDeps
      const options = createBaseOptions({ enabled: true, max_concurrent: 2, fallback_chain: [] })

      //#when + #then
      let error: unknown
      try {
        await executeMapLlmOperation(
          contextManager, options, baseContext, BASE_RLM_SESSION_ID, baseSession,
          { variable_name: "input", prompt: "{{item}}", output_variable: "output" },
          deps,
        )
      } catch (caught) {
        error = caught
      }

      expect(error).toBeInstanceOf(Error)
      if (!(error instanceof Error)) {
        throw new Error("expected parallel map_llm to throw")
      }
      expect(error.message).toContain("Parallel map_llm failed")

      expect(getCreatedBlobs()).toHaveLength(0)
      expect(getCreatedManifest()).toBeNull()
      expect(cleanedSessions).toContain("ses-child-0")
      expect(cleanedSessions).toContain("ses-fail-1")
    })
  })
})
