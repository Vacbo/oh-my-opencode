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
  operation_name?: string
  operation_args?: Record<string, unknown>
  variables_created?: string[]
  startTime: number
  endTime?: number
  status: "ok" | "error"
  metadata?: Record<string, unknown>
  error?: string
}

type RlmSpanUpdate = Partial<Pick<RlmSpan, "operation_name" | "operation_args" | "variables_created" | "metadata">>

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
    update?: RlmSpanUpdate,
  ): RlmSpan
  endSpan(spanId: string, status: "ok" | "error", error?: string, update?: RlmSpanUpdate): void
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
    update?: RlmSpanUpdate,
  ): RlmSpan {
    const span: RlmSpan = {
      spanId: generateSpanId(),
      parentSpanId,
      chatSessionId,
      rlmSessionId,
      operation,
      startTime: Date.now(),
      status: "ok",
      ...update,
    }

    this.spans.set(span.spanId, span)

    const sessionSpans = this.spansBySession.get(rlmSessionId) ?? []
    sessionSpans.push(span)
    this.spansBySession.set(rlmSessionId, sessionSpans)

    this.outputSpan(span)
    return span
  }

  endSpan(spanId: string, status: "ok" | "error", error?: string, update?: RlmSpanUpdate): void {
    const span = this.spans.get(spanId)
    if (!span) return

    span.endTime = Date.now()
    span.status = status
    if (error) span.error = error
    if (update) {
      if (update.operation_name !== undefined) span.operation_name = update.operation_name
      if (update.operation_args !== undefined) span.operation_args = update.operation_args
      if (update.variables_created !== undefined) span.variables_created = update.variables_created
      if (update.metadata !== undefined) span.metadata = update.metadata
    }

    this.outputSpan(span)
  }

  getSpans(rlmSessionId: string): RlmSpan[] {
    return this.spansBySession.get(rlmSessionId) ?? []
  }

  getTrace(rootSpanId: string): SpanTreeNode | undefined {
    const rootSpan = this.spans.get(rootSpanId)
    if (!rootSpan) return undefined

    return this.buildTree(rootSpan, new Set())
  }

  private buildTree(span: RlmSpan, pathSet: Set<string>): SpanTreeNode {
    if (pathSet.has(span.spanId)) {
      return { span, children: [] }
    }
    pathSet.add(span.spanId)
    
    const children: SpanTreeNode[] = []
    for (const [, s] of this.spans) {
      if (s.parentSpanId === span.spanId) {
        children.push(this.buildTree(s, new Set(pathSet)))
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
    _update?: RlmSpanUpdate,
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

  endSpan(_spanId: string, _status: "ok" | "error", _error?: string, _update?: RlmSpanUpdate): void {}

  getSpans(): RlmSpan[] {
    return []
  }

  getTrace(): undefined {
    return undefined
  }
}

let spanIdCounter = 0

function generateSpanId(): string {
  spanIdCounter += 1
  return `span-${Date.now()}-${spanIdCounter}-${Math.random().toString(36).substring(2, 11)}`
}

export function createTracer(config: RlmTracingConfig): RlmTracer {
  if (!config.enabled) {
    return new NoOpTracer()
  }
  return new RlmTracerImpl(config)
}

export type { RlmTracingConfig }
