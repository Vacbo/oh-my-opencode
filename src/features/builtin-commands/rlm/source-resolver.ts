import { readFile, stat } from "node:fs/promises"
import { resolve } from "node:path"

export interface ResolvedSource {
  content: string
  fileCount: number
  totalBytes: number
}

const TAGGED_BLOCK_PATTERN = /^```[\s\S]*?```$/m
const GLOB_CHARS = /[*?[\]{}]/

export function parseRlmArguments(rawArguments: string): { sourceHandles: string[]; query: string } {
  const trimmed = rawArguments.trim()

  const separatorIndex = trimmed.indexOf("--")
  if (separatorIndex !== -1) {
    const sourcesPart = trimmed.slice(0, separatorIndex).trim()
    const queryPart = trimmed.slice(separatorIndex + 2).trim()
    return {
      sourceHandles: splitSourceHandles(sourcesPart),
      query: queryPart || sourcesPart,
    }
  }

  const tokens = trimmed.split(/\s+/)
  const sources: string[] = []
  const queryTokens: string[] = []

  for (const token of tokens) {
    if (sources.length === 0 && queryTokens.length === 0 && looksLikeSourceHandle(token)) {
      sources.push(token)
    } else if (queryTokens.length === 0 && looksLikeSourceHandle(token)) {
      sources.push(token)
    } else {
      queryTokens.push(token)
    }
  }

  if (queryTokens.length === 0 && sources.length > 0) {
    return { sourceHandles: sources, query: `Analyze: ${sources.join(", ")}` }
  }

  return {
    sourceHandles: sources,
    query: queryTokens.join(" "),
  }
}

function looksLikeSourceHandle(token: string): boolean {
  if (GLOB_CHARS.test(token)) return true
  if (token.includes("/") || token.includes("\\")) return true
  if (token.includes(".") && !token.startsWith(".") && token.split(".").length === 2) return true
  return false
}

function splitSourceHandles(input: string): string[] {
  return input
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function extractTaggedBlocks(text: string): string | null {
  const matches = text.match(TAGGED_BLOCK_PATTERN)
  if (!matches || matches.length === 0) return null

  return matches
    .map((block) => {
      const lines = block.split("\n")
      return lines.slice(1, -1).join("\n")
    })
    .join("\n\n")
}

async function expandGlob(pattern: string, cwd: string): Promise<string[]> {
  const globInstance = new Bun.Glob(pattern)
  const results: string[] = []
  for await (const match of globInstance.scan({ cwd, absolute: true, onlyFiles: true })) {
    results.push(match)
  }
  return results
}

export async function resolveSourceHandles(
  handles: string[],
  workingDir: string,
): Promise<ResolvedSource> {
  if (handles.length === 0) {
    return { content: "", fileCount: 0, totalBytes: 0 }
  }

  const allPaths: string[] = []

  for (const handle of handles) {
    if (GLOB_CHARS.test(handle)) {
      const matched = await expandGlob(handle, workingDir)
      allPaths.push(...matched)
    } else {
      const absolutePath = resolve(workingDir, handle)
      try {
        const fileStat = await stat(absolutePath)
        if (fileStat.isFile()) {
          allPaths.push(absolutePath)
        }
      } catch {
        continue
      }
    }
  }

  const uniquePaths = [...new Set(allPaths)]
  const contentParts: string[] = []
  let totalBytes = 0

  for (const filePath of uniquePaths) {
    const fileContent = await readFile(filePath, "utf8")
    contentParts.push(`--- ${filePath} ---\n${fileContent}`)
    totalBytes += Buffer.byteLength(fileContent, "utf8")
  }

  return {
    content: contentParts.join("\n\n"),
    fileCount: uniquePaths.length,
    totalBytes,
  }
}
