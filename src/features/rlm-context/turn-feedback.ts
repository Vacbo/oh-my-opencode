import { randomUUID } from "node:crypto"
import {
  DEFAULT_RLM_OUTPUT_THRESHOLD_BYTES,
  type RlmConfig,
} from "../../config/schema/experimental"
import type { RlmBinding, RlmContextManagerLike } from "./coordinator"

const MAX_PREVIEW_CHARS = 200
const HIDDEN_REF_PREFIX = "hidden://"
const HIDDEN_VARIABLE_PREFIX = "__hidden_"

export interface OffloadResult {
  ref: string
  variableName: string
  preview: string
}

export function shouldOffload(byteSize: number, config: RlmConfig): boolean {
  return byteSize > (config.feedback?.output_threshold_bytes ?? DEFAULT_RLM_OUTPUT_THRESHOLD_BYTES)
}

export function getHiddenVariableName(ref: string): string | undefined {
  if (!ref.startsWith(HIDDEN_REF_PREFIX)) {
    return undefined
  }

  const suffix = ref.slice(HIDDEN_REF_PREFIX.length)
  if (suffix.length === 0) {
    return undefined
  }

  return `${HIDDEN_VARIABLE_PREFIX}${suffix}`
}

export async function offloadOutput(
  content: string,
  sessionID: string,
  toolName: string,
  manager: RlmContextManagerLike,
  config: RlmConfig,
): Promise<OffloadResult> {
  void config

  const suffix = `${toolName}-${randomUUID()}`
  const variableName = `${HIDDEN_VARIABLE_PREFIX}${suffix}`
  await manager.createBlobVariable(
    sessionID,
    { name: variableName, content },
    { semanticType: "scratch" },
  )

  return {
    ref: `${HIDDEN_REF_PREFIX}${suffix}`,
    variableName,
    preview: content.slice(0, MAX_PREVIEW_CHARS),
  }
}

export async function applyFeedback(
  output: string,
  sessionID: string,
  toolName: string,
  binding: RlmBinding | undefined,
  config: RlmConfig,
): Promise<string> {
  if (!binding || toolName === "rlm_finish") {
    return output
  }

  if (!shouldOffload(Buffer.byteLength(output, "utf8"), config)) {
    return output
  }

  const result = await offloadOutput(output, sessionID, toolName, binding.manager, config)
  return JSON.stringify(result)
}
