import { describe, it, expect } from "bun:test"
import type { RlmSessionState } from "../../features/rlm-context/types"
import { createRlmOutputDistillerHook } from "./hook"

function createMockSession(overrides?: Partial<RlmSessionState>): RlmSessionState {
  return {
    sessionId: "ses-test",
    depth: 0,
    maxDepth: 2,
    contextDir: "/tmp/rlm",
    query: "test query",
    shouldDistill: false,
    variables: new Map(),
    ...overrides,
  }
}

function createMockManager(sessions: Record<string, RlmSessionState>) {
  return {
    getSession: (sessionId: string) => sessions[sessionId],
  }
}

function createInput(tool: string, sessionID = "ses-test") {
  return { tool, sessionID, callID: "call-1" }
}

function createOutput(text: string) {
  return { title: "Result", output: text, metadata: {} }
}

describe("createRlmOutputDistillerHook", () => {
  describe("#given no RLM context manager", () => {
    it("#then passes through unchanged", async () => {
      const hook = createRlmOutputDistillerHook()
      const output = createOutput("some output")

      await hook["tool.execute.after"](createInput("Bash"), output)

      expect(output.output).toBe("some output")
    })
  })

  describe("#given no RLM session for this session ID", () => {
    it("#then passes through unchanged", async () => {
      const manager = createMockManager({})
      const hook = createRlmOutputDistillerHook(undefined, manager)
      const output = createOutput("some output")

      await hook["tool.execute.after"](createInput("Bash"), output)

      expect(output.output).toBe("some output")
    })
  })

  describe("#given rlm_finish tool", () => {
    it("#then passes through unchanged even with active RLM session", async () => {
      const session = createMockSession({ shouldDistill: true })
      const manager = createMockManager({ "ses-test": session })
      const hook = createRlmOutputDistillerHook(undefined, manager)
      const output = createOutput("final answer content")

      await hook["tool.execute.after"](createInput("rlm_finish"), output)

      expect(output.output).toBe("final answer content")
    })
  })

  describe("#given active RLM session with shouldDistill=false", () => {
    describe("#when output is within threshold", () => {
      it("#then passes through unchanged", async () => {
        const session = createMockSession({ shouldDistill: false })
        const manager = createMockManager({ "ses-test": session })
        const hook = createRlmOutputDistillerHook(
          { enabled: true, max_depth: 1, context_storage_dir: "/tmp", distill_threshold_tokens: 2000, probe_max_lines: 200 },
          manager,
        )
        const output = createOutput("short output")

        await hook["tool.execute.after"](createInput("Bash"), output)

        expect(output.output).toBe("short output")
      })
    })

    describe("#when output exceeds threshold", () => {
      it("#then distills the output", async () => {
        const session = createMockSession({ shouldDistill: false })
        const manager = createMockManager({ "ses-test": session })
        const hook = createRlmOutputDistillerHook(
          { enabled: true, max_depth: 1, context_storage_dir: "/tmp", distill_threshold_tokens: 100, probe_max_lines: 200 },
          manager,
        )
        // 100 tokens * 4 chars/token = 400 chars threshold; 500 chars > threshold
        const output = createOutput("x".repeat(500))

        await hook["tool.execute.after"](createInput("Bash"), output)

        expect(output.output).toContain("[RLM distiller:")
        expect(output.output.length).toBeLessThan(500)
      })
    })
  })

  describe("#given active RLM session with shouldDistill=true", () => {
    it("#then distills even short output", async () => {
      const session = createMockSession({ shouldDistill: true })
      const manager = createMockManager({ "ses-test": session })
      const hook = createRlmOutputDistillerHook(
        { enabled: true, max_depth: 1, context_storage_dir: "/tmp", distill_threshold_tokens: 2000, probe_max_lines: 200 },
        manager,
      )
      const output = createOutput("short")

      await hook["tool.execute.after"](createInput("Bash"), output)

      expect(output.output).toContain("[RLM distiller:")
    })
  })

  describe("#given config uses default threshold", () => {
    it("#then uses 2000 token threshold", async () => {
      const session = createMockSession({ shouldDistill: false })
      const manager = createMockManager({ "ses-test": session })
      const hook = createRlmOutputDistillerHook(undefined, manager)
      // 2000 tokens * 4 = 8000 chars; 8001 chars exceeds threshold
      const output = createOutput("y".repeat(8001))

      await hook["tool.execute.after"](createInput("Bash"), output)

      expect(output.output).toContain("[RLM distiller:")
    })
  })

  describe("#given async getSession", () => {
    it("#then handles promise-based session lookup", async () => {
      const session = createMockSession({ shouldDistill: true })
      const manager = {
        getSession: async (sessionId: string) =>
          sessionId === "ses-test" ? session : undefined,
      }
      const hook = createRlmOutputDistillerHook(undefined, manager)
      const output = createOutput("async test")

      await hook["tool.execute.after"](createInput("Bash"), output)

      expect(output.output).toContain("[RLM distiller:")
    })
  })
})
