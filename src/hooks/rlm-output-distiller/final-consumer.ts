import { coordinator, type RlmBinding } from "../../features/rlm-context/coordinator"
import { parseFinalAnswer, isParsedFinalSuccess, type ParseFinalResult } from "../../tools/rlm/parser"
import { log } from "../../shared"

interface MessagePart {
  type: string
  text?: string
  [key: string]: unknown
}

interface ChatMessageOutput {
  message: Record<string, unknown>
  parts: MessagePart[]
}

export interface FinalConsumerResult {
  detected: boolean
  finalValue?: string
  source?: "inline_final" | "inline_final_var"
  error?: string
}

/**
 * Scan assistant message parts for inline FINAL(value) or FINAL_VAR(varName) tags.
 * On detection: extract final value (or resolve variable), unbind the coordinator,
 * and append a result surface marker to the message.
 *
 * This is the root-level consumer that Algorithm 1 requires.
 */
export async function consumeFinalFromMessage(
  sessionID: string,
  output: ChatMessageOutput,
): Promise<FinalConsumerResult> {
  const binding = coordinator.resolve(sessionID)
  if (!binding) return { detected: false }

  for (const part of output.parts) {
    if (part.type !== "text" || !part.text) continue

    const result = parseFinalAnswer(part.text)
    if (!result) continue

    if (!isParsedFinalSuccess(result)) {
      log("[rlm-final-consumer] Malformed FINAL tag detected", {
        sessionID,
        error: result.message,
        raw: result.raw,
      })
      return { detected: true, error: result.message }
    }

    return await resolveFinalResult(sessionID, binding, result, part)
  }

  return { detected: false }
}

async function resolveFinalResult(
  sessionID: string,
  binding: RlmBinding,
  result: ParseFinalResult & { type: "final" | "final_var" },
  part: MessagePart,
): Promise<FinalConsumerResult> {
  if (result.type === "final") {
    log("[rlm-final-consumer] Inline FINAL detected, unbinding session", {
      sessionID,
      contentLength: result.content.length,
    })
    coordinator.unbind(sessionID)
    appendFinalSurface(part, result.content, "FINAL")
    return { detected: true, finalValue: result.content, source: "inline_final" }
  }

  const variable = await binding.manager.getVariableByName(
    binding.rlmSessionId,
    result.variableName,
  )

  if (!variable) {
    const errorMsg = `FINAL_VAR referenced unknown variable: ${result.variableName}`
    log("[rlm-final-consumer] Variable not found for FINAL_VAR", {
      sessionID,
      variableName: result.variableName,
    })
    return { detected: true, error: errorMsg }
  }

  if (variable.storageKind !== "blob") {
    const errorMsg = `FINAL_VAR referenced non-blob variable: ${result.variableName} (kind: ${variable.storageKind})`
    log("[rlm-final-consumer] Non-blob variable for FINAL_VAR", {
      sessionID,
      variableName: result.variableName,
      storageKind: variable.storageKind,
    })
    return { detected: true, error: errorMsg }
  }

  const content = await binding.manager.readBlobContent(variable)

  log("[rlm-final-consumer] Inline FINAL_VAR detected, unbinding session", {
    sessionID,
    variableName: result.variableName,
    contentLength: content.length,
  })
  coordinator.unbind(sessionID)
  appendFinalSurface(part, content, `FINAL_VAR(${result.variableName})`)
  return { detected: true, finalValue: content, source: "inline_final_var" }
}

function appendFinalSurface(part: MessagePart, content: string, source: string): void {
  part.text = `${part.text}\n\n---\n**[RLM Session Complete — ${source}]**\n\n${content}`
}
