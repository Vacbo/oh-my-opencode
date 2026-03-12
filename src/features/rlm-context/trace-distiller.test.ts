import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { captureDistilledTrace, type DistilledTrace, type DistillOptions } from "./trace-distiller"
import type { RlmSpan } from "./tracer"
import type { RlmTracingConfig } from "../../config/schema/experimental"
import * as fs from "node:fs"
import * as path from "node:path"

describe("trace-distiller", () => {
  const testDistillDir = ".test-sis/rlm-traces/distilled"

  beforeEach(() => {
    fs.rmSync(".test-sis", { recursive: true, force: true })
  })

  afterEach(() => {
    fs.rmSync(".test-sis", { recursive: true, force: true })
  })

  function makeSpan(overrides: Partial<RlmSpan> = {}): RlmSpan {
    return {
      spanId: "span-1",
      chatSessionId: "chat-1",
      rlmSessionId: "rlm-1",
      operation: "probe",
      startTime: 1000,
      endTime: 2000,
      status: "ok",
      ...overrides,
    }
  }

  function makeConfig(overrides: Partial<RlmTracingConfig> = {}): RlmTracingConfig {
    return {
      enabled: true,
      output: "log",
      spans_dir: ".test-sis/rlm-traces",
      distill_enabled: true,
      ...overrides,
    }
  }

  function makeOptions(overrides: Partial<DistillOptions> = {}): DistillOptions {
    return {
      terminal: true,
      finalAnswer: "The answer is 42",
      maxDepth: 1,
      rootQuery: "What is the answer?",
      taskPrompt: "Find the answer",
      depth: 0,
      ...overrides,
    }
  }

  describe("#given distill is disabled", () => {
    it("#then returns undefined", () => {
      const config = makeConfig({ distill_enabled: false })
      const spans = [makeSpan()]
      const options = makeOptions()

      const result = captureDistilledTrace("rlm-1", spans, options, config)

      expect(result).toBeUndefined()
    })
  })

  describe("#given distill is enabled", () => {
    describe("#when trace is not terminal", () => {
      it("#then returns undefined", () => {
        const config = makeConfig()
        const spans = [makeSpan()]
        const options = makeOptions({ terminal: false })

        const result = captureDistilledTrace("rlm-1", spans, options, config)

        expect(result).toBeUndefined()
      })
    })

    describe("#when last span has error status", () => {
      it("#then returns undefined", () => {
        const config = makeConfig()
        const spans = [makeSpan({ status: "error", error: "boom" })]
        const options = makeOptions()

        const result = captureDistilledTrace("rlm-1", spans, options, config)

        expect(result).toBeUndefined()
      })
    })

    describe("#when spans are empty", () => {
      it("#then returns undefined", () => {
        const config = makeConfig()
        const options = makeOptions()

        const result = captureDistilledTrace("rlm-1", [], options, config)

        expect(result).toBeUndefined()
      })
    })

    describe("#when trace is successful and terminal", () => {
      it("#then captures distilled trace with correct fields", () => {
        const config = makeConfig()
        const spans = [
          makeSpan({ spanId: "s1", operation: "probe", operation_name: "head", operation_args: { variable_name: "ctx" } }),
          makeSpan({ spanId: "s2", operation: "plan.op.split", operation_name: "split", operation_args: { input: "ctx" } }),
          makeSpan({ spanId: "s3", operation: "rlm_finish", status: "ok" }),
        ]
        const options = makeOptions({ model: "claude-4", provider: "anthropic" })

        const result = captureDistilledTrace("rlm-1", spans, options, config)

        expect(result).toBeDefined()
        expect(result!.sessionId).toBe("rlm-1")
        expect(result!.rootQuery).toBe("What is the answer?")
        expect(result!.taskPrompt).toBe("Find the answer")
        expect(result!.finalAnswer).toBe("The answer is 42")
        expect(result!.depth).toBe(0)
        expect(result!.maxDepth).toBe(1)
        expect(result!.model).toBe("claude-4")
        expect(result!.provider).toBe("anthropic")
        expect(result!.capturedAt).toBeGreaterThan(0)
      })

      it("#then extracts operations from spans", () => {
        const config = makeConfig()
        const spans = [
          makeSpan({
            spanId: "s1",
            operation: "probe",
            operation_name: "head",
            operation_args: { variable_name: "ctx", lines: 10 },
            metadata: { result: "first 10 lines..." },
          }),
          makeSpan({
            spanId: "s2",
            operation: "plan.op.split",
            operation_name: "split",
            operation_args: { input: "ctx", strategy: "lines" },
          }),
        ]
        const options = makeOptions()

        const result = captureDistilledTrace("rlm-1", spans, options, config)

        expect(result!.operations).toHaveLength(2)
        expect(result!.operations[0]).toEqual({
          name: "head",
          args: { variable_name: "ctx", lines: 10 },
          result: "first 10 lines...",
        })
        expect(result!.operations[1]).toEqual({
          name: "split",
          args: { input: "ctx", strategy: "lines" },
          result: undefined,
        })
      })

      it("#then falls back to span operation when operation_name is missing", () => {
        const config = makeConfig()
        const spans = [makeSpan({ operation: "rlm_probe" })]
        const options = makeOptions()

        const result = captureDistilledTrace("rlm-1", spans, options, config)

        expect(result!.operations[0].name).toBe("rlm_probe")
      })

      it("#then saves to distilled directory", () => {
        const config = makeConfig()
        const spans = [makeSpan()]
        const options = makeOptions()

        captureDistilledTrace("rlm-1", spans, options, config)

        const filePath = path.join(testDistillDir, "rlm-1.json")
        expect(fs.existsSync(filePath)).toBe(true)

        const content = JSON.parse(fs.readFileSync(filePath, "utf-8"))
        expect(content.sessionId).toBe("rlm-1")
        expect(content.rootQuery).toBe("What is the answer?")
        expect(content.finalAnswer).toBe("The answer is 42")
      })

      it("#then does not crash on file write failure", () => {
        const config = makeConfig({ spans_dir: "/nonexistent/root/path" })
        const spans = [makeSpan()]
        const options = makeOptions()

        expect(() => captureDistilledTrace("rlm-1", spans, options, config)).not.toThrow()
      })
    })

    describe("#when any span has error status but last is ok", () => {
      it("#then still captures the trace", () => {
        const config = makeConfig()
        const spans = [
          makeSpan({ spanId: "s1", operation: "probe", status: "error", error: "transient" }),
          makeSpan({ spanId: "s2", operation: "rlm_finish", status: "ok" }),
        ]
        const options = makeOptions()

        const result = captureDistilledTrace("rlm-1", spans, options, config)

        expect(result).toBeDefined()
        expect(result!.operations).toHaveLength(2)
      })
    })
  })
})
