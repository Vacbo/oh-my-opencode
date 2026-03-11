import type { RlmBlobVariable } from "../../features/rlm-context/types"
import type { RlmContextManagerForPlan } from "./plan-tool"
import {
  chunkText,
  itemVariableName,
  requireBlob,
} from "./plan-utils"

export async function executeSplitOperation(
  contextManager: RlmContextManagerForPlan,
  rlmSessionId: string,
  input: { variable_name: string; chunk_size: number; output_variable: string },
): Promise<{ output_variable: string; item_count: number }> {
  const source = await requireBlob(contextManager, rlmSessionId, input.variable_name)
  const chunks = chunkText(await contextManager.readBlobContent(source), input.chunk_size)
  const chunkNames: string[] = []

  for (let i = 0; i < chunks.length; i += 1) {
    const chunkName = itemVariableName(input.output_variable, i)
    await contextManager.createBlobVariable(
      rlmSessionId,
      { name: chunkName, content: chunks[i] },
      { semanticType: "derived" },
    )
    chunkNames.push(chunkName)
  }

  await contextManager.createManifestVariable(
    rlmSessionId,
    { name: input.output_variable, variableNames: chunkNames },
    { semanticType: "derived" },
  )

  return { output_variable: input.output_variable, item_count: chunkNames.length }
}

export async function executeSelectOperation(
  contextManager: RlmContextManagerForPlan,
  rlmSessionId: string,
  input: {
    variable_name: string
    indices?: number[]
    filter?: string
    output_variable: string
  },
): Promise<{ output_variable: string; item_count: number }> {
  const items = await contextManager.resolveManifestItems(rlmSessionId, input.variable_name)
  const indexed = input.indices
    ? input.indices.map((idx) => {
        if (idx >= items.length) {
          throw new Error(`select index out of range: ${idx}`)
        }
        return items[idx]
      })
    : items
  const selected: RlmBlobVariable[] = []

  for (const item of indexed) {
    const content = await contextManager.readBlobContent(item)
    if (!input.filter || content.includes(input.filter)) {
      selected.push(item)
    }
  }

  await contextManager.createManifestVariable(
    rlmSessionId,
    { name: input.output_variable, variableNames: selected.map((item) => item.name) },
    { semanticType: "derived" },
  )

  return { output_variable: input.output_variable, item_count: selected.length }
}

export async function executeConcatOperation(
  contextManager: RlmContextManagerForPlan,
  rlmSessionId: string,
  input: { variable_name: string; output_variable: string },
): Promise<{ output_variable: string; item_count: number }> {
  const items = await contextManager.resolveManifestItems(rlmSessionId, input.variable_name)
  const contents: string[] = []
  for (const item of items) {
    contents.push(await contextManager.readBlobContent(item))
  }

  await contextManager.createBlobVariable(
    rlmSessionId,
    { name: input.output_variable, content: contents.join("\n") },
    { semanticType: "derived" },
  )

  return { output_variable: input.output_variable, item_count: items.length }
}

export async function executeWriteVarOperation(
  contextManager: RlmContextManagerForPlan,
  rlmSessionId: string,
  input: { variable_name: string; content: string },
): Promise<{ variable_name: string }> {
  await contextManager.createBlobVariable(
    rlmSessionId,
    { name: input.variable_name, content: input.content },
    { semanticType: "scratch" },
  )
  return { variable_name: input.variable_name }
}
