import type { RlmConfig } from "../../config/schema/experimental"
import type { RlmSessionState } from "../../features/rlm-context/types"
import { shouldDistillOutput, distillOutput } from "./distill-decision"

const DEFAULT_DISTILL_THRESHOLD_TOKENS = 2000

interface RlmContextManagerLike {
  getSession: (sessionId: string) => RlmSessionState | undefined | Promise<RlmSessionState | undefined>
}

export function createRlmOutputDistillerHook(
  config?: RlmConfig,
  rlmContextManager?: RlmContextManagerLike,
) {
  const thresholdTokens = config?.distill_threshold_tokens ?? DEFAULT_DISTILL_THRESHOLD_TOKENS

  const toolExecuteAfter = async (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: unknown },
  ) => {
    if (input.tool === "rlm_finish") return

    if (!rlmContextManager) return

    const session = await rlmContextManager.getSession(input.sessionID)
    if (!session) return

    if (typeof output.output !== "string") return

    const needsDistill = shouldDistillOutput({
      outputCharCount: output.output.length,
      thresholdTokens,
      sessionShouldDistill: session.shouldDistill,
    })

    if (!needsDistill) return

    output.output = distillOutput(output.output, thresholdTokens)
  }

  return {
    "tool.execute.after": toolExecuteAfter,
  }
}
