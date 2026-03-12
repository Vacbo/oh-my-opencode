import { describe, expect, it, beforeEach } from "bun:test"
import {
  createProgressEmitter,
  type RlmProgressEvent,
  type RlmStreamingResultEvent,
} from "./progress-emitter"

describe("progress-emitter", () => {
  let logged: Array<{ message: string; data: unknown }>
  let logger: (message: string, data?: unknown) => void

  beforeEach(() => {
    logged = []
    logger = (message, data) => {
      logged.push({ message, data })
    }
  })

  describe("#given createProgressEmitter with default config", () => {
    describe("#when emitBefore is called for first operation", () => {
      it("#then logs progress event with correct fields", () => {
        const emitter = createProgressEmitter({}, logger)

        emitter.emitBefore("chat-1", "rlm-1", 0, 3, "split")

        expect(logged).toHaveLength(1)
        const event = logged[0].data as RlmProgressEvent
        expect(event.type).toBe("rlm:plan:progress")
        expect(event.chatSessionId).toBe("chat-1")
        expect(event.rlmSessionId).toBe("rlm-1")
        expect(event.opIndex).toBe(0)
        expect(event.opCount).toBe(3)
        expect(event.opType).toBe("split")
        expect(event.phase).toBe("before")
        expect(event.timestamp).toBeGreaterThan(0)
      })
    })

    describe("#when emitAfter is called", () => {
      it("#then logs progress event with durationMs", () => {
        const emitter = createProgressEmitter({}, logger)

        emitter.emitAfter("chat-1", "rlm-1", 0, 3, "split", 42)

        expect(logged).toHaveLength(1)
        const event = logged[0].data as RlmProgressEvent
        expect(event.phase).toBe("after")
        expect(event.durationMs).toBe(42)
        expect(event.error).toBeUndefined()
      })

      it("#then includes error when provided", () => {
        const emitter = createProgressEmitter({}, logger)

        emitter.emitAfter("chat-1", "rlm-1", 1, 3, "map_llm", 100, "something broke")

        expect(logged).toHaveLength(1)
        const event = logged[0].data as RlmProgressEvent
        expect(event.error).toBe("something broke")
      })
    })

    describe("#when emitBefore is called for the last operation", () => {
      it("#then always emits regardless of throttle", () => {
        const emitter = createProgressEmitter({}, logger)

        emitter.emitBefore("chat-1", "rlm-1", 4, 5, "final_var")

        expect(logged).toHaveLength(1)
      })
    })
  })

  describe("#given createProgressEmitter with throttling", () => {
    describe("#when emitBefore is called rapidly for middle operations", () => {
      it("#then throttles intermediate before-events", () => {
        const emitter = createProgressEmitter({ throttleMs: 10_000 }, logger)

        emitter.emitBefore("chat-1", "rlm-1", 0, 5, "split")
        emitter.emitBefore("chat-1", "rlm-1", 1, 5, "select")
        emitter.emitBefore("chat-1", "rlm-1", 2, 5, "map_llm")
        emitter.emitBefore("chat-1", "rlm-1", 3, 5, "concat")
        emitter.emitBefore("chat-1", "rlm-1", 4, 5, "final_var")

        const beforeEvents = logged.filter((l) => (l.data as RlmProgressEvent).phase === "before")
        expect(beforeEvents).toHaveLength(2)
        expect((beforeEvents[0].data as RlmProgressEvent).opIndex).toBe(0)
        expect((beforeEvents[1].data as RlmProgressEvent).opIndex).toBe(4)
      })
    })

    describe("#when emitAfter is called for all operations", () => {
      it("#then always emits after events without throttling", () => {
        const emitter = createProgressEmitter({ throttleMs: 10_000 }, logger)

        emitter.emitAfter("chat-1", "rlm-1", 0, 3, "split", 10)
        emitter.emitAfter("chat-1", "rlm-1", 1, 3, "select", 20)
        emitter.emitAfter("chat-1", "rlm-1", 2, 3, "concat", 30)

        expect(logged).toHaveLength(3)
      })
    })
  })

  describe("#given createProgressEmitter with zero throttle", () => {
    describe("#when emitBefore is called for every operation", () => {
      it("#then emits all before events", () => {
        const emitter = createProgressEmitter({ throttleMs: 0 }, logger)

        emitter.emitBefore("chat-1", "rlm-1", 0, 3, "split")
        emitter.emitBefore("chat-1", "rlm-1", 1, 3, "select")
        emitter.emitBefore("chat-1", "rlm-1", 2, 3, "concat")

        const beforeEvents = logged.filter((l) => (l.data as RlmProgressEvent).phase === "before")
        expect(beforeEvents).toHaveLength(3)
      })
    })
  })

  describe("#given progress event log formatting", () => {
    it("#then formats message with op index and type", () => {
      const emitter = createProgressEmitter({}, logger)

      emitter.emitBefore("chat-1", "rlm-1", 2, 5, "map_llm")

      expect(logged[0].message).toBe("[rlm:progress] before op 3/5 (map_llm)")
    })

    it("#then includes both session IDs in event data", () => {
      const emitter = createProgressEmitter({}, logger)

      emitter.emitAfter("chat-session-abc", "rlm-session-xyz", 0, 1, "exec", 50)

      const event = logged[0].data as RlmProgressEvent
      expect(event.chatSessionId).toBe("chat-session-abc")
      expect(event.rlmSessionId).toBe("rlm-session-xyz")
    })
  })

  describe("#given streaming result emission", () => {
    describe("#when emitStreamingResult is called with small result", () => {
      it("#then emits streaming event with inline partial_result", () => {
        const emitter = createProgressEmitter(
          { streamingEnabled: true, offloadThresholdBytes: 2048 },
          logger,
        )

        emitter.emitStreamingResult("chat-1", "rlm-1", 2, "map_llm", "partial output", 50)

        const streamEvents = logged.filter(
          (l) => (l.data as RlmStreamingResultEvent).type === "rlm:plan:streaming",
        )
        expect(streamEvents).toHaveLength(1)

        const event = streamEvents[0].data as RlmStreamingResultEvent
        expect(event.operation_index).toBe(2)
        expect(event.operation_type).toBe("map_llm")
        expect(event.partial_result).toBe("partial output")
        expect(event.percent_complete).toBe(50)
        expect(event.timestamp).toBeGreaterThan(0)
      })
    })

    describe("#when emitStreamingResult is called with large result exceeding threshold", () => {
      it("#then truncates partial_result and marks as offloaded", () => {
        const emitter = createProgressEmitter(
          { streamingEnabled: true, offloadThresholdBytes: 50 },
          logger,
        )

        const largeContent = "x".repeat(200)
        emitter.emitStreamingResult("chat-1", "rlm-1", 0, "reduce_llm", largeContent, 75)

        const streamEvents = logged.filter(
          (l) => (l.data as RlmStreamingResultEvent).type === "rlm:plan:streaming",
        )
        expect(streamEvents).toHaveLength(1)

        const event = streamEvents[0].data as RlmStreamingResultEvent
        expect(event.partial_result).toEqual({
          preview: largeContent.slice(0, 200),
          byteSize: Buffer.byteLength(largeContent, "utf8"),
          truncated: true,
        })
      })
    })

    describe("#when streaming is disabled via config", () => {
      it("#then does not emit streaming events", () => {
        const emitter = createProgressEmitter(
          { streamingEnabled: false },
          logger,
        )

        emitter.emitStreamingResult("chat-1", "rlm-1", 0, "map_llm", "result", 100)

        const streamEvents = logged.filter(
          (l) => (l.data as RlmStreamingResultEvent).type === "rlm:plan:streaming",
        )
        expect(streamEvents).toHaveLength(0)
      })
    })

    describe("#when streaming events are throttled", () => {
      it("#then respects streaming_throttle_ms independently from before/after throttle", () => {
        const emitter = createProgressEmitter(
          { streamingEnabled: true, streamingThrottleMs: 10_000 },
          logger,
        )

        emitter.emitStreamingResult("chat-1", "rlm-1", 0, "map_llm", "r1", 25)
        emitter.emitStreamingResult("chat-1", "rlm-1", 0, "map_llm", "r2", 50)
        emitter.emitStreamingResult("chat-1", "rlm-1", 0, "map_llm", "r3", 75)
        emitter.emitStreamingResult("chat-1", "rlm-1", 0, "map_llm", "r4", 100)

        const streamEvents = logged.filter(
          (l) => (l.data as RlmStreamingResultEvent).type === "rlm:plan:streaming",
        )
        expect(streamEvents).toHaveLength(2)
        expect((streamEvents[0].data as RlmStreamingResultEvent).percent_complete).toBe(25)
        expect((streamEvents[1].data as RlmStreamingResultEvent).percent_complete).toBe(100)
      })
    })

    describe("#when percent_complete is 100", () => {
      it("#then always emits regardless of throttle", () => {
        const emitter = createProgressEmitter(
          { streamingEnabled: true, streamingThrottleMs: 10_000 },
          logger,
        )

        emitter.emitStreamingResult("chat-1", "rlm-1", 0, "map_llm", "first", 25)
        emitter.emitStreamingResult("chat-1", "rlm-1", 0, "map_llm", "done", 100)

        const streamEvents = logged.filter(
          (l) => (l.data as RlmStreamingResultEvent).type === "rlm:plan:streaming",
        )
        expect(streamEvents).toHaveLength(2)
      })
    })

    describe("#when streaming throttle is zero", () => {
      it("#then emits all streaming events", () => {
        const emitter = createProgressEmitter(
          { streamingEnabled: true, streamingThrottleMs: 0 },
          logger,
        )

        emitter.emitStreamingResult("chat-1", "rlm-1", 0, "map_llm", "r1", 33)
        emitter.emitStreamingResult("chat-1", "rlm-1", 0, "map_llm", "r2", 66)
        emitter.emitStreamingResult("chat-1", "rlm-1", 0, "map_llm", "r3", 100)

        const streamEvents = logged.filter(
          (l) => (l.data as RlmStreamingResultEvent).type === "rlm:plan:streaming",
        )
        expect(streamEvents).toHaveLength(3)
      })
    })

    describe("#when streaming log message is formatted", () => {
      it("#then includes operation index and percent", () => {
        const emitter = createProgressEmitter(
          { streamingEnabled: true },
          logger,
        )

        emitter.emitStreamingResult("chat-1", "rlm-1", 3, "map_llm", "partial", 42)

        const streamLog = logged.find(
          (l) => (l.data as RlmStreamingResultEvent).type === "rlm:plan:streaming",
        )
        expect(streamLog?.message).toBe("[rlm:streaming] op 3 (map_llm) 42%")
      })
    })
  })
})
