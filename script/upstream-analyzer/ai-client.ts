import {
  APICallError,
  generateObject,
  generateText,
  Output,
  stepCountIs,
  type ToolSet,
} from "ai"
import type { ZodType } from "zod"
import { PROVIDERS, buildLanguageModel, type ChainEntry } from "./providers"
import { getLimiter } from "./throttle"

export interface GenerateOptions<TObject> {
  chain: ChainEntry[]
  systemPrompt: string
  userPrompt: string
  schema: ZodType<TObject>
  schemaName: string
  schemaDescription?: string
  tools?: ToolSet
  maxOutputTokens: number
  temperature?: number
  maxSteps?: number
  onProviderFallback?: (args: { failed: ChainEntry; next: ChainEntry; reason: string }) => void
}

export interface GenerateResult<TObject> {
  object: TObject
  usedEntry: ChainEntry
  attempts: number
}

interface ProviderFailureInfo {
  retriable: boolean
  reason: string
}

const DEFAULT_MAX_STEPS = 4

function stringifyBody(raw: unknown): string {
  if (typeof raw === "string") return raw
  if (raw === null || raw === undefined) return ""
  try {
    return JSON.stringify(raw)
  } catch {
    return String(raw)
  }
}

function isProviderSelectionFailure(body: string): boolean {
  return /no allowed providers are available for the selected model|no such provider/i.test(body)
}

function classifyError(err: unknown): ProviderFailureInfo {
  // APICallError.isInstance is the SDK-supported cross-realm check; plain
  // `instanceof` can miss errors constructed by a different copy of the
  // package (e.g., when multiple provider plugins bundle their own).
  if (APICallError.isInstance(err)) {
    const status = err.statusCode ?? 0
    const body = stringifyBody(err.responseBody ?? err.message)
    if (isProviderSelectionFailure(body)) {
      return { retriable: true, reason: `provider selection ${body.slice(0, 200)}` }
    }
    if (status === 429) return { retriable: true, reason: `429 ${body.slice(0, 200)}` }
    if (status === 402) return { retriable: true, reason: `402 ${body.slice(0, 200)}` }
    if (status === 403 && /quota|rate|exceed/i.test(body)) {
      return { retriable: true, reason: `403 quota ${body.slice(0, 200)}` }
    }
    if (status === 400 && /context[_ -]?length|too[_ -]?long|maximum\s+context/i.test(body)) {
      return { retriable: true, reason: `400 context ${body.slice(0, 200)}` }
    }
    return { retriable: false, reason: `${status} ${body.slice(0, 200)}` }
  }
  const message = String(err)
  if (isProviderSelectionFailure(message)) {
    return { retriable: true, reason: `provider selection ${message.slice(0, 200)}` }
  }
  return { retriable: false, reason: message }
}

async function callWithoutTools<TObject>(
  entry: ChainEntry,
  options: GenerateOptions<TObject>,
): Promise<TObject> {
  const model = buildLanguageModel(entry.provider, entry.modelId)
  const result = await generateObject({
    model,
    system: options.systemPrompt,
    prompt: options.userPrompt,
    schema: options.schema,
    schemaName: options.schemaName,
    schemaDescription: options.schemaDescription,
    maxOutputTokens: options.maxOutputTokens,
    temperature: options.temperature,
  })
  return result.object as TObject
}

async function callWithTools<TObject>(
  entry: ChainEntry,
  options: GenerateOptions<TObject>,
): Promise<TObject> {
  // AI SDK v6: generateObject does NOT accept tools. For structured output
  // combined with a tool-calling loop, use generateText with
  // experimental_output (Output.object) and stopWhen(stepCountIs(N)).
  // The model may invoke tools across multiple turns, and the final step's
  // structured output is surfaced via result.experimental_output.
  const model = buildLanguageModel(entry.provider, entry.modelId)
  const result = await generateText({
    model,
    system: options.systemPrompt,
    prompt: options.userPrompt,
    tools: options.tools,
    stopWhen: stepCountIs(options.maxSteps ?? DEFAULT_MAX_STEPS),
    experimental_output: Output.object({
      schema: options.schema,
      name: options.schemaName,
      description: options.schemaDescription,
    }),
    maxOutputTokens: options.maxOutputTokens,
    temperature: options.temperature,
  })
  const structured = result.experimental_output as TObject | undefined
  if (structured === undefined) {
    throw new Error(
      "generateText returned no structured output; model may have stopped without emitting the final object",
    )
  }
  return structured
}

export async function generateStructured<TObject>(
  options: GenerateOptions<TObject>,
): Promise<GenerateResult<TObject>> {
  if (options.chain.length === 0) {
    throw new Error("generateStructured: empty provider chain")
  }

  const hasTools = options.tools !== undefined && Object.keys(options.tools).length > 0

  let lastError: unknown
  for (let attempt = 0; attempt < options.chain.length; attempt++) {
    const entry = options.chain[attempt]
    const providerConfig = PROVIDERS[entry.provider]
    const limiter = getLimiter(entry.provider, providerConfig.rateLimitPerMinute)
    await limiter.throttle()

    try {
      const object = hasTools
        ? await callWithTools<TObject>(entry, options)
        : await callWithoutTools<TObject>(entry, options)
      return { object, usedEntry: entry, attempts: attempt + 1 }
    } catch (err) {
      lastError = err
      const { retriable, reason } = classifyError(err)
      const isLast = attempt === options.chain.length - 1
      if (!retriable || isLast) {
        throw err
      }
      options.onProviderFallback?.({ failed: entry, next: options.chain[attempt + 1], reason })
    }
  }

  throw lastError ?? new Error("generateStructured: chain exhausted without error (unreachable)")
}
