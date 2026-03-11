import type { RlmConfig } from "../../config/schema/experimental"
import { coordinator } from "../../features/rlm-context/coordinator"
import { applyFeedback } from "../../features/rlm-context/turn-feedback"
import { shouldDistillOutput, distillOutput } from "./distill-decision"
import { consumeFinalFromMessage } from "./final-consumer"

const DEFAULT_DISTILL_THRESHOLD_TOKENS = 2000

export function createRlmOutputDistillerHook(
  config?: RlmConfig,
) {
  const thresholdTokens = config?.distill_threshold_tokens ?? DEFAULT_DISTILL_THRESHOLD_TOKENS
  const feedbackConfig = config ?? { enabled: false, max_depth: 1, context_storage_dir: ".sisyphus/rlm-contexts", distill_threshold_tokens: thresholdTokens, probe_max_lines: 200 }

  const toolExecuteAfter = async (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: unknown },
  ) => {
    if (input.tool === "rlm_finish") return

    const binding = coordinator.resolve(input.sessionID)
    if (!binding) return

    const session = await binding.manager.getSession(binding.rlmSessionId)
    if (!session) return
    if (typeof output.output !== "string") return

    output.output = await applyFeedback(
      output.output,
      input.sessionID,
      input.tool,
      binding,
      feedbackConfig,
    )

    const needsDistill = shouldDistillOutput({
      outputCharCount: output.output.length,
      thresholdTokens,
      sessionShouldDistill: session.shouldDistill,
      sessionID: input.sessionID,
    })

    if (!needsDistill) return

    output.output = distillOutput(output.output, thresholdTokens)
  }

  const chatMessage = async (
    input: { sessionID: string },
    output: { message: Record<string, unknown>; parts: Array<{ type: string; text?: string; [key: string]: unknown }> },
  ) => {
    const binding = coordinator.resolve(input.sessionID)
    if (!binding) return

    await consumeFinalFromMessage(input.sessionID, output)
  }

  return {
    "tool.execute.after": toolExecuteAfter,
    "chat.message": chatMessage,
  }
}
