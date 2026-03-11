import { describe, expect, it, mock, afterEach } from "bun:test"
import { createRlmPlanTool } from "./plan-tool"
import type { RlmConfig } from "../../config/schema/experimental"
import {
  InMemoryRlmManager,
  createSession,
  createToolContext,
  dummyClient,
  bindTestCoordinator,
  testRlmSessionId,
  unbindTestCoordinator,
} from "./plan-tool.test-helpers"

const defaultConfig: RlmConfig = {
  enabled: true,
  max_depth: 3,
  context_storage_dir: ".sisyphus/rlm-contexts",
  distill_threshold_tokens: 2000,
  probe_max_lines: 200,
}

const ROOT_SESSION_ID = "ses-root"
const ROOT_RLM_SESSION_ID = testRlmSessionId(ROOT_SESSION_ID)

describe("createRlmPlanTool", () => {
  afterEach(() => {
    unbindTestCoordinator(ROOT_SESSION_ID)
  })

  it("split and select produce manifest variables referencing real blob vars", async () => {
    const manager = new InMemoryRlmManager()
    manager.seedSession(createSession(ROOT_RLM_SESSION_ID, "query", 0, 3))
    manager.createBlobVariable(ROOT_RLM_SESSION_ID, { name: "context", content: "aaabbbccc" })
    bindTestCoordinator(ROOT_SESSION_ID, manager)

    const tool = createRlmPlanTool({ client: dummyClient, directory: "/tmp", config: defaultConfig })
    const raw = await tool.execute({
      operations: [
        { op: "split", variable_name: "context", chunk_size: 3, output_variable: "chunks" },
        { op: "select", variable_name: "chunks", indices: [2, 0], output_variable: "picked" },
      ],
    }, createToolContext(ROOT_SESSION_ID))

    expect(JSON.parse(raw).error).toBeUndefined()
    const picked = manager.resolveManifestItems(ROOT_RLM_SESSION_ID, "picked")
    expect(picked.map((blob) => blob.name)).toEqual(["chunks_2", "chunks_0"])
    expect(picked.map((blob) => manager.readBlobContent(blob))).toEqual(["ccc", "aaa"])
  })

  it("map_rlm downgrades to map_llm at depth limit and expands {{query}}/{{item}}", async () => {
    const manager = new InMemoryRlmManager()
    manager.seedSession(createSession(ROOT_RLM_SESSION_ID, "Persisted query", 1, 2))
    manager.createBlobVariable(ROOT_RLM_SESSION_ID, { name: "a", content: "one" })
    manager.createBlobVariable(ROOT_RLM_SESSION_ID, { name: "b", content: "two" })
    manager.createManifestVariable(ROOT_RLM_SESSION_ID, { name: "chunks", variableNames: ["a", "b"] })
    bindTestCoordinator(ROOT_SESSION_ID, manager, { depth: 1, query: "Persisted query" })

    const prompts: string[] = []
    const initSpy = mock(async () => {
      throw new Error("should not initialize recursive child when downgraded")
    })
    const tool = createRlmPlanTool({
      client: dummyClient,
      directory: "/tmp",
      config: defaultConfig,
      deps: {
        initRlmSession: initSpy,
        runSyncSubcall: async (input) => {
          prompts.push(input.prompt)
          return { ok: true, sessionID: `llm-${prompts.length}`, textOutput: "mapped", messages: [] }
        },
      },
    })

    const raw = await tool.execute({
      operations: [{ op: "map_rlm", variable_name: "chunks", prompt: "Q={{query}} I={{item}}", output_variable: "out" }],
    }, createToolContext(ROOT_SESSION_ID))
    const parsed = JSON.parse(raw) as { operation_results: Array<{ downgraded_to?: string }> }

    expect(prompts).toEqual(["Q=Persisted query I=one", "Q=Persisted query I=two"])
    expect(parsed.operation_results[0].downgraded_to).toBe("map_llm")
    expect(initSpy).not.toHaveBeenCalled()
  })

  it("map_rlm uses terminal payload first, FINAL_VAR fallback second, and cleans up", async () => {
    const manager = new InMemoryRlmManager()
    manager.seedSession(createSession(ROOT_RLM_SESSION_ID, "root query", 0, 3))
    manager.createBlobVariable(ROOT_RLM_SESSION_ID, { name: "x", content: "chunk-x" })
    manager.createBlobVariable(ROOT_RLM_SESSION_ID, { name: "y", content: "chunk-y" })
    manager.createManifestVariable(ROOT_RLM_SESSION_ID, { name: "chunks", variableNames: ["x", "y"] })
    bindTestCoordinator(ROOT_SESSION_ID, manager, { query: "root query" })

    let callCount = 0
    const cleanupCalls: string[] = []
    const tool = createRlmPlanTool({
      client: dummyClient,
      directory: "/tmp",
      config: defaultConfig,
      deps: {
        initRlmSession: async (_ctx, input) => {
          manager.seedSession(createSession(input.sessionId, input.query, input.depth ?? 0, input.maxDepth))
          manager.createBlobVariable(input.sessionId, { name: "context", content: input.content ?? "" })
          return {
            sessionId: input.sessionId,
            depth: input.depth ?? 0,
            maxDepth: input.maxDepth,
            query: input.query,
            shouldDistill: false,
            contextMetadata: { contextVariableName: "context", contextSize: 0, contextType: "content", lineCount: 1 },
          }
        },
        cleanupSyncSubcallSession: (sessionID) => {
          cleanupCalls.push(sessionID)
        },
        runSyncSubcall: async (input) => {
          callCount += 1
          const childID = `child-${callCount}`
          await input.onSessionCreated?.(childID)
          if (callCount === 1) {
            return {
              ok: true,
              sessionID: childID,
              textOutput: "FINAL(ignored)",
              terminalPayload: { final_answer: "from-finish", terminal: true },
              messages: [],
            }
          }
          manager.createBlobVariable(childID, { name: "child_result", content: "from-final-var" })
          return { ok: true, sessionID: childID, textOutput: "FINAL_VAR(child_result)", messages: [] }
        },
      },
    })

    await tool.execute({
      operations: [{ op: "map_rlm", variable_name: "chunks", prompt: "Analyze {{query}}", output_variable: "mapped" }],
    }, createToolContext(ROOT_SESSION_ID))

    const mapped = manager.resolveManifestItems(ROOT_RLM_SESSION_ID, "mapped")
    expect(mapped.map((blob) => manager.readBlobContent(blob))).toEqual(["from-finish", "from-final-var"])
    expect(manager.deletedSessions.sort()).toEqual(["child-1", "child-2"])
    expect(cleanupCalls.sort()).toEqual(["child-1", "child-2"])
  })

  it("final_var halts the plan and returns terminal=false", async () => {
    const manager = new InMemoryRlmManager()
    manager.seedSession(createSession(ROOT_RLM_SESSION_ID, "query", 0, 3))
    bindTestCoordinator(ROOT_SESSION_ID, manager)

    const tool = createRlmPlanTool({ client: dummyClient, directory: "/tmp", config: defaultConfig })

    const raw = await tool.execute({
      operations: [
        { op: "write_var", variable_name: "first", content: "ok" },
        { op: "final_var", variable_name: "first" },
        { op: "write_var", variable_name: "never", content: "nope" },
      ],
    }, createToolContext(ROOT_SESSION_ID))
    const parsed = JSON.parse(raw) as { terminal: boolean; halted: boolean; result_variable: string; executed_ops: number }

    expect(parsed.terminal).toBe(false)
    expect(parsed.halted).toBe(true)
    expect(parsed.result_variable).toBe("first")
    expect(parsed.executed_ops).toBe(2)
    expect(manager.getVariableByName(ROOT_RLM_SESSION_ID, "never")).toBeUndefined()
  })
})
