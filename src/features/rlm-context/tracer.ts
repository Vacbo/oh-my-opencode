/**
 * Structured session tracing for RLM with span-based logging.
 */

import { log } from "../../shared"
import type { RlmTracingConfig } from "../../config/schema/experimental"
import * as fs from "node:fs"
import * as path from "node:path"

export interface RlmSpan {
  spanId: string
  parentSpanId?: string
  chatSessionId: string
  rlmSessionId: string
  operation: string
  startTime: number
  endTime?: number
  status: "ok" | "error"
  metadata?: Record<string, unknown>
  error?: string
}

export interface SpanTreeNode {
  span: RlmSpan
  children: SpanTreeNode[]
}

export interface RlmTracer {
  startSpan(
    chatSessionId: string,
    rlmSessionId: string,
    operation: string,
    parentSpanId?: string,
  ): RlmSpan
  endSpan(spanId: string, status: "ok" | "error", error?: string): void
  getSpans(rlmSessionId: string): RlmSpan[]
  getTrace(rootSpanId: string): SpanTreeNode | undefined
}

class RlmTracerImpl implements RlmTracer {
  private spans = new Map<string, RlmSpan>()
  private spansBySession = new Map<string, RlmSpan[]>()
  private config: RlmTracingConfig

  constructor(config: RlmTracingConfig) {
    this.config = config
  }

  startSpan(
    chatSessionId: string,
    rlmSessionId: string,
    operation: string,
    parentSpanId?: string,
  ): RlmSpan {
    const span: RlmSpan = {
      spanId: generateSpanId(),
      parentSpanId,
      chatSessionId,
      rlmSessionId,
      operation,
      startTime: Date.now(),
      status: "ok",
    }

    this.spans.set(span.spanId, span)

    const sessionSpans = this.spansBySession.get(rlmSessionId) ?? []
    sessionSpans.push(span)
    this.spansBySession.set(rlmSessionId, sessionSpans)

    this.outputSpan(span)
    return span
  }

  endSpan(spanId: string, status: "ok" | "error", error?: string): void {
    const span = this.spans.get(spanId)
    if (!span) return

    span.endTime = Date.now()
    span.status = status
    if (error) span.error = error

    this.outputSpan(span)
  }

  getSpans(rlmSessionId: string): RlmSpan[] {
    return this.spansBySession.get(rlmSessionId) ?? []
  }

  getTrace(rootSpanId: string): SpanTreeNode | undefined {
    const rootSpan = this.spans.get(rootSpanId)
    if (!rootSpan) return undefined

    return this.buildTree(rootSpan)
  }

  private buildTree(span: RlmSpan): SpanTreeNode {
    const children: SpanTreeNode[] = []

    for (const [, s] of this.spans) {
      if (s.parentSpanId === span.spanId) {
        children.push(this.buildTree(s))
      }
    }

    return { span, children }
  }

  private outputSpan(span: RlmSpan): void {
    if (this.config.output === "log" || this.config.output === "both") {
      log(JSON.stringify({ type: "rlm_span", ...span }))
    }

    if (this.config.output === "file" || this.config.output === "both") {
      this.writeToFile(span)
    }
  }

  private writeToFile(span: RlmSpan): void {
    const spansDir = this.config.spans_dir ?? ".sisyphus/rlm-traces"
    const filePath = path.join(spansDir, `${span.rlmSessionId}.jsonl`)

    try {
      fs.mkdirSync(spansDir, { recursive: true })
      fs.appendFileSync(filePath, JSON.stringify(span) + "\n")
    } catch {
      // Silent fail for file writes
    }
  }
}

class NoOpTracer implements RlmTracer {
  startSpan(
    _chatSessionId: string,
    _rlmSessionId: string,
    _operation: string,
    _parentSpanId?: string,
  ): RlmSpan {
    return {
      spanId: "",
      chatSessionId: "",
      rlmSessionId: "",
      operation: "",
      startTime: 0,
      status: "ok",
    }
  }

  endSpan(): void {}

  getSpans(): RlmSpan[] {
    return []
  }

  getTrace(): undefined {
    return undefined
  }
}

function generateSpanId(): string {
  return `span-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
}

export function createTracer(config: RlmTracingConfig): RlmTracer {
  if (!config.enabled) {
    return new NoOpTracer()
  }
  return new RlmTracerImpl(config)
}

export type { RlmTracingConfig }
