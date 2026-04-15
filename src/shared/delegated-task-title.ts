import { getAgentConfigKey, normalizeAgentForUi } from "./agent-display-names"

export function resolveDelegatedTaskLabel(
  agentName: string | undefined,
  category: string | undefined,
): string | undefined {
  const normalizedCategory = category?.trim()
  const normalizedAgent = normalizeAgentForUi(agentName)

  if (!normalizedAgent) {
    return normalizedCategory || undefined
  }

  if (normalizedCategory && getAgentConfigKey(normalizedAgent) === "sisyphus-junior") {
    return normalizedCategory
  }

  return normalizedAgent
}

export function formatDelegatedTaskTitle(params: {
  agentName: string | undefined
  category: string | undefined
  description: string
}): string {
  const label = resolveDelegatedTaskLabel(params.agentName, params.category)
  return label ? `${label} - ${params.description}` : params.description
}
