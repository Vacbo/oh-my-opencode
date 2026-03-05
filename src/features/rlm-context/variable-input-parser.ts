import type { RlmSemanticType } from "./types"

export type BlobFromContentInput = {
  name: string
  content: string
}

export type BlobFromFileInput = {
  name: string
  file_path: string
}

export type CreateBlobVariableInput = BlobFromContentInput | BlobFromFileInput

export type CreateManifestVariableInput = {
  name: string
  variableNames: string[]
}

export type VariableOptions = {
  semanticType?: RlmSemanticType
}

export type ParsedBlobInput =
  | { name: string; source: "content"; content: string }
  | { name: string; source: "file_path"; file_path: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function parseBlobInput(input: CreateBlobVariableInput): ParsedBlobInput {
  if (!isRecord(input) || typeof input.name !== "string") {
    throw new Error("Blob input must include a string name")
  }

  const raw = input as Record<string, unknown>
  const content = raw.content
  const filePath = raw.file_path
  const hasContent = typeof content === "string"
  const hasFilePath = typeof filePath === "string"
  if (hasContent === hasFilePath) {
    throw new Error("Blob input must contain exactly one of content or file_path")
  }

  if (hasContent) {
    return { name: input.name, source: "content", content }
  }

  return { name: input.name, source: "file_path", file_path: filePath as string }
}

export function parseManifestInput(input: CreateManifestVariableInput): CreateManifestVariableInput {
  if (!isRecord(input) || typeof input.name !== "string") {
    throw new Error("Manifest input must include a string name")
  }
  if (!Array.isArray(input.variableNames) || !input.variableNames.every((name) => typeof name === "string")) {
    throw new Error("Manifest input variableNames must be a string array")
  }

  return {
    name: input.name,
    variableNames: input.variableNames,
  }
}
