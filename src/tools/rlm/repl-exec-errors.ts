import {
  RlmError,
  RlmErrorCode,
  rlmError,
} from "../../features/rlm-context/error-codes"

export function normalizeExecError(error: unknown): Error {
  if (error instanceof RlmError) {
    return error
  }
  const message = error instanceof Error ? error.message : String(error)
  if (matchesExecError(message, [/timed out/i])) {
    return rlmError(RlmErrorCode.EXEC_TIMEOUT, { message })
  }
  if (matchesExecError(message, [/out of memory/i, /allocation failed/i, /memory limit/i])) {
    return rlmError(RlmErrorCode.EXEC_MEMORY_LIMIT, { message })
  }
  if (matchesExecError(message, [/Code generation from strings disallowed/i, /Wasm code generation disallowed/i])) {
    return rlmError(RlmErrorCode.EXEC_SANDBOX_VIOLATION, { message })
  }
  return error instanceof Error ? error : new Error(message)
}

function matchesExecError(message: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(message))
}
