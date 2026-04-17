const ENDPOINT = "https://models.github.ai/inference/chat/completions"

interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

interface InferenceRequest {
  model: string
  systemPrompt: string
  userPrompt: string
  maxTokens: number
  temperature?: number
}

interface InferenceResult {
  raw: string
  parsed: unknown
  modelUsed: string
}

class GithubModelsError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message)
    this.name = "GithubModelsError"
  }
}

function requireToken(): string {
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    throw new Error("GITHUB_TOKEN not set. Workflow needs permissions.models: read.")
  }
  return token
}

function stripMarkdownFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim()
}

function parseJsonResponse(raw: string): unknown {
  const stripped = stripMarkdownFences(raw)
  try {
    return JSON.parse(stripped)
  } catch {
    return null
  }
}

// gpt-5 family and o-series models reject `max_tokens`; they require
// `max_completion_tokens` and ignore `temperature`. Detect up front so
// we never waste a request on a 400 "Unsupported parameter" response.
function tokenFieldForModel(model: string): "max_tokens" | "max_completion_tokens" {
  if (/\/(gpt-5|o[0-9])/i.test(model)) return "max_completion_tokens"
  return "max_tokens"
}

async function postChatCompletion(
  token: string,
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
  temperature: number,
): Promise<string> {
  const tokenField = tokenFieldForModel(model)
  const body: Record<string, unknown> = {
    model,
    messages,
    [tokenField]: maxTokens,
  }
  if (tokenField === "max_tokens") {
    body.temperature = temperature
  }

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new GithubModelsError(`GitHub Models returned ${response.status}`, response.status, errorBody)
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new Error("GitHub Models returned empty completion")
  }
  return content
}

export async function inferJson(req: InferenceRequest): Promise<InferenceResult> {
  const token = requireToken()
  const raw = await postChatCompletion(
    token,
    req.model,
    [
      { role: "system", content: req.systemPrompt },
      { role: "user", content: req.userPrompt },
    ],
    req.maxTokens,
    req.temperature ?? 0.1,
  )
  return { raw, parsed: parseJsonResponse(raw), modelUsed: req.model }
}

function isQuotaError(err: unknown): boolean {
  if (!(err instanceof GithubModelsError)) return false
  if (err.status === 429) return true
  if (err.status === 403) return /rate[_-]?limit|quota|exceed/i.test(err.body)
  return false
}

function isContextLengthError(err: unknown): boolean {
  if (!(err instanceof GithubModelsError)) return false
  if (err.status !== 400) return false
  // Narrow: only real context-length rejections. The "Unsupported parameter:
  // max_tokens" 400 no longer reaches here because tokenFieldForModel picks
  // the right field up front.
  return /context[_ -]?length|too[_ -]?long|maximum\s+context/i.test(err.body)
}

export function shouldFallback(err: unknown): boolean {
  return isQuotaError(err) || isContextLengthError(err)
}

export interface FallbackInferenceRequest extends Omit<InferenceRequest, "model"> {
  primaryModel: string
  fallbackModels: string[]
  onFallback?: (failedModel: string, nextModel: string, reason: string) => void
}

export async function inferJsonWithFallback(
  req: FallbackInferenceRequest,
): Promise<InferenceResult> {
  const chain = [req.primaryModel, ...req.fallbackModels]
  let lastError: unknown
  for (let i = 0; i < chain.length; i++) {
    const model = chain[i]
    try {
      return await inferJson({
        model,
        systemPrompt: req.systemPrompt,
        userPrompt: req.userPrompt,
        maxTokens: req.maxTokens,
        temperature: req.temperature,
      })
    } catch (err) {
      lastError = err
      const isLast = i === chain.length - 1
      if (isLast || !shouldFallback(err)) throw err
      const reason = err instanceof GithubModelsError ? `${err.status} ${err.body.slice(0, 160)}` : String(err)
      req.onFallback?.(model, chain[i + 1], reason)
    }
  }
  throw lastError ?? new Error("inferJsonWithFallback exhausted without error (unreachable)")
}

export { GithubModelsError }
