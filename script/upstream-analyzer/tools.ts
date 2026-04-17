import { $ } from "bun"
import { readFile } from "node:fs/promises"
import { tool } from "ai"
import { z } from "zod"

const MAX_FILE_READ_CHARS = 8000
const MAX_GREP_OUTPUT_CHARS = 6000

async function readFileSlice(path: string, startLine: number, endLine: number): Promise<string> {
  const content = await readFile(path, "utf8")
  const lines = content.split("\n")
  const clampedStart = Math.max(0, startLine - 1)
  const clampedEnd = Math.min(lines.length, endLine)
  const slice = lines.slice(clampedStart, clampedEnd)
  const joined = slice.map((line, i) => `${clampedStart + i + 1}: ${line}`).join("\n")
  return truncate(joined, MAX_FILE_READ_CHARS)
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n...[truncated at ${limit} chars]`
}

export const readFileTool = tool({
  description:
    "Read a slice of a file at a given path. Use this to verify that the commit's changes make sense in the broader context of the file (e.g., confirm a renamed function is actually used elsewhere). Keep slices small (under 200 lines) to conserve context.",
  inputSchema: z.object({
    path: z.string().describe("Repository-relative file path (e.g., src/foo/bar.ts)"),
    startLine: z.number().int().min(1).describe("1-indexed starting line"),
    endLine: z.number().int().min(1).describe("1-indexed end line (inclusive)"),
  }),
  execute: async ({ path, startLine, endLine }) => {
    try {
      return await readFileSlice(path, startLine, endLine)
    } catch (cause) {
      return `Error reading ${path}: ${(cause as Error).message}`
    }
  },
})

async function runGrep(pattern: string, extraArgs: string[]): Promise<string> {
  const result = await $`git grep -n --no-color ${pattern} ${extraArgs}`.quiet().nothrow()
  const combined = `${result.stdout.toString()}${result.stderr.toString()}`
  if (!combined.trim()) return "(no matches)"
  return truncate(combined, MAX_GREP_OUTPUT_CHARS)
}

export const grepCallersTool = tool({
  description:
    "Search the repository for references to a symbol (function name, class name, identifier). Use this to verify that a commit's rename or signature change does not leave dangling callers. Returns matching file:line locations.",
  inputSchema: z.object({
    symbol: z.string().min(1).describe("Identifier to search for (exact string, not regex)"),
    pathGlob: z
      .string()
      .optional()
      .describe("Optional path glob to limit search (e.g., 'src/*.ts'). Omit to search everything."),
  }),
  execute: async ({ symbol, pathGlob }) => {
    try {
      const extraArgs = pathGlob ? ["--", pathGlob] : []
      return await runGrep(symbol, extraArgs)
    } catch (cause) {
      return `Error searching for ${symbol}: ${(cause as Error).message}`
    }
  },
})

export const CLASSIFIER_TOOLS = {
  read_file: readFileTool,
  grep_callers: grepCallersTool,
}

export type ClassifierToolName = keyof typeof CLASSIFIER_TOOLS
