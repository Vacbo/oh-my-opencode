import { DEFAULT_RLM_OUTPUT_THRESHOLD_BYTES } from "../../config/schema/experimental"

export interface RlmProgressEvent {
  type: "rlm:plan:progress"
  chatSessionId: string
  rlmSessionId: string
  opIndex: number
  opCount: number
  opType: string
  phase: "before" | "after"
  timestamp: number
  durationMs?: number
  error?: string
}

export interface RlmStreamingResultEvent {
  type: "rlm:plan:streaming"
  chatSessionId: string
  rlmSessionId: string
  operation_index: number
  operation_type: string
  partial_result: string | { preview: string; byteSize: number; truncated: true }
  percent_complete: number
  timestamp: number
}

export interface RlmProgressEmitter {
  emitBefore(chatSessionId: string, rlmSessionId: string, opIndex: number, opCount: number, opType: string): void
  emitAfter(chatSessionId: string, rlmSessionId: string, opIndex: number, opCount: number, opType: string, durationMs: number, error?: string): void
  emitStreamingResult(chatSessionId: string, rlmSessionId: string, operationIndex: number, operationType: string, partialResult: string, percentComplete: number): void
}

export interface RlmProgressEmitterConfig {
  throttleMs: number
  streamingEnabled: boolean
  streamingThrottleMs: number
  offloadThresholdBytes: number
}

const DEFAULT_THROTTLE_MS = 200
const DEFAULT_STREAMING_THROTTLE_MS = 100
const MAX_PREVIEW_CHARS = 200

type LogFn = (message: string, data?: unknown) => void

function truncateForStreaming(
  content: string,
  thresholdBytes: number,
): RlmStreamingResultEvent["partial_result"] {
  const byteSize = Buffer.byteLength(content, "utf8")
  if (byteSize <= thresholdBytes) {
    return content
  }
  return { preview: content.slice(0, MAX_PREVIEW_CHARS), byteSize, truncated: true }
}

export function createProgressEmitter(
  config: Partial<RlmProgressEmitterConfig>,
  logger: LogFn,
): RlmProgressEmitter {
  const throttleMs = config.throttleMs ?? DEFAULT_THROTTLE_MS
  const streamingEnabled = config.streamingEnabled ?? true
  const streamingThrottleMs = config.streamingThrottleMs ?? DEFAULT_STREAMING_THROTTLE_MS
  const offloadThresholdBytes = config.offloadThresholdBytes ?? DEFAULT_RLM_OUTPUT_THRESHOLD_BYTES
  let lastEmitTime = 0
  let lastStreamingEmitTime = 0

  function shouldEmit(phase: "before" | "after", opIndex: number, opCount: number): boolean {
    if (phase === "after") {
      return true
    }
    if (opIndex === 0 || opIndex === opCount - 1) {
      return true
    }
    const now = Date.now()
    if (now - lastEmitTime >= throttleMs) {
      return true
    }
    return false
  }

  function shouldEmitStreaming(percentComplete: number): boolean {
    if (percentComplete === 100) {
      return true
    }
    if (lastStreamingEmitTime === 0) {
      return true
    }
    const now = Date.now()
    return now - lastStreamingEmitTime >= streamingThrottleMs
  }

  function emit(event: RlmProgressEvent): void {
    lastEmitTime = Date.now()
    logger(`[rlm:progress] ${event.phase} op ${event.opIndex + 1}/${event.opCount} (${event.opType})`, event)
  }

  function emitStreaming(event: RlmStreamingResultEvent): void {
    lastStreamingEmitTime = Date.now()
    logger(`[rlm:streaming] op ${event.operation_index} (${event.operation_type}) ${event.percent_complete}%`, event)
  }

  return {
    emitBefore(chatSessionId, rlmSessionId, opIndex, opCount, opType) {
      if (!shouldEmit("before", opIndex, opCount)) {
        return
      }
      emit({
        type: "rlm:plan:progress",
        chatSessionId,
        rlmSessionId,
        opIndex,
        opCount,
        opType,
        phase: "before",
        timestamp: Date.now(),
      })
    },

    emitAfter(chatSessionId, rlmSessionId, opIndex, opCount, opType, durationMs, error) {
      if (!shouldEmit("after", opIndex, opCount)) {
        return
      }
      emit({
        type: "rlm:plan:progress",
        chatSessionId,
        rlmSessionId,
        opIndex,
        opCount,
        opType,
        phase: "after",
        timestamp: Date.now(),
        durationMs,
        ...(error !== undefined ? { error } : {}),
      })
    },

    emitStreamingResult(chatSessionId, rlmSessionId, operationIndex, operationType, partialResult, percentComplete) {
      if (!streamingEnabled) {
        return
      }
      if (!shouldEmitStreaming(percentComplete)) {
        return
      }
      emitStreaming({
        type: "rlm:plan:streaming",
        chatSessionId,
        rlmSessionId,
        operation_index: operationIndex,
        operation_type: operationType,
        partial_result: truncateForStreaming(partialResult, offloadThresholdBytes),
        percent_complete: percentComplete,
        timestamp: Date.now(),
      })
    },
  }
}
