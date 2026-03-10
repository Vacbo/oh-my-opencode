import type { RlmConfig } from "../../config/schema/experimental"
import { coordinator } from "../../features/rlm-context/coordinator"
import type { RlmSessionState } from "../../features/rlm-context/types"
import { applyFeedback } from "../../features/rlm-context/turn-feedback"
import { shouldDistillOutput, distillOutput } from "./distill-decision"
import { consumeFinalFromMessage } from "./final-consumer"

const DEFAULT_DISTILL_THRESHOLD_TOKENS = 2000

interface RlmContextManagerLike {
  getSession: (sessionId: string) => RlmSessionState | undefined | Promise<RlmSessionState | undefined>
}

export function createRlmOutputDistillerHook(
  config?: RlmConfig,
  rlmContextManager?: RlmContextManagerLike,
) {
  const thresholdTokens = config?.distill_threshold_tokens ?? DEFAULT_DISTILL_THRESHOLD_TOKENS
  const feedbackConfig = config ?? { enabled: false, max_depth: 1, context_storage_dir: ".sisyphus/rlm-contexts", distill_threshold_tokens: thresholdTokens, probe_max_lines: 200 }

  const toolExecuteAfter = async (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: unknown },
  ) => {
    if (input.tool === "rlm_finish") return

    if (!rlmContextManager) return

    const session = await rlmContextManager.getSession(input.sessionID)
    if (!session) return

    if (typeof output.output !== "string") return

    output.output = await applyFeedback(
      output.output,
      input.sessionID,
      input.tool,
      coordinator.resolve(input.sessionID),
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
