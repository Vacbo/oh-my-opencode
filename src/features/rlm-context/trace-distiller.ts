/**
 * Trace distillation: captures successful RLM traces for future few-shot learning.
 * Capture only — no retrieval, similarity matching, or prompt injection.
 */

import type { RlmSpan } from "./tracer"
import type { RlmTracingConfig } from "../../config/schema/experimental"
import * as fs from "node:fs"
import * as path from "node:path"

export interface DistilledTrace {
  sessionId: string
  rootQuery: string
  taskPrompt: string
  finalAnswer: string
  depth: number
  maxDepth: number
  model?: string
  provider?: string
  operations: Array<{ name: string; args: Record<string, unknown> | undefined; result: string | undefined }>
  capturedAt: number
}

export interface DistillOptions {
  terminal: boolean
  finalAnswer: string
  maxDepth: number
  rootQuery: string
  taskPrompt: string
  depth: number
  model?: string
  provider?: string
}

function hasSuccessfulTermination(spans: RlmSpan[]): boolean {
  if (spans.length === 0) return false
  const lastSpan = spans[spans.length - 1]
  return lastSpan.status === "ok"
}

function extractOperations(spans: RlmSpan[]): DistilledTrace["operations"] {
  return spans.map((span) => ({
    name: span.operation_name ?? span.operation,
    args: span.operation_args,
    result: span.metadata?.result !== undefined ? String(span.metadata.result) : undefined,
  }))
}

function writeDistilledTrace(trace: DistilledTrace, spansDir: string): void {
  const distillDir = path.join(spansDir, "distilled")
  const filePath = path.join(distillDir, `${trace.sessionId}.json`)

  try {
    fs.mkdirSync(distillDir, { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(trace, null, 2))
  } catch {
    // Silent fail for file writes — matches tracer.ts pattern
  }
}

export function captureDistilledTrace(
  sessionId: string,
  spans: RlmSpan[],
  options: DistillOptions,
  config: RlmTracingConfig,
): DistilledTrace | undefined {
  if (!config.distill_enabled) return undefined
  if (!options.terminal) return undefined
  if (!hasSuccessfulTermination(spans)) return undefined

  const trace: DistilledTrace = {
    sessionId,
    rootQuery: options.rootQuery,
    taskPrompt: options.taskPrompt,
    finalAnswer: options.finalAnswer,
    depth: options.depth,
    maxDepth: options.maxDepth,
    model: options.model,
    provider: options.provider,
    operations: extractOperations(spans),
    capturedAt: Date.now(),
  }

  writeDistilledTrace(trace, config.spans_dir)
  return trace
}
