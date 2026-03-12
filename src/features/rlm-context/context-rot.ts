import {
  DEFAULT_CONTEXT_ROT_CHECK_INTERVAL,
  DEFAULT_CONTEXT_ROT_WARNING_THRESHOLD,
} from "../../config/schema/experimental"
import type { RlmSpan } from "./tracer"

const HIDDEN_VARIABLE_PREFIX = "__hidden_"
const HIDDEN_REF_PREFIX = "hidden://"
const SUGGEST_FINISH_THRESHOLD = 0.9
const NO_NEW_VARS_STREAK = 5
const REPEATED_SEARCHES_THRESHOLD = 2
const REPEATED_PROBES_THRESHOLD = 3
const RISING_REF_COUNT_THRESHOLD = 3

const CONTEXT_ROT_WEIGHTS = {
  repeated_searches: 0.25,
  repeated_probes: 0.3,
  no_new_vars: 0.2,
  rising_ref_count: 0.35,
} as const

export type ContextRotIndicator = keyof typeof CONTEXT_ROT_WEIGHTS

export interface ContextRotSignal {
  score: number
  indicators: ContextRotIndicator[]
  recommendation: "healthy" | "monitor" | "warning" | "suggest_finish"
}

type ContextRotConfigInput = {
  check_interval?: number
  warning_threshold?: number
}

export function shouldCheckContextRot(
  operationCount: number,
  config: ContextRotConfigInput = {},
): boolean {
  const interval = config.check_interval ?? DEFAULT_CONTEXT_ROT_CHECK_INTERVAL
  return operationCount > 0 && operationCount % interval === 0
}

export function detectContextRot(
  spans: RlmSpan[],
  config: ContextRotConfigInput = {},
): ContextRotSignal {
  const indicators: ContextRotIndicator[] = []
  const operationSpans = spans
    .filter((span) => span.operation_name !== undefined)
    .sort((left, right) => left.startTime - right.startTime)

  if (hasRepeatedSearches(operationSpans)) {
    indicators.push("repeated_searches")
  }
  if (hasRepeatedProbes(operationSpans)) {
    indicators.push("repeated_probes")
  }
  if (hasNoNewVars(operationSpans)) {
    indicators.push("no_new_vars")
  }
  if (hasRisingRefCount(operationSpans)) {
    indicators.push("rising_ref_count")
  }

  if (indicators.length === 0) {
    return {
      score: 0,
      indicators: [],
      recommendation: "healthy",
    }
  }

  const score = clamp01(
    indicators.reduce((total, indicator) => total + CONTEXT_ROT_WEIGHTS[indicator], 0),
  )
  const warningThreshold = config.warning_threshold ?? DEFAULT_CONTEXT_ROT_WARNING_THRESHOLD

  return {
    score,
    indicators,
    recommendation: score > SUGGEST_FINISH_THRESHOLD
      ? "suggest_finish"
      : score > warningThreshold
        ? "warning"
        : "monitor",
  }
}

function hasRepeatedSearches(spans: RlmSpan[]): boolean {
  const counts = new Map<string, number>()
  for (const span of spans) {
    if (!isSearchOperation(span.operation_name)) {
      continue
    }
    const pattern = getStringArg(span, "pattern")
    if (!pattern) {
      continue
    }
    const nextCount = (counts.get(pattern) ?? 0) + 1
    if (nextCount > REPEATED_SEARCHES_THRESHOLD) {
      return true
    }
    counts.set(pattern, nextCount)
  }
  return false
}

function hasRepeatedProbes(spans: RlmSpan[]): boolean {
  const counts = new Map<string, number>()
  for (const span of spans) {
    if (!isProbeOperation(span.operation_name)) {
      continue
    }
    const variableName = getStringArg(span, "variable_name")
    if (!variableName) {
      continue
    }
    const nextCount = (counts.get(variableName) ?? 0) + 1
    if (nextCount > REPEATED_PROBES_THRESHOLD) {
      return true
    }
    counts.set(variableName, nextCount)
  }
  return false
}

function hasNoNewVars(spans: RlmSpan[]): boolean {
  let streak = 0
  for (const span of spans) {
    if ((span.variables_created?.length ?? 0) > 0) {
      streak = 0
      continue
    }
    streak += 1
    if (streak >= NO_NEW_VARS_STREAK) {
      return true
    }
  }
  return false
}

function hasRisingRefCount(spans: RlmSpan[]): boolean {
  const unresolvedHiddenRefs = new Set<string>()
  let maxOutstanding = 0
  let resolutionCount = 0

  for (const span of spans) {
    for (const variableName of span.variables_created ?? []) {
      if (isHiddenVariable(variableName)) {
        unresolvedHiddenRefs.add(variableName)
      }
    }

    const resolvedHiddenRef = getResolvedHiddenRef(span)
    if (resolvedHiddenRef && unresolvedHiddenRefs.delete(resolvedHiddenRef)) {
      resolutionCount += 1
    }

    if (unresolvedHiddenRefs.size > maxOutstanding) {
      maxOutstanding = unresolvedHiddenRefs.size
    }
  }

  return maxOutstanding >= RISING_REF_COUNT_THRESHOLD && resolutionCount === 0
}

function getResolvedHiddenRef(span: RlmSpan): string | undefined {
  const variableName = getStringArg(span, "variable_name")
  if (variableName && isHiddenVariable(variableName)) {
    return variableName
  }

  const ref = getStringArg(span, "ref")
  if (ref?.startsWith(HIDDEN_REF_PREFIX)) {
    return `${HIDDEN_VARIABLE_PREFIX}${ref.slice(HIDDEN_REF_PREFIX.length)}`
  }

  return undefined
}

function getStringArg(span: RlmSpan, key: string): string | undefined {
  const value = span.operation_args?.[key]
  return typeof value === "string" ? value : undefined
}

function isHiddenVariable(variableName: string): boolean {
  return variableName.startsWith(HIDDEN_VARIABLE_PREFIX)
}

function isSearchOperation(operationName?: string): boolean {
  return operationName === "search" || operationName === "rlm_search"
}

function isProbeOperation(operationName?: string): boolean {
  return operationName === "probe" || operationName === "inspect_ref" || operationName === "rlm_probe"
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
