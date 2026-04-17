import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { LanguageModel } from "ai"

export type ProviderName = "github" | "openrouter" | "nvidia"

export interface ProviderConfig {
  name: ProviderName
  envVar: string
  baseURL: string
  defaultModel: string
  rateLimitPerMinute: number
}

export const PROVIDERS: Record<ProviderName, ProviderConfig> = {
  github: {
    name: "github",
    envVar: "GITHUB_TOKEN",
    baseURL: "https://models.github.ai/inference",
    defaultModel: "openai/gpt-4.1-mini",
    rateLimitPerMinute: 12,
  },
  openrouter: {
    name: "openrouter",
    envVar: "OPENROUTER_API_KEY",
    baseURL: "https://openrouter.ai/api/v1",
    defaultModel: "qwen/qwen3-coder:free",
    rateLimitPerMinute: 18,
  },
  nvidia: {
    name: "nvidia",
    envVar: "NVIDIA_API_KEY",
    baseURL: "https://integrate.api.nvidia.com/v1",
    defaultModel: "nvidia/llama-3.3-nemotron-super-49b-v1",
    rateLimitPerMinute: 35,
  },
}

function readApiKey(provider: ProviderConfig): string | undefined {
  const value = process.env[provider.envVar]
  return value && value.length > 0 ? value : undefined
}

export function availableProviders(): ProviderName[] {
  return (Object.keys(PROVIDERS) as ProviderName[]).filter((name) => readApiKey(PROVIDERS[name]) !== undefined)
}

export function buildLanguageModel(provider: ProviderName, modelId: string): LanguageModel {
  const config = PROVIDERS[provider]
  const apiKey = readApiKey(config)
  if (!apiKey) {
    throw new Error(`Provider ${provider} is missing env var ${config.envVar}`)
  }
  const compatible = createOpenAICompatible({
    name: config.name,
    baseURL: config.baseURL,
    apiKey,
  })
  return compatible.chatModel(modelId)
}

export interface ChainEntry {
  provider: ProviderName
  modelId: string
}

export function parseChainSpec(raw: string): ChainEntry[] {
  if (!raw || !raw.trim()) return []
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const [rawProvider, ...rest] = entry.split(":")
      const provider = rawProvider.trim()
      const modelId = rest.join(":").trim()
      if (!isProviderName(provider) || !modelId) {
        throw new Error(`Invalid chain entry "${entry}" (expected "provider:modelId")`)
      }
      return { provider, modelId }
    })
}

function isProviderName(value: string): value is ProviderName {
  return value === "github" || value === "openrouter" || value === "nvidia"
}
