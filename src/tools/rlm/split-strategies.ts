import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runSg } from "../ast-grep/cli"
import type { CliMatch } from "../ast-grep/types"
import { chunkText } from "./plan-utils"
import type {
  RlmPlanSplitCodeGranularity,
  RlmPlanSplitCodeLanguage,
} from "./types"

export const AST_SPLIT_FALLBACK_CHUNK_SIZE = 4000

const LANGUAGE_EXTENSIONS: Record<RlmPlanSplitCodeLanguage, string> = {
  typescript: ".ts",
  python: ".py",
  go: ".go",
}

function typescriptPatterns(granularity: RlmPlanSplitCodeGranularity): string[] {
  const functionPatterns = [
    "function $NAME($$$) { $$$ }",
    "async function $NAME($$$) { $$$ }",
    "export function $NAME($$$) { $$$ }",
    "export async function $NAME($$$) { $$$ }",
    "export default function $NAME($$$) { $$$ }",
    "export default async function $NAME($$$) { $$$ }",
  ]
  const classPatterns = [
    "class $NAME { $$$ }",
    "export class $NAME { $$$ }",
    "export default class $NAME { $$$ }",
  ]
  if (granularity === "function") return functionPatterns
  if (granularity === "class") return classPatterns
  return [...functionPatterns, ...classPatterns]
}

function pythonPatterns(granularity: RlmPlanSplitCodeGranularity): string[] {
  const functionPatterns = ["def $NAME($$$): $$$", "async def $NAME($$$): $$$"]
  const classPatterns = ["class $NAME: $$$", "class $NAME($$$): $$$"]
  if (granularity === "function") return functionPatterns
  if (granularity === "class") return classPatterns
  return [...functionPatterns, ...classPatterns]
}

function goPatterns(granularity: RlmPlanSplitCodeGranularity): string[] {
  const functionPatterns = [
    "func $NAME($$$) { $$$ }",
    "func ($$$) $NAME($$$) { $$$ }",
  ]
  const classPatterns = [
    "type $NAME struct { $$$ }",
    "type $NAME interface { $$$ }",
    "type $NAME = $TYPE",
    "type $NAME $TYPE",
  ]
  if (granularity === "function") return functionPatterns
  if (granularity === "class") return classPatterns
  return [...functionPatterns, ...classPatterns]
}

function getPatterns(
  language: RlmPlanSplitCodeLanguage,
  granularity: RlmPlanSplitCodeGranularity,
): string[] {
  switch (language) {
    case "typescript":
      return typescriptPatterns(granularity)
    case "python":
      return pythonPatterns(granularity)
    case "go":
      return goPatterns(granularity)
    default:
      return []
  }
}

function normalizeMatches(matches: CliMatch[]): CliMatch[] {
  const sorted = [...matches]
    .filter((match) => match.range.start.column === 0)
    .sort((left, right) => left.range.byteOffset.start - right.range.byteOffset.start)

  const normalized: CliMatch[] = []
  for (const match of sorted) {
    const start = match.range.byteOffset.start
    const end = match.range.byteOffset.end
    const previous = normalized.at(-1)
    if (end <= start) continue
    if (!previous) {
      normalized.push(match)
      continue
    }
    const previousStart = previous.range.byteOffset.start
    const previousEnd = previous.range.byteOffset.end
    if (start === previousStart && end === previousEnd) continue
    if (start < previousEnd) continue
    normalized.push(match)
  }
  return normalized
}

function extractChunks(content: string, matches: CliMatch[]): string[] {
  const buffer = Buffer.from(content, "utf8")
  return matches.map((match) =>
    buffer
      .subarray(match.range.byteOffset.start, match.range.byteOffset.end)
      .toString("utf8"),
  )
}

export async function splitByAst(
  content: string,
  language: RlmPlanSplitCodeLanguage,
  granularity: RlmPlanSplitCodeGranularity = "block",
): Promise<string[]> {
  if (content.length === 0) {
    return []
  }

  const tempDir = await mkdtemp(join(tmpdir(), "omo-rlm-split-"))
  const tempFile = join(tempDir, `input${LANGUAGE_EXTENSIONS[language]}`)

  try {
    await writeFile(tempFile, content, "utf8")
    const matches: CliMatch[] = []

    for (const pattern of getPatterns(language, granularity)) {
      const result = await runSg({ pattern, lang: language, paths: [tempFile] })
      if (result.error) {
        return chunkText(content, AST_SPLIT_FALLBACK_CHUNK_SIZE)
      }
      matches.push(...result.matches)
    }

    const chunks = extractChunks(content, normalizeMatches(matches))
    return chunks.length > 0
      ? chunks
      : chunkText(content, AST_SPLIT_FALLBACK_CHUNK_SIZE)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}
