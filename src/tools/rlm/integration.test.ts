import { afterEach, describe, expect, it } from "bun:test"
import {
  InMemoryRlmManager,
  bindTestCoordinator,
  createSession,
  createToolContext,
  dummyClient,
  testRlmSessionId,
  unbindTestCoordinator,
} from "./plan-tool.test-helpers"
import { createRlmProbeTool } from "./probe-tool"
import { createRlmSearchTool } from "./search-tool"
import { createRlmPlanTool } from "./plan-tool"
import { createRlmFinishTool } from "./finish-tool"
import {
  createTrustedLocalRlmReplBackend,
  clearRlmReplNamespace,
  type RlmReplBackend,
} from "./repl-runtime"
import {
  applyFeedback,
  shouldOffload,
} from "../../features/rlm-context/turn-feedback"
import { consumeFinalFromMessage } from "../../hooks/rlm-output-distiller/final-consumer"
import { coordinator } from "../../features/rlm-context/coordinator"
import { RlmConfigSchema, type RlmConfig } from "../../config/schema/experimental"

function createConfig(overrides: Partial<RlmConfig> = {}): RlmConfig {
  return RlmConfigSchema.parse(overrides)
}

describe("RLM Phase 2 integration", () => {
  const boundSessions: string[] = []

  function setupSession(
    sessionId: string,
    options: {
      query?: string
      depth?: number
      maxDepth?: number
      trusted?: boolean
      contextContent?: string
    } = {},
  ): InMemoryRlmManager {
    const manager = new InMemoryRlmManager()
    const rlmSessionId = testRlmSessionId(sessionId)
    manager.seedSession(
      createSession(
        rlmSessionId,
        options.query ?? "test query",
        options.query ?? "test query",
        options.depth ?? 0,
        options.maxDepth ?? 3,
      ),
    )
    if (options.contextContent !== undefined) {
      manager.createBlobVariable(rlmSessionId, {
        name: "context",
        content: options.contextContent,
      })
    }
    bindTestCoordinator(sessionId, manager, {
      rootQuery: options.query ?? "test query",
      taskPrompt: options.query ?? "test query",
      trusted: options.trusted ?? true,
    })
    boundSessions.push(sessionId)
    return manager
  }

  afterEach(() => {
    while (boundSessions.length > 0) {
      const id = boundSessions.pop()!
      clearRlmReplNamespace(id)
      unbindTestCoordinator(id)
    }
  })

  // ---------------------------------------------------------------------------
  // Scenario 1: Full /rlm → probe → search → exec → finish flow
  // ---------------------------------------------------------------------------
  describe("#given full RLM session with multiline context", () => {
    describe("#when executing probe → search → exec → finish flow", () => {
      it("#then all tools interoperate and finish returns terminal value", async () => {
        const lines = Array.from({ length: 100 }, (_, i) => `record ${i}: value=${i * 7}`)
        const manager = setupSession("ses-full", {
          query: "analyze records",
          contextContent: lines.join("\n"),
        })

        const probeTool = createRlmProbeTool()
        const listVars = JSON.parse(
          await probeTool.execute({ operation: "list_vars" }, createToolContext("ses-full")),
        )
        expect(listVars.variables).toHaveLength(1)
        expect(listVars.variables[0].name).toBe("context")

        const searchTool = createRlmSearchTool()
        const searchResult = JSON.parse(
          await searchTool.execute(
            { variable_name: "context", pattern: "record 50", mode: "literal" },
            createToolContext("ses-full"),
          ),
        )
        expect(searchResult.result_count).toBe(1)
        expect(searchResult.matches[0].excerpt).toContain("record 50")

        const mockBackend: RlmReplBackend = {
          execute: async () => "processed: 100 records analyzed",
        }
        const planTool = createRlmPlanTool({
          client: dummyClient,
          directory: "/tmp",
          config: createConfig(),
          deps: { replBackend: mockBackend },
        })
        const planResult = JSON.parse(
          await planTool.execute(
            { operations: [{ op: "exec", code: 'print("done")', output_variable: "result" }] },
            createToolContext("ses-full"),
          ),
        )
        expect(planResult.error).toBeUndefined()
        expect(planResult.executed_ops).toBe(1)

        const finishTool = createRlmFinishTool()
        const finishResult = JSON.parse(
          await finishTool.execute({ variable_name: "result" }, createToolContext("ses-full")),
        )
        expect(finishResult.terminal).toBe(true)
        expect(finishResult.source).toBe("variable")
        expect(finishResult.final_answer).toBe("processed: 100 records analyzed")
      })

      it("#then large tool output is metadata-only at history boundary", async () => {
        const largeContent = "x".repeat(4096)
        setupSession("ses-boundary", { contextContent: "seed" })
        const config = createConfig()
        const binding = coordinator.resolve("ses-boundary")
        if (!binding) throw new Error("expected binding")

        const offloaded = await applyFeedback(largeContent, binding.rlmSessionId, "rlm_probe", binding, config)
        const parsed = JSON.parse(offloaded)
        expect(parsed.ref).toContain("hidden://")
        expect(parsed.preview.length).toBeLessThanOrEqual(200)

        const passthrough = await applyFeedback(largeContent, binding.rlmSessionId, "rlm_finish", binding, config)
        expect(passthrough).toBe(largeContent)
      })
    })
  })

  // ---------------------------------------------------------------------------
  // Scenario 2: Metadata-only feedback contract
  // ---------------------------------------------------------------------------
  describe("#given the metadata-only feedback contract", () => {
    describe("#when output exceeds threshold", () => {
      it("#then returns metadata with hidden ref, not full content", async () => {
        setupSession("ses-offload", { contextContent: "seed" })
        const config = createConfig()
        const binding = coordinator.resolve("ses-offload")
        if (!binding) throw new Error("expected binding")
        const largeOutput = "A".repeat(3000)

        expect(shouldOffload(3000, config)).toBe(true)

        const result = await applyFeedback(largeOutput, binding.rlmSessionId, "rlm_probe", binding, config)
        const parsed = JSON.parse(result)
        expect(parsed.ref).toMatch(/^hidden:\/\//)
        expect(parsed.variableName).toMatch(/^__hidden_/)
        expect(parsed.preview.length).toBeLessThanOrEqual(200)
      })
    })

    describe("#when output is below threshold", () => {
      it("#then passes through unchanged", async () => {
        setupSession("ses-small", { contextContent: "seed" })
        const config = createConfig()
        const binding = coordinator.resolve("ses-small")
        if (!binding) throw new Error("expected binding")
        const smallOutput = "small result"

        expect(shouldOffload(Buffer.byteLength(smallOutput), config)).toBe(false)

        const result = await applyFeedback(smallOutput, binding.rlmSessionId, "rlm_probe", binding, config)
        expect(result).toBe(smallOutput)
      })
    })

    describe("#when inspect_ref is called on a hidden ref", () => {
      it("#then returns bounded preview only", async () => {
        setupSession("ses-inspect", { contextContent: "seed" })
        const config = createConfig()
        const binding = coordinator.resolve("ses-inspect")
        if (!binding) throw new Error("expected binding")

        const largeOutput = "B".repeat(3000)
        const offloaded = await applyFeedback(largeOutput, binding.rlmSessionId, "rlm_probe", binding, config)
        const { ref } = JSON.parse(offloaded)

        const probeTool = createRlmProbeTool()
        const inspectResult = JSON.parse(
          await probeTool.execute(
            { operation: "inspect_ref", ref },
            createToolContext("ses-inspect"),
          ),
        )
        expect(inspectResult.operation).toBe("inspect_ref")
        expect(inspectResult.preview.length).toBeLessThanOrEqual(200)
        expect(inspectResult.variable_name).toMatch(/^__hidden_/)
      })
    })
  })

  // ---------------------------------------------------------------------------
  // Scenario 3: Exec with llm_query bridge
  // ---------------------------------------------------------------------------
  describe("#given exec code using llm_query bridge", () => {
    describe("#when code reads context, calls llm_query, and stores result", () => {
      it("#then result is accessible in session variables", async () => {
        const manager = setupSession("ses-bridge", {
          contextContent: "important context data",
          query: "summarize context",
        })

        const backend = createTrustedLocalRlmReplBackend({
          runSyncSubcall: async (input) => ({
            ok: true as const,
            sessionID: "child-1",
            textOutput: `LLM says: ${input.prompt.slice(0, 30)}`,
            messages: [],
          }),
          cleanupSyncSubcallSession: async () => {},
        })

        const replContext = {
          sessionID: "ses-bridge",
          rlmSessionId: testRlmSessionId("ses-bridge"),
          rootQuery: "summarize context",
          taskPrompt: "summarize context",
          manager,
          toolContext: createToolContext("ses-bridge"),
          client: dummyClient,
          directory: "/tmp",
          config: createConfig(),
        }

        const output = await backend.execute(
          [
            'const ctx = await getVar("context");',
            'const answer = await llm_query("Summarize: " + ctx.slice(0, 20));',
            'await setVar("summary", answer);',
            'print("done");',
          ].join("\n"),
          replContext,
        )

        expect(output).toBe("done\n")

        const summaryVar = manager.getVariableByName(testRlmSessionId("ses-bridge"), "summary")
        expect(summaryVar).toBeDefined()
        expect(summaryVar?.storageKind).toBe("blob")
        if (summaryVar && summaryVar.storageKind === "blob") {
          const content = manager.readBlobContent(summaryVar)
          expect(content).toContain("LLM says:")
        }
      })
    })
  })

  // ---------------------------------------------------------------------------
  // Scenario 4: Trusted mode enforcement
  // ---------------------------------------------------------------------------
  describe("#given trusted mode configuration", () => {
    describe("#when trusted_only=true and binding.trusted=false", () => {
      it("#then exec fails with trusted mode error", async () => {
        const manager = setupSession("ses-untrusted", {
          contextContent: "seed",
          trusted: false,
        })

        const backend = createTrustedLocalRlmReplBackend()
        const replContext = {
          sessionID: "ses-untrusted",
          rlmSessionId: testRlmSessionId("ses-untrusted"),
          rootQuery: "test",
          taskPrompt: "test",
          manager,
          toolContext: createToolContext("ses-untrusted"),
          client: dummyClient,
          directory: "/tmp",
          config: createConfig({
            exec: { trusted_only: true, timeout_ms: 30000, print_limit_bytes: 2048 },
          }),
        }

        await expect(
          backend.execute('print("hello")', replContext),
        ).rejects.toThrow("exec requires trusted mode")
      })
    })

    describe("#when trusted_only=false and binding.trusted=false", () => {
      it("#then exec succeeds", async () => {
        const manager = setupSession("ses-notrust-req", {
          contextContent: "seed",
          trusted: false,
        })

        const backend = createTrustedLocalRlmReplBackend()
        const replContext = {
          sessionID: "ses-notrust-req",
          rlmSessionId: testRlmSessionId("ses-notrust-req"),
          rootQuery: "test",
          taskPrompt: "test",
          manager,
          toolContext: createToolContext("ses-notrust-req"),
          client: dummyClient,
          directory: "/tmp",
          config: createConfig({
            exec: { trusted_only: false, timeout_ms: 30000, print_limit_bytes: 2048 },
          }),
        }

        const output = await backend.execute('print("works")', replContext)
        expect(output).toBe("works\n")
      })
    })
  })

  // ---------------------------------------------------------------------------
  // Scenario 5: FINAL/FINAL_VAR finalization
  // ---------------------------------------------------------------------------
  describe("#given the FINAL/FINAL_VAR finalization protocol", () => {
    describe("#when model outputs FINAL(value)", () => {
      it("#then final value is extracted and session is unbound", async () => {
        setupSession("ses-final", { contextContent: "seed" })

        const output = {
          message: {},
          parts: [{ type: "text", text: "Here is the answer: FINAL(The final result)" }],
        }

        const result = await consumeFinalFromMessage("ses-final", output)
        expect(result.detected).toBe(true)
        expect(result.finalValue).toBe("The final result")
        expect(result.source).toBe("inline_final")
        expect(coordinator.resolve("ses-final")).toBeUndefined()
      })
    })

    describe("#when model outputs FINAL_VAR(varname)", () => {
      it("#then variable is resolved and value returned", async () => {
        const manager = setupSession("ses-fvar", { contextContent: "seed" })
        manager.createBlobVariable(testRlmSessionId("ses-fvar"), {
          name: "answer",
          content: "resolved variable content",
        })

        const output = {
          message: {},
          parts: [{ type: "text", text: "FINAL_VAR(answer)" }],
        }

        const result = await consumeFinalFromMessage("ses-fvar", output)
        expect(result.detected).toBe(true)
        expect(result.finalValue).toBe("resolved variable content")
        expect(result.source).toBe("inline_final_var")
        expect(coordinator.resolve("ses-fvar")).toBeUndefined()
      })
    })

    describe("#when model outputs malformed FINAL tag", () => {
      it("#then error is returned gracefully", async () => {
        setupSession("ses-malformed", { contextContent: "seed" })

        const output = {
          message: {},
          parts: [{ type: "text", text: "FINAL_VAR()" }],
        }

        const result = await consumeFinalFromMessage("ses-malformed", output)
        expect(result.detected).toBe(true)
        expect(result.error).toBeDefined()
      })
    })
  })
})
