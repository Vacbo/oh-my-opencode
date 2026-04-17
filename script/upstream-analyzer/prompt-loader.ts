import { readFile } from "node:fs/promises"
import { join } from "node:path"

const PROMPT_DIR = ".github/prompts"

const PROMPT_FILES = {
  commitClassify: "commit-classify.md",
  slopVerify: "slop-verify.md",
  releaseSynthesis: "release-synthesis.md",
} as const

export type PromptName = keyof typeof PROMPT_FILES

export async function loadPrompt(name: PromptName): Promise<string> {
  const filename = PROMPT_FILES[name]
  const path = join(PROMPT_DIR, filename)
  try {
    return (await readFile(path, "utf8")).trim()
  } catch (cause) {
    throw new Error(`Failed to load prompt ${name} from ${path}: ${(cause as Error).message}`)
  }
}

export async function loadAllPrompts(): Promise<Record<PromptName, string>> {
  const [commitClassify, slopVerify, releaseSynthesis] = await Promise.all([
    loadPrompt("commitClassify"),
    loadPrompt("slopVerify"),
    loadPrompt("releaseSynthesis"),
  ])
  return { commitClassify, slopVerify, releaseSynthesis }
}
