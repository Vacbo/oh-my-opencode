export function detectSchema(content: string, lines: string[]): Record<string, unknown> {
  const trimmed = content.trim()
  if (trimmed.length === 0) {
    return { kind: "empty" }
  }

  let parsedJson: unknown = null
  try {
    parsedJson = JSON.parse(trimmed) as unknown
  } catch (error) {
    if (!(error instanceof Error)) {
      parsedJson = null
    }
  }

  if (Array.isArray(parsedJson)) {
    const sample = parsedJson[0]
    return {
      kind: "json_array",
      length: parsedJson.length,
      item_kind: sample === null ? "null" : Array.isArray(sample) ? "array" : typeof sample,
    }
  }

  if (parsedJson && typeof parsedJson === "object") {
    return {
      kind: "json_object",
      top_level_keys: Object.keys(parsedJson as Record<string, unknown>).slice(0, 20),
    }
  }

  const headingCount = lines.filter((line) => /^#{1,6}\s+/.test(line)).length
  if (headingCount > 0) {
    return { kind: "markdown", heading_count: headingCount }
  }

  const commaCounts = lines.slice(0, 20).map((line) => (line.match(/,/g) ?? []).length)
  const hasCsvShape = commaCounts.length > 1 && commaCounts[0] > 0 && commaCounts.every((count) => count === commaCounts[0])
  if (hasCsvShape) {
    return { kind: "csv_like", column_count: commaCounts[0] + 1 }
  }

  if (lines.some((line) => /^\s*[^:#]+:\s*.+$/.test(line))) {
    return { kind: "key_value_text" }
  }

  return { kind: "plain_text" }
}
