import { isAbsolute, relative, resolve } from "node:path"

const SAFE_SEGMENT_REGEX = /^[A-Za-z0-9._-]+$/

export function assertSafeSegment(value: string, label: string): void {
  if (!SAFE_SEGMENT_REGEX.test(value) || value === "." || value === ".." || value.includes("..")) {
    throw new Error(`${label} contains invalid characters`)
  }
}

function assertPathWithin(baseDir: string, targetPath: string): void {
  const relPath = relative(baseDir, targetPath)
  if (relPath === "") {
    return
  }
  if (relPath.startsWith("..") || isAbsolute(relPath)) {
    throw new Error("Path traversal detected")
  }
}

export function resolveSessionDir(contextDir: string, sessionId: string): string {
  assertSafeSegment(sessionId, "Session ID")
  const baseDir = resolve(contextDir)
  const sessionDir = resolve(baseDir, sessionId)
  assertPathWithin(baseDir, sessionDir)
  return sessionDir
}

export function resolveSessionFilePath(contextDir: string, sessionId: string, fileName: string): string {
  assertSafeSegment(fileName, "Variable file name")
  const sessionDir = resolveSessionDir(contextDir, sessionId)
  const filePath = resolve(sessionDir, fileName)
  assertPathWithin(sessionDir, filePath)
  return filePath
}
