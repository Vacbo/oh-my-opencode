import { randomUUID } from "node:crypto"
import type { RlmConfig } from "../../../config/schema/experimental"
import { RlmContextManager } from "../../rlm-context/manager"
import { coordinator } from "../../rlm-context/coordinator"
import { initRlmSession } from "../../../tools/rlm/init-session"
import { buildRlmSystemPrompt } from "../../../tools/rlm/system-prompt"
import { log } from "../../../shared"
import {
  parseRlmArguments,
  extractTaggedBlocks,
  resolveSourceHandles,
} from "./source-resolver"
import { RLM_COMMAND_MARKER, RLM_COMMAND_MARKER_END } from "./template"

const DEFAULT_MAX_DEPTH = 1
const DEFAULT_CONTEXT_DIR = ".sisyphus/rlm-contexts"

type ChatMessageOutput = {
  message: Record<string, unknown>
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>
}

export function createRlmCommandPreprocessor(
  rlmConfig: RlmConfig | undefined,
  workingDir: string,
) {
  const contextManager = new RlmContextManager()
  const maxDepth = rlmConfig?.max_depth ?? DEFAULT_MAX_DEPTH
  const contextDir = rlmConfig?.context_storage_dir ?? DEFAULT_CONTEXT_DIR
  const printLimitBytes = rlmConfig?.exec?.print_limit_bytes

  return async (
    input: { sessionID: string },
    output: ChatMessageOutput,
  ): Promise<void> => {
    const textPartIndex = output.parts.findIndex(
      (p) => p.type === "text" && p.text?.includes(RLM_COMMAND_MARKER),
    )
    if (textPartIndex === -1) return

    const partText = output.parts[textPartIndex].text ?? ""
    const markerStart = partText.indexOf(RLM_COMMAND_MARKER)
    const markerEnd = partText.indexOf(RLM_COMMAND_MARKER_END)
    if (markerStart === -1 || markerEnd === -1) return

    const rawArguments = partText
      .slice(markerStart + RLM_COMMAND_MARKER.length, markerEnd)
      .trim()

    log("[rlm-command] Preprocessing RLM command", {
      sessionID: input.sessionID,
      rawArguments: rawArguments.slice(0, 100),
    })

    const taggedContent = extractTaggedBlocks(rawArguments)
    const { sourceHandles, query } = parseRlmArguments(
      taggedContent ? rawArguments.replace(/```[\s\S]*?```/g, "").trim() : rawArguments,
    )

    let resolvedContent: string
    let fileCount = 0

    if (taggedContent && sourceHandles.length === 0) {
      resolvedContent = taggedContent
    } else if (sourceHandles.length > 0) {
      const resolved = await resolveSourceHandles(sourceHandles, workingDir)
      resolvedContent = taggedContent
        ? `${taggedContent}\n\n${resolved.content}`
        : resolved.content
      fileCount = resolved.fileCount
    } else {
      log("[rlm-command] No source handles or tagged blocks found, using query as-is", {
        sessionID: input.sessionID,
      })
      output.parts[textPartIndex].text = query
      return
    }

    if (resolvedContent.length === 0) {
      log("[rlm-command] Resolved content is empty, skipping RLM session init", {
        sessionID: input.sessionID,
      })
      output.parts[textPartIndex].text = query
      return
    }

    const sessionId = `rlm-${input.sessionID}-${randomUUID().slice(0, 8)}`

    const result = await initRlmSession(contextManager, {
      sessionId,
      query,
      content: resolvedContent,
      maxDepth,
      contextDir,
    })

    coordinator.bind(input.sessionID, {
      manager: contextManager,
      rlmSessionId: sessionId,
      depth: result.depth,
      query,
      contextVariableName: result.contextMetadata.contextVariableName,
      trusted: true,
    })

    const systemPrompt = buildRlmSystemPrompt({
      depth: result.depth,
      maxDepth: result.maxDepth,
      contextMetadata: {
        contextVariableName: result.contextMetadata.contextVariableName,
        contextSize: result.contextMetadata.contextSize,
        contextType: result.contextMetadata.contextType,
      },
      mode: "canonical",
      printLimitBytes,
    })

    log("[rlm-command] RLM session initialized", {
      sessionID: input.sessionID,
      rlmSessionId: sessionId,
      fileCount,
      contextSize: result.contextMetadata.contextSize,
      lineCount: result.contextMetadata.lineCount,
    })

    const contextSummary = formatContextSummary(
      result.contextMetadata.contextVariableName,
      result.contextMetadata.lineCount,
      result.contextMetadata.contextSize,
      result.contextMetadata.contextType,
    )

    output.parts[textPartIndex].text = `${systemPrompt}\n\n---\n\n**Query:** ${query}\n\n${contextSummary}`
  }
}

function formatContextSummary(
  variableName: string,
  lineCount: number,
  byteSize: number,
  contextType: string,
): string {
  return `**Context loaded:** \`${variableName}\` (${lineCount} lines, ${formatBytes(byteSize)}, source: ${contextType})\n\nUse \`rlm_probe\` to inspect the context. Do NOT attempt to read the raw content directly — it is stored out-of-window.`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
