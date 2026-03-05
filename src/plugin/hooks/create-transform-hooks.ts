import type { OhMyOpenCodeConfig } from "../../config"
import type { PluginContext } from "../types"

import {
  createClaudeCodeHooksHook,
  createKeywordDetectorHook,
  createThinkingBlockValidatorHook,
} from "../../hooks"
import {
  contextCollector,
  createContextInjectorMessagesTransformHook,
} from "../../features/context-injector"
import { safeCreateHook } from "../../shared/safe-create-hook"
import { registerDynamicKeywordDetector } from "../../hooks/keyword-detector/dynamic-detectors"
import { RLM_ALIAS_PATTERN, getRlmAliasMessage } from "../../hooks/keyword-detector/rlm-alias"

export type TransformHooks = {
  claudeCodeHooks: ReturnType<typeof createClaudeCodeHooksHook> | null
  keywordDetector: ReturnType<typeof createKeywordDetectorHook> | null
  contextInjectorMessagesTransform: ReturnType<typeof createContextInjectorMessagesTransformHook>
  thinkingBlockValidator: ReturnType<typeof createThinkingBlockValidatorHook> | null
}

export function createTransformHooks(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  isHookEnabled: (hookName: string) => boolean
  safeHookEnabled?: boolean
}): TransformHooks {
  const { ctx, pluginConfig, isHookEnabled } = args
  const safeHookEnabled = args.safeHookEnabled ?? true

  const claudeCodeHooks = isHookEnabled("claude-code-hooks")
    ? safeCreateHook(
        "claude-code-hooks",
        () =>
          createClaudeCodeHooksHook(
            ctx,
            {
              disabledHooks: (pluginConfig.claude_code?.hooks ?? true) ? undefined : true,
              keywordDetectorDisabled: !isHookEnabled("keyword-detector"),
            },
            contextCollector,
          ),
        { enabled: safeHookEnabled },
      )
    : null

  const rlmEnabled = pluginConfig.experimental?.rlm?.enabled ?? false
  if (rlmEnabled && isHookEnabled("keyword-detector")) {
    registerDynamicKeywordDetector({
      type: "rlm",
      pattern: RLM_ALIAS_PATTERN,
      message: getRlmAliasMessage,
    })
  }

  const keywordDetector = isHookEnabled("keyword-detector")
    ? safeCreateHook(
        "keyword-detector",
        () => createKeywordDetectorHook(ctx, contextCollector),
        { enabled: safeHookEnabled },
      )
    : null

  const contextInjectorMessagesTransform =
    createContextInjectorMessagesTransformHook(contextCollector)

  const thinkingBlockValidator = isHookEnabled("thinking-block-validator")
    ? safeCreateHook(
        "thinking-block-validator",
        () => createThinkingBlockValidatorHook(),
        { enabled: safeHookEnabled },
      )
    : null

  return {
    claudeCodeHooks,
    keywordDetector,
    contextInjectorMessagesTransform,
    thinkingBlockValidator,
  }
}
