type SessionMessage = {
  info?: { role?: string; finish?: string; time?: { created?: number } }
  parts?: unknown[]
}

export type TerminalPayload = {
  final_answer: string
  source?: string
  terminal?: boolean
}

const NON_TERMINAL_FINISH_REASONS = new Set(["tool-calls", "unknown"])

function extractStrings(part: unknown): string[] {
  if (typeof part !== "object" || part === null) {
    return []
  }
  const obj = part as Record<string, unknown>
  const values: string[] = []
  if (typeof obj.text === "string") values.push(obj.text)
  if (typeof obj.output === "string") values.push(obj.output)
  if (typeof obj.content === "string") values.push(obj.content)
  if (Array.isArray(obj.content)) {
    for (const block of obj.content) {
      if (typeof block === "object" && block !== null) {
        const text = (block as Record<string, unknown>).text
        if (typeof text === "string") values.push(text)
      }
    }
  }
  if (typeof obj.state === "object" && obj.state !== null) {
    const output = (obj.state as Record<string, unknown>).output
    if (typeof output === "string") values.push(output)
  }
  return values
}

function parseTerminalPayload(raw: string): TerminalPayload | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed.terminal !== true || typeof parsed.final_answer !== "string") {
      return null
    }
    return {
      final_answer: parsed.final_answer,
      source: typeof parsed.source === "string" ? parsed.source : undefined,
      terminal: true,
    }
  } catch {
    return null
  }
}

export function extractTerminalPayload(messages: SessionMessage[]): TerminalPayload | undefined {
  const ordered = [...messages].sort(
    (a, b) => (b.info?.time?.created ?? 0) - (a.info?.time?.created ?? 0),
  )
  for (const message of ordered) {
    for (const part of message.parts ?? []) {
      for (const raw of extractStrings(part)) {
        const parsed = parseTerminalPayload(raw)
        if (parsed) {
          return parsed
        }
      }
    }
  }
  return undefined
}

export function extractAssistantText(messages: SessionMessage[]): string {
  const ordered = [...messages].sort(
    (a, b) => (b.info?.time?.created ?? 0) - (a.info?.time?.created ?? 0),
  )
  for (const message of ordered) {
    if (message.info?.role !== "assistant") {
      continue
    }
    const texts: string[] = []
    for (const part of message.parts ?? []) {
      if (typeof part !== "object" || part === null) {
        continue
      }
      const obj = part as Record<string, unknown>
      const type = typeof obj.type === "string" ? obj.type : ""
      if ((type === "text" || type === "reasoning") && typeof obj.text === "string") {
        texts.push(obj.text)
      }
    }
    if (texts.length > 0) {
      return texts.join("\n").trim()
    }
  }
  return ""
}

export function isSubcallComplete(messages: SessionMessage[]): boolean {
  if (extractTerminalPayload(messages)) {
    return true
  }
  if (extractAssistantText(messages).length > 0) {
    return true
  }
  const ordered = [...messages].sort(
    (a, b) => (b.info?.time?.created ?? 0) - (a.info?.time?.created ?? 0),
  )
  const lastAssistant = ordered.find((message) => message.info?.role === "assistant")
  if (!lastAssistant?.info?.finish) {
    return false
  }
  return !NON_TERMINAL_FINISH_REASONS.has(lastAssistant.info.finish)
}
