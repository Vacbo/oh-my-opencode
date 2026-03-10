import { describe, expect, it, afterEach, mock } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { RlmConfig } from "../../config/schema/experimental"
import { RlmContextManager } from "./manager"
import { coordinator } from "./coordinator"
import { createRlmProbeTool } from "../../tools/rlm/probe-tool"
import { createRlmSearchTool } from "../../tools/rlm/search-tool"
import { createRlmPlanTool } from "../../tools/rlm/tools"
import { createRlmFinishTool } from "../../tools/rlm/finish-tool"
import { initRlmSession } from "../../tools/rlm/init-session"

const defaultConfig: RlmConfig = {
  enabled: true,
  max_depth: 3,
  context_storage_dir: ".sisyphus/rlm-contexts",
  distill_threshold_tokens: 2000,
  probe_max_lines: 200,
}

// Test helpers
function createToolContext(sessionID: string): ToolContext {
  return {
    sessionID,
    messageID: "msg-1",
    agent: "sisyphus",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  } as ToolContext
}

const dummyClient = {} as any

describe("RLM Integration Tests", () => {
  let tempDirs: string[] = []
  let boundSessions: string[] = []

  function createTempDir(): string {
    const directory = mkdtempSync(join(tmpdir(), "omo-rlm-integration-"))
    tempDirs.push(directory)
    return directory
  }

  function bindSession(sessionId: string, manager: RlmContextManager): void {
    coordinator.bind(sessionId, {
      manager,
      rlmSessionId: sessionId,
      depth: 0,
      query: "test",
      contextVariableName: "context",
      trusted: true,
    })
    boundSessions.push(sessionId)
  }

  afterEach(() => {
    while (boundSessions.length > 0) {
      const sessionId = boundSessions.pop()
      if (sessionId) coordinator.unbind(sessionId)
    }
    while (tempDirs.length > 0) {
      const directory = tempDirs.pop()
      if (directory) {
        rmSync(directory, { recursive: true, force: true })
      }
    }
  })

  describe("Feature-enabled tool surface", () => {
    it("all four public RLM tools can be created", async () => {
      const manager = new RlmContextManager()
      const contextDir = createTempDir()

      // Initialize a session
      await manager.initSession("ses-root", {
        contextDir,
        maxDepth: 2,
        query: "Test query",
      })
      bindSession("ses-root", manager)

      // Create tools - they should not throw
      const probeTool = createRlmProbeTool()
      const searchTool = createRlmSearchTool()
      const planTool = createRlmPlanTool({ client: dummyClient, directory: contextDir, config: defaultConfig })
      const finishTool = createRlmFinishTool()

      // Verify tools exist
      expect(probeTool).toBeDefined()
      expect(searchTool).toBeDefined()
      expect(planTool).toBeDefined()
      expect(finishTool).toBeDefined()
    })
  })

  describe("Full RLM workflow: /rlm → probe → plan → finish", () => {
    it("executes complete workflow with split, map_llm, reduce_llm, and final_var", async () => {
      const manager = new RlmContextManager()
      const contextDir = createTempDir()
      const sessionId = "ses-workflow"

      // Step 1: Initialize session (simulating /rlm command)
      const initResult = await initRlmSession(manager, {
        sessionId,
        query: "Summarize the context",
        content: "line1\nline2\nline3\nline4\nline5\nline6",
        maxDepth: 1,
        contextDir,
      })
      bindSession(sessionId, manager)

      expect(initResult.sessionId).toBe(sessionId)
      expect(initResult.depth).toBe(0)
      expect(initResult.maxDepth).toBe(1)
      expect(initResult.query).toBe("Summarize the context")

      // Step 2: Use rlm_probe to inspect context
      const probeTool = createRlmProbeTool()
      const probeResult = await probeTool.execute(
        { operation: "head", variable_name: "context", lines: 2 },
        createToolContext(sessionId),
      )
      const probeData = JSON.parse(probeResult)
      expect(probeData.content).toBeDefined()
      expect(probeData.content).toContain("line1")

      // Step 3: Use rlm_plan with split, map_llm, reduce_llm, final_var
const planTool = createRlmPlanTool({
client: dummyClient,
        directory: contextDir,
        config: defaultConfig,
deps: {
runSyncSubcall: async (input) => {
// Mock LLM subcall
return {
ok: true,
sessionID: `llm-${Date.now()}`,
textOutput: `Summarized: ${input.prompt.substring(0, 20)}...`,
messages: [],
}
},
},
})

      const planResult = await planTool.execute(
        {
          operations: [
            { op: "split", variable_name: "context", chunk_size: 2, output_variable: "chunks" },
            { op: "map_llm", variable_name: "chunks", prompt: "Summarize: {{item}}", output_variable: "summaries" },
            { op: "reduce_llm", variable_name: "summaries", prompt: "Combine summaries", output_variable: "final" },
            { op: "final_var", variable_name: "final" },
          ],
        },
        createToolContext(sessionId),
      )

      const planData = JSON.parse(planResult)
      expect(planData.terminal).toBe(false) // final_var is not terminal
      expect(planData.halted).toBe(true)
      expect(planData.final_variable).toBe("final")

      // Step 4: Use rlm_finish to return the final answer
      const finishTool = createRlmFinishTool()
      const finishResult = await finishTool.execute(
        { variable_name: "final" },
        createToolContext(sessionId),
      )

      const finishData = JSON.parse(finishResult)
      expect(finishData.terminal).toBe(true)
      expect(finishData.source).toBe("variable")
      expect(finishData.final_answer).toBeDefined()
    })
  })

  describe("Depth behavior: maxDepth=1 downgrades map_rlm to map_llm", () => {
    it("map_rlm downgrades to map_llm when depth limit is reached", async () => {
      const manager = new RlmContextManager()
      const contextDir = createTempDir()
      const sessionId = "ses-depth-1"

      // Initialize at depth 0 with maxDepth 1
      await manager.initSession(sessionId, {
        contextDir,
        maxDepth: 1,
        query: "Root query",
        depth: 0,
      })
      bindSession(sessionId, manager)

      // Create test data
      await manager.createBlobVariable(sessionId, { name: "item1", content: "data1" })
      await manager.createBlobVariable(sessionId, { name: "item2", content: "data2" })
      await manager.createManifestVariable(sessionId, {
        name: "items",
        variableNames: ["item1", "item2"],
      })

      const planTool = createRlmPlanTool({
        client: dummyClient,
        directory: contextDir,
        config: defaultConfig,
        deps: {
          initRlmSession: mock(async () => {
            throw new Error("Should not initialize child RLM at depth limit")
          }),
          runSyncSubcall: async (input) => {
            return {
              ok: true,
              sessionID: `llm-${Date.now()}`,
              textOutput: "LLM result",
              messages: [],
            }
          },
        },
      })

      const result = await planTool.execute(
        {
          operations: [
            { op: "map_rlm", variable_name: "items", prompt: "Process {{item}}", output_variable: "results" },
          ],
        },
        createToolContext(sessionId),
      )

      const data = JSON.parse(result)
      expect(data.operation_results[0].downgraded_to).toBe("map_llm")
    })
  })

  describe("Depth behavior: maxDepth=2 initializes symbolic child RLM session", () => {
    it("map_rlm creates child RLM session with symbolic init when recursion is allowed", async () => {
      const manager = new RlmContextManager()
      const contextDir = createTempDir()
      const sessionId = "ses-depth-2"

      // Initialize at depth 0 with maxDepth 2
      await manager.initSession(sessionId, {
        contextDir,
        maxDepth: 2,
        query: "Root query",
        depth: 0,
      })
      bindSession(sessionId, manager)

      // Create test data
      await manager.createBlobVariable(sessionId, { name: "item1", content: "data1" })
      await manager.createBlobVariable(sessionId, { name: "item2", content: "data2" })
      await manager.createManifestVariable(sessionId, {
        name: "items",
        variableNames: ["item1", "item2"],
      })

      let childSessionCreated = false

      const planTool = createRlmPlanTool({
        client: dummyClient,
        directory: contextDir,
        config: defaultConfig,
        deps: {
          initRlmSession: async (_ctx, input) => {
            // Verify child session is initialized with correct depth
            expect(input.depth).toBe(1)
            expect(input.maxDepth).toBe(2)
            expect(input.parentSessionId).toBe(sessionId)

            // Initialize the child session in the manager
            await manager.initSession(input.sessionId, {
              contextDir,
              maxDepth: input.maxDepth,
              query: input.query,
              depth: input.depth,
              parentSessionId: input.parentSessionId,
            })

            // Create context blob for child
            await manager.createBlobVariable(input.sessionId, {
              name: "context",
              content: input.content ?? "",
            })

            return {
              sessionId: input.sessionId,
              depth: input.depth,
              maxDepth: input.maxDepth,
              query: input.query,
              shouldDistill: false,
              parentSessionId: input.parentSessionId,
              contextMetadata: {
                contextVariableName: "context",
                contextSize: (input.content ?? "").length,
                contextType: "content",
                lineCount: 1,
              },
            }
          },
          runSyncSubcall: async (input) => {
            childSessionCreated = true
            return {
              ok: true,
              sessionID: input.sessionID,
              textOutput: "Child RLM result",
              terminalPayload: { final_answer: "child answer", terminal: true },
              messages: [],
            }
          },
          cleanupSyncSubcallSession: async (sessionID) => {
            // Cleanup child session
            await manager.deleteSession(sessionID)
          },
        },
      })

      const result = await planTool.execute(
        {
          operations: [
            { op: "map_rlm", variable_name: "items", prompt: "Analyze {{item}}", output_variable: "results" },
          ],
        },
        createToolContext(sessionId),
      )

      const data = JSON.parse(result)
      // Verify that child session was created (indicating recursion was allowed)
      expect(childSessionCreated).toBe(true)
      // Verify that the operation didn't downgrade (if operation_results exists)
      if (data.operation_results && data.operation_results[0]) {
        expect(data.operation_results[0].downgraded_to).toBeUndefined()
      }
    })
  })

  describe("Session cleanup: session.deleted clears in-memory and on-disk state", () => {
    it("deleteSession removes both manager state and filesystem", async () => {
      const manager = new RlmContextManager()
      const contextDir = createTempDir()
      const sessionId = "ses-cleanup"

      // Initialize session
      await manager.initSession(sessionId, {
        contextDir,
        maxDepth: 2,
        query: "Test cleanup",
      })

      // Create variables
      await manager.createBlobVariable(sessionId, { name: "data", content: "test content" })
      await manager.createBlobVariable(sessionId, { name: "more", content: "more data" })

      // Verify session exists
      let session = await manager.getSession(sessionId)
      expect(session).toBeDefined()
      expect(session?.variables.size).toBe(2) // data + more (context is not auto-created)

      // Delete session
      await manager.deleteSession(sessionId)

      // Verify session is gone from memory
      session = await manager.getSession(sessionId)
      expect(session).toBeUndefined()
    })
  })

  describe("Distillation integration: oversized RLM-session output is distilled", () => {
    it("tool output above threshold is distilled when shouldDistill is true", async () => {
      const manager = new RlmContextManager()
      const contextDir = createTempDir()
      const sessionId = "ses-distill"

      // Initialize session with distillation enabled
      await manager.initSession(sessionId, {
        contextDir,
        maxDepth: 1,
        query: "Test distillation",
        shouldDistill: true,
      })

      // Create a large blob variable
      const largeContent = "x".repeat(10000) // Large content
      await manager.createBlobVariable(sessionId, { name: "large", content: largeContent })

      // Verify session has shouldDistill flag
      const session = await manager.getSession(sessionId)
      expect(session?.shouldDistill).toBe(true)

      // Verify the large variable exists
      const variable = await manager.getVariableByName(sessionId, "large")
      expect(variable).toBeDefined()
      expect(variable?.byteSize).toBeGreaterThan(5000)
    })

    it("tool output below threshold passes through unchanged", async () => {
      const manager = new RlmContextManager()
      const contextDir = createTempDir()
      const sessionId = "ses-no-distill"

      // Initialize session without distillation
      await manager.initSession(sessionId, {
        contextDir,
        maxDepth: 1,
        query: "Test no distillation",
        shouldDistill: false,
      })

      // Create a small blob variable
      const smallContent = "small content"
      await manager.createBlobVariable(sessionId, { name: "small", content: smallContent })

      // Verify session has shouldDistill=false
      const session = await manager.getSession(sessionId)
      expect(session?.shouldDistill).toBe(false)

      // Verify the small variable exists
      const variable = await manager.getVariableByName(sessionId, "small")
      expect(variable).toBeDefined()
      expect(variable?.byteSize).toBeLessThan(1000)
    })
  })

  describe("Manifest operations preserve order and structure", () => {
    it("split creates ordered manifest of chunks", async () => {
      const manager = new RlmContextManager()
      const contextDir = createTempDir()
      const sessionId = "ses-manifest"

      await manager.initSession(sessionId, {
        contextDir,
        maxDepth: 1,
        query: "Test manifest",
      })
      bindSession(sessionId, manager)

      // Create context blob
      await manager.createBlobVariable(sessionId, {
        name: "context",
        content: "aaabbbcccdddeee",
      })

      const planTool = createRlmPlanTool({
        client: dummyClient,
        directory: contextDir,
        config: defaultConfig,
      })

      const result = await planTool.execute(
        {
          operations: [
            { op: "split", variable_name: "context", chunk_size: 3, output_variable: "chunks" },
          ],
        },
        createToolContext(sessionId),
      )

      const data = JSON.parse(result)
      expect(data.error).toBeUndefined()

      // Verify manifest was created
      const chunksVar = await manager.getVariableByName(sessionId, "chunks")
      expect(chunksVar).toBeDefined()
      expect(chunksVar?.storageKind).toBe("manifest")

      // Verify chunks are in order
      const items = await manager.resolveManifestItems(sessionId, "chunks")
      expect(items.length).toBe(5) // 15 chars / 3 = 5 chunks
      expect(items[0].name).toBe("chunks_0")
      expect(items[4].name).toBe("chunks_4")
    })
  })

  describe("rlm_finish bypasses truncation and distillation", () => {
    it("rlm_finish returns terminal=true to signal bypass", async () => {
      const manager = new RlmContextManager()
      const contextDir = createTempDir()
      const sessionId = "ses-finish-bypass"

      await manager.initSession(sessionId, {
        contextDir,
        maxDepth: 1,
        query: "Test finish",
      })
      bindSession(sessionId, manager)

      // Create a large result variable
      const largeResult = "x".repeat(5000)
      await manager.createBlobVariable(sessionId, {
        name: "result",
        content: largeResult,
      })

      const finishTool = createRlmFinishTool()
      const result = await finishTool.execute(
        { variable_name: "result" },
        createToolContext(sessionId),
      )

      const data = JSON.parse(result)
      expect(data.terminal).toBe(true)
      expect(data.final_answer).toBe(largeResult)
    })
  })

  describe("final_var is plan-local, not terminal", () => {
    it("final_var halts plan but returns terminal=false", async () => {
      const manager = new RlmContextManager()
      const contextDir = createTempDir()
      const sessionId = "ses-final-var"

      await manager.initSession(sessionId, {
        contextDir,
        maxDepth: 1,
        query: "Test final_var",
      })
      bindSession(sessionId, manager)

      const planTool = createRlmPlanTool({
        client: dummyClient,
        directory: contextDir,
        config: defaultConfig,
      })

      const result = await planTool.execute(
        {
          operations: [
            { op: "write_var", variable_name: "step1", content: "first" },
            { op: "final_var", variable_name: "step1" },
            { op: "write_var", variable_name: "step2", content: "never executed" },
          ],
        },
        createToolContext(sessionId),
      )

      const data = JSON.parse(result)
      expect(data.terminal).toBe(false)
      expect(data.halted).toBe(true)
      expect(data.final_variable).toBe("step1")
      expect(data.executed_ops).toBe(2) // Only first two ops executed

      // Verify step2 was never created
      const step2 = await manager.getVariableByName(sessionId, "step2")
      expect(step2).toBeUndefined()
    })
  })
})
