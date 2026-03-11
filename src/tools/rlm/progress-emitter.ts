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

export interface RlmProgressEmitter {
  emitBefore(chatSessionId: string, rlmSessionId: string, opIndex: number, opCount: number, opType: string): void
  emitAfter(chatSessionId: string, rlmSessionId: string, opIndex: number, opCount: number, opType: string, durationMs: number, error?: string): void
}

export interface RlmProgressEmitterConfig {
  throttleMs: number
}

const DEFAULT_THROTTLE_MS = 200

type LogFn = (message: string, data?: unknown) => void

export function createProgressEmitter(
  config: Partial<RlmProgressEmitterConfig>,
  logger: LogFn,
): RlmProgressEmitter {
  const throttleMs = config.throttleMs ?? DEFAULT_THROTTLE_MS
  let lastEmitTime = 0

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

  function emit(event: RlmProgressEvent): void {
    lastEmitTime = Date.now()
    logger(`[rlm:progress] ${event.phase} op ${event.opIndex + 1}/${event.opCount} (${event.opType})`, event)
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
  }
}
