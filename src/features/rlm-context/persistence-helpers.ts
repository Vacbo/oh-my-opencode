import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import type { PersistedVariableInfo } from "./persistence"

const METADATA_FILE = "metadata.json"
const QUARANTINE_DIR = ".quarantine"

export async function validateBlobIntegrity(
  sessionDir: string,
  manifest: PersistedVariableInfo[],
): Promise<void> {
  for (const varInfo of manifest) {
    if (varInfo.storageKind !== "blob") continue
    const fileStat = await stat(resolve(sessionDir, varInfo.filePath))
    if (fileStat.size !== varInfo.byteSize) {
      throw new Error(
        `Blob size mismatch for ${varInfo.name}: expected ${varInfo.byteSize}, got ${fileStat.size}`,
      )
    }
  }
}

export async function quarantineSession(
  storageDir: string,
  sessionId: string,
  error: unknown,
): Promise<void> {
  try {
    const quarantineDir = resolve(storageDir, QUARANTINE_DIR, sessionId)
    await mkdir(quarantineDir, { recursive: true })
    const srcMetadata = resolve(storageDir, sessionId, METADATA_FILE)
    const raw = await readFile(srcMetadata, "utf8")
    await writeFile(resolve(quarantineDir, METADATA_FILE), raw, "utf8")
    await rm(srcMetadata, { force: true })
    const reason = error instanceof Error ? error.message : String(error)
    await writeFile(resolve(quarantineDir, "reason.txt"), reason, "utf8")
  } catch (quarantineError: unknown) {
    const msg = quarantineError instanceof Error ? quarantineError.message : String(quarantineError)
    process.stderr.write(`RLM quarantine failed for ${sessionId}: ${msg}\n`)
  }
}
