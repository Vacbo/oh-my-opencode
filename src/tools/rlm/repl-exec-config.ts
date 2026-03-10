import {
  DEFAULT_RLM_EXEC_TIMEOUT_MS,
  DEFAULT_RLM_OUTPUT_THRESHOLD_BYTES,
  type RlmConfig,
} from "../../config/schema/experimental"
import { coordinator, type RlmBinding } from "../../features/rlm-context/coordinator"

export function resolveRlmExecConfig(config: RlmConfig): {
  print_limit_bytes: number
  timeout_ms: number
  trusted_only: boolean
} {
  return {
    trusted_only: config.exec?.trusted_only ?? true,
    timeout_ms: config.exec?.timeout_ms ?? DEFAULT_RLM_EXEC_TIMEOUT_MS,
    print_limit_bytes:
      config.exec?.print_limit_bytes
      ?? config.feedback?.output_threshold_bytes
      ?? DEFAULT_RLM_OUTPUT_THRESHOLD_BYTES,
  }
}

export function assertExecTrusted(sessionID: string, config: RlmConfig): RlmBinding {
  const binding = coordinator.resolve(sessionID)
  if (!binding) {
    throw new Error(`RLM session not found: ${sessionID}`)
  }
  if (resolveRlmExecConfig(config).trusted_only && !binding.trusted) {
    throw new Error("exec requires trusted mode")
  }
  return binding
}