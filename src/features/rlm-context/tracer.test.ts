import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { createTracer, type RlmSpan, type SpanTreeNode } from "./tracer"
import type { RlmTracingConfig } from "../../config/schema/experimental"
import * as fs from "node:fs"
import * as path from "node:path"

describe("tracer", () => {
  const testSpansDir = ".test-sis/rlm-traces"

  beforeEach(() => {
    fs.rmSync(testSpansDir, { recursive: true, force: true })
  })

  afterEach(() => {
    fs.rmSync(testSpansDir, { recursive: true, force: true })
  })

  describe("createTracer", () => {
    it("returns no-op tracer when disabled", () => {
      const config: RlmTracingConfig = { enabled: false, output: "log", spans_dir: testSpansDir }
      const tracer = createTracer(config)

      const span = tracer.startSpan("chat-1", "rlm-1", "test-op")
      expect(span.spanId).toBe("")

      tracer.endSpan(span.spanId, "ok")
      expect(tracer.getSpans("rlm-1")).toEqual([])
    })

    it("returns active tracer when enabled", () => {
      const config: RlmTracingConfig = { enabled: true, output: "log", spans_dir: testSpansDir }
      const tracer = createTracer(config)

      const span = tracer.startSpan("chat-1", "rlm-1", "test-op")
      expect(span.spanId).not.toBe("")
      expect(span.chatSessionId).toBe("chat-1")
      expect(span.rlmSessionId).toBe("rlm-1")
      expect(span.operation).toBe("test-op")
    })
  })

  describe("RlmTracer", () => {
    it("creates span with correct fields", () => {
      const config: RlmTracingConfig = { enabled: true, output: "log", spans_dir: testSpansDir }
      const tracer = createTracer(config)

      const span = tracer.startSpan("chat-1", "rlm-1", "probe")

      expect(span.spanId).toBeDefined()
      expect(span.chatSessionId).toBe("chat-1")
      expect(span.rlmSessionId).toBe("rlm-1")
      expect(span.operation).toBe("probe")
      expect(span.startTime).toBeGreaterThan(0)
      expect(span.status).toBe("ok")
    })

    it("ends span with status and error", () => {
      const config: RlmTracingConfig = { enabled: true, output: "log", spans_dir: testSpansDir }
      const tracer = createTracer(config)

      const span = tracer.startSpan("chat-1", "rlm-1", "probe")
      tracer.endSpan(span.spanId, "error", "something went wrong")

      const spans = tracer.getSpans("rlm-1")
      expect(spans).toHaveLength(1)
      expect(spans[0].status).toBe("error")
      expect(spans[0].error).toBe("something went wrong")
      expect(spans[0].endTime).toBeGreaterThan(0)
    })

    it("retrieves all spans for a session", () => {
      const config: RlmTracingConfig = { enabled: true, output: "log", spans_dir: testSpansDir }
      const tracer = createTracer(config)

      tracer.startSpan("chat-1", "rlm-1", "op1")
      tracer.startSpan("chat-1", "rlm-1", "op2")
      tracer.startSpan("chat-2", "rlm-2", "op3")

      const rlm1Spans = tracer.getSpans("rlm-1")
      expect(rlm1Spans).toHaveLength(2)

      const rlm2Spans = tracer.getSpans("rlm-2")
      expect(rlm2Spans).toHaveLength(1)
    })

    it("builds trace tree with parent-child", () => {
      const config: RlmTracingConfig = { enabled: true, output: "log", spans_dir: testSpansDir }
      const tracer = createTracer(config)

      const rootSpan = tracer.startSpan("chat-1", "rlm-1", "plan")
      const childSpan = tracer.startSpan("chat-1", "rlm-1", "map_rlm", rootSpan.spanId)
      const grandchildSpan = tracer.startSpan("chat-1", "rlm-1", "exec", childSpan.spanId)

      const tree = tracer.getTrace(rootSpan.spanId)
      expect(tree).toBeDefined()
      expect(tree!.span.operation).toBe("plan")
      expect(tree!.children).toHaveLength(1)
      expect(tree!.children[0].span.operation).toBe("map_rlm")
      expect(tree!.children[0].children).toHaveLength(1)
      expect(tree!.children[0].children[0].span.operation).toBe("exec")
    })

    it("writes to file when output is file", () => {
      const config: RlmTracingConfig = { enabled: true, output: "file", spans_dir: testSpansDir }
      const tracer = createTracer(config)

      const span = tracer.startSpan("chat-1", "rlm-1", "probe")
      tracer.endSpan(span.spanId, "ok")

      const filePath = path.join(testSpansDir, "rlm-1.jsonl")
      expect(fs.existsSync(filePath)).toBe(true)

      const content = fs.readFileSync(filePath, "utf-8")
      const lines = content.trim().split("\n")
      expect(lines.length).toBeGreaterThanOrEqual(1)

      const parsed = JSON.parse(lines[0])
      expect(parsed.operation).toBe("probe")
    })

    it("writes to both log and file when output is both", () => {
      const config: RlmTracingConfig = { enabled: true, output: "both", spans_dir: testSpansDir }
      const tracer = createTracer(config)

      tracer.startSpan("chat-1", "rlm-1", "probe")

      const filePath = path.join(testSpansDir, "rlm-1.jsonl")
      expect(fs.existsSync(filePath)).toBe(true)
    })

    it("handles missing span in endSpan gracefully", () => {
      const config: RlmTracingConfig = { enabled: true, output: "log", spans_dir: testSpansDir }
      const tracer = createTracer(config)

      expect(() => tracer.endSpan("non-existent", "ok")).not.toThrow()
    })

    it("returns undefined for non-existent trace", () => {
      const config: RlmTracingConfig = { enabled: true, output: "log", spans_dir: testSpansDir }
      const tracer = createTracer(config)

      const tree = tracer.getTrace("non-existent")
      expect(tree).toBeUndefined()
    })
  })
})
