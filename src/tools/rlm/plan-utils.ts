import type { RlmBlobVariable, RlmSessionState } from "../../features/rlm-context/types"
import type { RlmContextManagerForPlan } from "./tools"
import type { SyncSubcallResult } from "./subcall-runner"

export function fillTemplate(template: string, query: string, item: string): string {
  return template.replaceAll("{{query}}", query).replaceAll("{{item}}", item)
}

export async function requireSession(
  contextManager: RlmContextManagerForPlan,
  sessionID: string,
): Promise<RlmSessionState> {
  const session = await contextManager.getSession(sessionID)
  if (!session) {
    throw new Error(`RLM session not found: ${sessionID}`)
  }
  return session
}

export async function requireBlob(
  contextManager: RlmContextManagerForPlan,
  sessionID: string,
  name: string,
): Promise<RlmBlobVariable> {
  const variable = await contextManager.getVariableByName(sessionID, name)
  if (!variable || variable.storageKind !== "blob") {
    throw new Error(`Blob variable not found: ${name}`)
  }
  return variable
}

export function itemVariableName(baseName: string, index: number): string {
  return `${baseName}_${index}`
}

export function chunkText(content: string, chunkSize: number): string[] {
  if (content.length === 0) {
    return []
  }
  const chunks: string[] = []
  for (let start = 0; start < content.length; start += chunkSize) {
    chunks.push(content.slice(start, start + chunkSize))
  }
  return chunks
}

export function resolveSubcallText(result: SyncSubcallResult): string {
  if (!result.ok) {
    throw new Error(result.error)
  }
  return result.terminalPayload?.final_answer ?? result.textOutput
}
