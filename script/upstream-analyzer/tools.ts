import { $ } from "bun"
import { resolve, sep, isAbsolute } from "node:path"
import { tool } from "ai"
import { z } from "zod"

const MAX_FILE_READ_CHARS = 8000
const MAX_GREP_OUTPUT_CHARS = 6000
const WORKSPACE_ROOT = resolve(process.cwd())

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n...[truncated at ${limit} chars]`
}

// The analyzer runs over untrusted upstream commits. An attacker who controls
// upstream commit messages or diffs can prompt-inject the model into calling
// our tools with adversarial arguments. Validate every path + ref + symbol
// before handing it to git/fs to prevent secret exfiltration, command
// injection, or working-tree escape.
function assertSafeRelativePath(inputPath: string): string {
  if (isAbsolute(inputPath)) {
    throw new Error("Absolute paths are not allowed")
  }
  if (inputPath.includes("\0")) {
    throw new Error("Null bytes in path are not allowed")
  }
  const resolved = resolve(WORKSPACE_ROOT, inputPath)
  if (!resolved.startsWith(`${WORKSPACE_ROOT}${sep}`) && resolved !== WORKSPACE_ROOT) {
    throw new Error("Path resolves outside the workspace root")
  }
  if (inputPath.split(/[\\/]/).some((segment) => segment === ".git")) {
    throw new Error("Reads inside .git/ are not allowed")
  }
  return resolved
}

// Allow only sha1/sha256 hex, tag/branch names, and common git ref characters.
// Rejects shell metachars, whitespace, and path-traversal attempts so a model
// can never turn `ref` into an argument to a different git subcommand.
const SAFE_REF_PATTERN = /^[a-zA-Z0-9._/\-]{1,200}$/

function assertSafeRef(ref: string): string {
  if (!SAFE_REF_PATTERN.test(ref)) {
    throw new Error(`Unsafe git ref: ${JSON.stringify(ref)}`)
  }
  return ref
}

async function readFileAtRef(ref: string, path: string, startLine: number, endLine: number): Promise<string> {
  assertSafeRelativePath(path)
  assertSafeRef(ref)
  const result = await $`git show ${`${ref}:${path}`}`.quiet().nothrow()
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim() || "(unknown git error)"
    return `Error reading ${path} at ${ref}: ${stderr.slice(0, 300)}`
  }
  const content = result.stdout.toString()
  const lines = content.split("\n")
  const clampedStart = Math.max(0, startLine - 1)
  const clampedEnd = Math.min(lines.length, endLine)
  const slice = lines.slice(clampedStart, clampedEnd)
  const joined = slice.map((line, i) => `${clampedStart + i + 1}: ${line}`).join("\n")
  return truncate(joined, MAX_FILE_READ_CHARS)
}

export const readFileTool = tool({
  description:
    "Read a slice of a file at a specific git revision. Use this to verify that the commit's changes make sense in the broader context of the file at the moment the commit was authored. Paths must be repo-relative; absolute paths and '..' are rejected.",
  inputSchema: z.object({
    ref: z
      .string()
      .min(1)
      .max(200)
      .describe("Git revision to read from (commit sha, tag, or branch). Use the commit being classified or its parent."),
    path: z.string().min(1).max(500).describe("Repository-relative file path (e.g., src/foo/bar.ts)"),
    startLine: z.number().int().min(1).describe("1-indexed starting line"),
    endLine: z.number().int().min(1).describe("1-indexed end line (inclusive)"),
  }),
  execute: async ({ ref, path, startLine, endLine }) => {
    try {
      return await readFileAtRef(ref, path, startLine, endLine)
    } catch (cause) {
      return `Error reading ${path} at ${ref}: ${(cause as Error).message}`
    }
  },
})

async function runGrepAtRef(ref: string, symbol: string, pathGlob: string | undefined): Promise<string> {
  assertSafeRef(ref)
  if (symbol.includes("\0")) {
    throw new Error("Null bytes in symbol are not allowed")
  }
  const safeGlob = pathGlob ? [`--`, pathGlob] : []
  // -F forces fixed-string (not regex), -- disables further flag parsing so a
  // symbol starting with "-" is always treated as data, and we pin the search
  // to a specific git revision so results reflect upstream state, not fork HEAD.
  const result = await $`git grep -n --no-color -F -e ${symbol} ${ref} ${safeGlob}`.quiet().nothrow()
  const combined = `${result.stdout.toString()}${result.stderr.toString()}`
  if (!combined.trim()) return "(no matches)"
  return truncate(combined, MAX_GREP_OUTPUT_CHARS)
}

export const grepCallersTool = tool({
  description:
    "Search the repository at a specific git revision for references to a symbol (function name, class name, identifier). Exact-string match (not regex). Use this to verify that a commit's rename or signature change does not leave dangling callers.",
  inputSchema: z.object({
    ref: z.string().min(1).max(200).describe("Git revision to search (commit sha, tag, or branch)"),
    symbol: z.string().min(1).max(300).describe("Identifier to search for (exact string, not regex)"),
    pathGlob: z
      .string()
      .max(300)
      .optional()
      .describe("Optional path glob to limit search (e.g., 'src/*.ts'). Omit to search everything."),
  }),
  execute: async ({ ref, symbol, pathGlob }) => {
    try {
      return await runGrepAtRef(ref, symbol, pathGlob)
    } catch (cause) {
      return `Error searching for ${symbol} at ${ref}: ${(cause as Error).message}`
    }
  },
})

export const CLASSIFIER_TOOLS = {
  read_file: readFileTool,
  grep_callers: grepCallersTool,
}

export type ClassifierToolName = keyof typeof CLASSIFIER_TOOLS
