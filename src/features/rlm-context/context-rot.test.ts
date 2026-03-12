import { afterEach, describe, expect, it } from "bun:test"
import { RlmConfigSchema, type RlmConfig } from "../../config/schema/experimental"
import { createTracer, type RlmSpan } from "./tracer"
import { detectContextRot, shouldCheckContextRot } from "./context-rot"
import { createRlmPlanTool } from "../../tools/rlm/plan-tool"
import {
  InMemoryRlmManager,
  bindTestCoordinator,
  createSession,
  createToolContext,
  dummyClient,
  testRlmSessionId,
  unbindTestCoordinator,
} from "../../tools/rlm/plan-tool.test-helpers"

const testTracingConfig = {
  enabled: true,
  output: "log" as const,
  spans_dir: ".test-sis/context-rot-traces",
}

function createSpan(
  partial: Partial<RlmSpan> & {
    operation_name?: string
    operation_args?: Record<string, unknown>
    variables_created?: string[]
  },
): RlmSpan {
  return {
    spanId: partial.spanId ?? `span-${Math.random().toString(36).slice(2)}`,
    chatSessionId: partial.chatSessionId ?? "chat-1",
    rlmSessionId: partial.rlmSessionId ?? "rlm-1",
    operation: partial.operation ?? "plan.op.write_var",
    startTime: partial.startTime ?? Date.now(),
    status: partial.status ?? "ok",
    ...partial,
  } as RlmSpan
}

describe("context-rot", () => {
  describe("detectContextRot", () => {
    it("returns healthy when no indicators are present", () => {
      const spans = [
        createSpan({ operation_name: "write_var", variables_created: ["draft_1"] }),
        createSpan({ operation_name: "write_var", variables_created: ["draft_2"] }),
      ]

      expect(detectContextRot(spans)).toEqual({
        score: 0,
        indicators: [],
        recommendation: "healthy",
      })
    })

    it("flags repeated_searches when the same pattern is used more than twice", () => {
      const spans = [
        createSpan({ operation_name: "search", operation_args: { pattern: "TODO" } }),
        createSpan({ operation_name: "search", operation_args: { pattern: "TODO" } }),
        createSpan({ operation_name: "search", operation_args: { pattern: "TODO" } }),
      ]

      const signal = detectContextRot(spans)
      expect(signal.indicators).toContain("repeated_searches")
      expect(signal.score).toBeGreaterThan(0)
    })

    it("flags repeated_probes when the same variable is inspected more than three times", () => {
      const spans = [
        createSpan({ operation_name: "probe", operation_args: { variable_name: "context" } }),
        createSpan({ operation_name: "probe", operation_args: { variable_name: "context" } }),
        createSpan({ operation_name: "probe", operation_args: { variable_name: "context" } }),
        createSpan({ operation_name: "probe", operation_args: { variable_name: "context" } }),
      ]

      const signal = detectContextRot(spans)
      expect(signal.indicators).toContain("repeated_probes")
    })

    it("flags no_new_vars after five operations without creating a variable", () => {
      const spans = Array.from({ length: 5 }, (_, index) =>
        createSpan({
          spanId: `span-no-vars-${index}`,
          operation_name: "probe",
          operation_args: { variable_name: `context_${index}` },
          variables_created: [],
        }),
      )

      const signal = detectContextRot(spans)
      expect(signal.indicators).toContain("no_new_vars")
    })

    it("flags rising_ref_count when hidden refs accumulate without resolution", () => {
      const spans = [
        createSpan({ operation_name: "exec", variables_created: ["__hidden_exec-1"] }),
        createSpan({ operation_name: "exec", variables_created: ["__hidden_exec-2"] }),
        createSpan({ operation_name: "exec", variables_created: ["__hidden_exec-3"] }),
      ]

      const signal = detectContextRot(spans)
      expect(signal.indicators).toContain("rising_ref_count")
    })

    it("recommends warning when the score exceeds the warning threshold", () => {
      const spans = [
        createSpan({ operation_name: "search", operation_args: { pattern: "TODO" } }),
        createSpan({ operation_name: "search", operation_args: { pattern: "TODO" } }),
        createSpan({ operation_name: "search", operation_args: { pattern: "TODO" } }),
        createSpan({ operation_name: "probe", operation_args: { variable_name: "context" } }),
        createSpan({ operation_name: "probe", operation_args: { variable_name: "context" } }),
        createSpan({ operation_name: "probe", operation_args: { variable_name: "context" } }),
        createSpan({ operation_name: "probe", operation_args: { variable_name: "context" } }),
        createSpan({ operation_name: "probe", operation_args: { variable_name: "notes" }, variables_created: [] }),
        createSpan({ operation_name: "probe", operation_args: { variable_name: "draft" }, variables_created: [] }),
        createSpan({ operation_name: "probe", operation_args: { variable_name: "scratch" }, variables_created: [] }),
        createSpan({ operation_name: "probe", operation_args: { variable_name: "summary" }, variables_created: [] }),
        createSpan({ operation_name: "probe", operation_args: { variable_name: "final" }, variables_created: [] }),
      ]

      const signal = detectContextRot(spans)
      expect(signal.score).toBeGreaterThan(0.7)
      expect(signal.recommendation).toBe("warning")
    })

    it("recommends suggest_finish when the score exceeds 0.9", () => {
      const spans = [
        createSpan({ operation_name: "search", operation_args: { pattern: "TODO" } }),
        createSpan({ operation_name: "search", operation_args: { pattern: "TODO" } }),
        createSpan({ operation_name: "search", operation_args: { pattern: "TODO" } }),
        createSpan({ operation_name: "probe", operation_args: { variable_name: "context" } }),
        createSpan({ operation_name: "probe", operation_args: { variable_name: "context" } }),
        createSpan({ operation_name: "probe", operation_args: { variable_name: "context" } }),
        createSpan({ operation_name: "probe", operation_args: { variable_name: "context" } }),
        createSpan({ operation_name: "exec", variables_created: ["__hidden_exec-1"] }),
        createSpan({ operation_name: "exec", variables_created: ["__hidden_exec-2"] }),
        createSpan({ operation_name: "exec", variables_created: ["__hidden_exec-3"] }),
        createSpan({ operation_name: "probe", operation_args: { variable_name: "notes" }, variables_created: [] }),
        createSpan({ operation_name: "probe", operation_args: { variable_name: "draft" }, variables_created: [] }),
        createSpan({ operation_name: "probe", operation_args: { variable_name: "scratch" }, variables_created: [] }),
        createSpan({ operation_name: "probe", operation_args: { variable_name: "summary" }, variables_created: [] }),
        createSpan({ operation_name: "probe", operation_args: { variable_name: "final" }, variables_created: [] }),
      ]

      const signal = detectContextRot(spans)
      expect(signal.score).toBeGreaterThan(0.9)
      expect(signal.recommendation).toBe("suggest_finish")
    })
  })

  describe("shouldCheckContextRot", () => {
    it("uses a default interval of five operations", () => {
      expect(shouldCheckContextRot(4)).toBe(false)
      expect(shouldCheckContextRot(5)).toBe(true)
      expect(shouldCheckContextRot(10)).toBe(true)
    })

    it("uses a configurable interval", () => {
      expect(shouldCheckContextRot(2, { check_interval: 3 })).toBe(false)
      expect(shouldCheckContextRot(3, { check_interval: 3 })).toBe(true)
      expect(shouldCheckContextRot(6, { check_interval: 3 })).toBe(true)
    })
  })

  describe("plan execution hook", () => {
    afterEach(() => {
      unbindTestCoordinator("ses-context-rot-default")
      unbindTestCoordinator("ses-context-rot-custom")
    })

    it("runs the check every configured interval during plan execution", async () => {
      const config: RlmConfig = RlmConfigSchema.parse({
        enabled: true,
        max_depth: 3,
        tracing: testTracingConfig,
        context_rot: { enabled: true, check_interval: 3 },
      })
      const sessionId = "ses-context-rot-custom"
      const rlmSessionId = testRlmSessionId(sessionId)
      const tracer = createTracer(config.tracing!)
      const manager = new InMemoryRlmManager()
      manager.seedSession(createSession(rlmSessionId, "query", "query", 0, 3))
      bindTestCoordinator(sessionId, manager, { tracer })

      const tool = createRlmPlanTool({ client: dummyClient, directory: "/tmp", config })
      await tool.execute(
        {
          operations: Array.from({ length: 6 }, (_, index) => ({
            op: "write_var" as const,
            variable_name: `draft_${index}`,
            content: `value-${index}`,
          })),
        },
        createToolContext(sessionId),
      )

      const spans = tracer.getSpans(rlmSessionId)
      const checks = spans.filter((span) => span.operation === "plan.context_rot")
      expect(checks).toHaveLength(2)
    })

    it("uses the default interval of five operations when no override is set", async () => {
      const config: RlmConfig = RlmConfigSchema.parse({
        enabled: true,
        max_depth: 3,
        tracing: testTracingConfig,
        context_rot: { enabled: true },
      })
      const sessionId = "ses-context-rot-default"
      const rlmSessionId = testRlmSessionId(sessionId)
      const tracer = createTracer(config.tracing!)
      const manager = new InMemoryRlmManager()
      manager.seedSession(createSession(rlmSessionId, "query", "query", 0, 3))
      bindTestCoordinator(sessionId, manager, { tracer })

      const tool = createRlmPlanTool({ client: dummyClient, directory: "/tmp", config })
      await tool.execute(
        {
          operations: Array.from({ length: 4 }, (_, index) => ({
            op: "write_var" as const,
            variable_name: `draft_${index}`,
            content: `value-${index}`,
          })),
        },
        createToolContext(sessionId),
      )

      expect(tracer.getSpans(rlmSessionId).filter((span) => span.operation === "plan.context_rot")).toHaveLength(0)

      await tool.execute(
        {
          operations: [{ op: "write_var", variable_name: "draft_4", content: "value-4" }],
        },
        createToolContext(sessionId),
      )

      expect(tracer.getSpans(rlmSessionId).filter((span) => span.operation === "plan.context_rot")).toHaveLength(1)
    })
  })
})
