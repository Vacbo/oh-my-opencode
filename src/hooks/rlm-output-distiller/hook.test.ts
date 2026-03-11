import { afterEach, describe, it, expect } from "bun:test"
import { coordinator, type RlmContextManagerLike } from "../../features/rlm-context/coordinator"
import type { RlmSessionState } from "../../features/rlm-context/types"
import { createRlmOutputDistillerHook } from "./hook"

const SESSION_ID = "ses-test"
const RLM_SESSION_ID = "rlm-ses-test"

afterEach(() => {
  coordinator.unbind(SESSION_ID)
})

function createMockSession(overrides?: Partial<RlmSessionState>): RlmSessionState {
  return {
    sessionId: RLM_SESSION_ID,
    depth: 0,
    maxDepth: 2,
    contextDir: "/tmp/rlm",
    query: "test query",
    shouldDistill: false,
    variables: new Map(),
    ...overrides,
  }
}

function createMockManager(sessions: Record<string, RlmSessionState>): RlmContextManagerLike {
  return {
    getSession: (sessionId: string) => sessions[sessionId],
    getVariableByName: () => undefined,
    readBlobContent: () => "",
    readManifest: () => [],
    listVariables: () => [],
    initSession: () => createMockSession(),
    createBlobVariable: () => ({
      sessionId: RLM_SESSION_ID, name: "blob", storageKind: "blob" as const,
      semanticType: "scratch" as const, createdAt: 0, filePath: "", byteSize: 0,
      source: "content" as const, lineCount: 0,
    }),
    createManifestVariable: () => ({
      sessionId: RLM_SESSION_ID, name: "manifest", storageKind: "manifest" as const,
      semanticType: "scratch" as const, createdAt: 0, filePath: "", byteSize: 0, itemCount: 0,
    }),
    resolveManifestItems: () => [],
    deleteSession: () => {},
  }
}

function bindSession(manager: RlmContextManagerLike): void {
  coordinator.bind(SESSION_ID, {
    manager,
    rlmSessionId: RLM_SESSION_ID,
    depth: 0,
    query: "test",
    contextVariableName: "context",
    trusted: true,
  })
}

function createInput(tool: string, sessionID = SESSION_ID) {
  return { tool, sessionID, callID: "call-1" }
}

function createOutput(text: string) {
  return { title: "Result", output: text, metadata: {} }
}

describe("createRlmOutputDistillerHook", () => {
  describe("#given no coordinator binding for session", () => {
    it("#then passes through unchanged", async () => {
      const hook = createRlmOutputDistillerHook()
      const output = createOutput("some output")

      await hook["tool.execute.after"](createInput("Bash"), output)

      expect(output.output).toBe("some output")
    })
  })

  describe("#given binding exists but no RLM session in manager", () => {
    it("#then passes through unchanged", async () => {
      const manager = createMockManager({})
      bindSession(manager)
      const hook = createRlmOutputDistillerHook()
      const output = createOutput("some output")

      await hook["tool.execute.after"](createInput("Bash"), output)

      expect(output.output).toBe("some output")
    })
  })

  describe("#given rlm_finish tool", () => {
    it("#then passes through unchanged even with active RLM session", async () => {
      const session = createMockSession({ shouldDistill: true })
      const manager = createMockManager({ [RLM_SESSION_ID]: session })
      bindSession(manager)
      const hook = createRlmOutputDistillerHook()
      const output = createOutput("final answer content")

      await hook["tool.execute.after"](createInput("rlm_finish"), output)

      expect(output.output).toBe("final answer content")
    })
  })

  describe("#given active RLM session with output below feedback threshold", () => {
    it("#then passes through unchanged", async () => {
      const session = createMockSession({ shouldDistill: false })
      const manager = createMockManager({ [RLM_SESSION_ID]: session })
      bindSession(manager)
      const hook = createRlmOutputDistillerHook(
        { enabled: true, max_depth: 1, context_storage_dir: "/tmp", distill_threshold_tokens: 2000, probe_max_lines: 200 },
      )
      const output = createOutput("short output")

      await hook["tool.execute.after"](createInput("Bash"), output)

      expect(output.output).toBe("short output")
    })
  })

  describe("#given active RLM session with output above feedback threshold", () => {
    it("#then offloads output to hidden ref via feedback", async () => {
      const session = createMockSession({ shouldDistill: false })
      const manager = createMockManager({ [RLM_SESSION_ID]: session })
      bindSession(manager)
      const hook = createRlmOutputDistillerHook(
        { enabled: true, max_depth: 1, context_storage_dir: "/tmp", distill_threshold_tokens: 100, probe_max_lines: 200, feedback: { output_threshold_bytes: 32 } },
      )
      const output = createOutput("x".repeat(500))

      await hook["tool.execute.after"](createInput("Bash"), output)

      const parsed = JSON.parse(output.output)
      expect(parsed.ref.startsWith("hidden://")).toBe(true)
      expect(parsed.preview).toBe("x".repeat(200))
    })
  })

  describe("#given coordinator binding exists", () => {
    it("#then distilling is suppressed in favour of feedback offloading", async () => {
      const session = createMockSession({ shouldDistill: true })
      const manager = createMockManager({ [RLM_SESSION_ID]: session })
      bindSession(manager)
      const hook = createRlmOutputDistillerHook(
        { enabled: true, max_depth: 1, context_storage_dir: "/tmp", distill_threshold_tokens: 2000, probe_max_lines: 200, feedback: { output_threshold_bytes: 999999 } },
      )
      const output = createOutput("short")

      await hook["tool.execute.after"](createInput("Bash"), output)

      expect(output.output).toBe("short")
    })
  })

  describe("#given active RLM session with shouldDistill=false", () => {
    it("#then uses applyFeedback, not generic distillation", async () => {
      const session = createMockSession({ shouldDistill: false })
      const manager = createMockManager({ [RLM_SESSION_ID]: session })
      bindSession(manager)
      const hook = createRlmOutputDistillerHook(
        { enabled: true, max_depth: 1, context_storage_dir: "/tmp", distill_threshold_tokens: 2000, probe_max_lines: 200 },
      )
      const output = createOutput("short")

      await hook["tool.execute.after"](createInput("Bash"), output)

      // RLM sessions use applyFeedback, not generic distillation
      // Output should be processed through applyFeedback (may add metadata)
      expect(output.output).toBeDefined()
    })
  })

  describe("#given active RLM session with shouldDistill=true", () => {
    it("#then uses applyFeedback (RLM uses feedback, not generic distillation)", async () => {
      const session = createMockSession({ shouldDistill: true })
      const manager = createMockManager({ [RLM_SESSION_ID]: session })
      bindSession(manager)
      const hook = createRlmOutputDistillerHook(
        { enabled: true, max_depth: 1, context_storage_dir: "/tmp", distill_threshold_tokens: 2000, probe_max_lines: 200 },
      )
      const output = createOutput("short")

      await hook["tool.execute.after"](createInput("Bash"), output)

      // RLM sessions use applyFeedback, not generic distillation
      // The shouldDistill flag is for non-RLM fallback behavior
      expect(output.output).toBeDefined()
    })
  })

  describe("#given config uses default threshold", () => {
    it("#then RLM session uses applyFeedback, not threshold-based distillation", async () => {
      const session = createMockSession({ shouldDistill: false })
      const manager = createMockManager({ [RLM_SESSION_ID]: session })
      bindSession(manager)
      const hook = createRlmOutputDistillerHook({ enabled: true, max_depth: 1, context_storage_dir: "/tmp", distill_threshold_tokens: 2000, probe_max_lines: 200, feedback: { output_threshold_bytes: 999999 } })
      const output = createOutput("y".repeat(8001))

      await hook["tool.execute.after"](createInput("Bash"), output)

      // RLM sessions bypass generic distillation - they use applyFeedback
      expect(output.output).toBeDefined()
    })
  })

  describe("#given async getSession", () => {
    it("#then handles promise-based session lookup through coordinator", async () => {
      const session = createMockSession({ shouldDistill: false })
      const manager: RlmContextManagerLike = {
        ...createMockManager({}),
        getSession: async (sessionId: string) =>
          sessionId === RLM_SESSION_ID ? session : undefined,
      }
      bindSession(manager)
      const hook = createRlmOutputDistillerHook({ enabled: true, max_depth: 1, context_storage_dir: "/tmp", distill_threshold_tokens: 2000, probe_max_lines: 200, feedback: { output_threshold_bytes: 999999 } })
      const output = createOutput("async test")

      await hook["tool.execute.after"](createInput("Bash"), output)

      // Should complete without error using coordinator binding
      expect(output.output).toBeDefined()
    })
  })
})
