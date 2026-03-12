import { z } from "zod"
import type { DatasetItem } from "./types"
import { BROWSECOMP_ITEMS, OOLONG_ITEMS, SMOKE_SUBSET_SIZE } from "./synthetic-datasets"

export const DatasetItemSchema = z.object({
  id: z.string().min(1),
  query: z.string().min(1),
  context: z.string().min(1),
  expected_answer: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const DatasetArraySchema = z.array(DatasetItemSchema)

type DatasetMode = "smoke" | "full"

const SYNTHETIC_DATASETS: Record<string, DatasetItem[]> = {
  browsecomp: BROWSECOMP_ITEMS,
  oolong: OOLONG_ITEMS,
}

const cache = new Map<string, DatasetItem[]>()

function cacheKey(name: string, mode: DatasetMode): string {
  return `${name}:${mode}`
}

function validateItems(items: unknown[]): DatasetItem[] {
  const parsed = DatasetArraySchema.parse(items)
  return parsed
}

function applyMode(items: DatasetItem[], mode: DatasetMode): DatasetItem[] {
  if (mode === "smoke") {
    return items.slice(0, SMOKE_SUBSET_SIZE)
  }
  return items
}

export async function loadDataset(
  name: string,
  mode: DatasetMode,
): Promise<DatasetItem[]> {
  const key = cacheKey(name, mode)
  const cached = cache.get(key)
  if (cached) {
    return cached
  }

  const raw = SYNTHETIC_DATASETS[name]
  if (!raw) {
    throw new Error(`Unknown dataset: "${name}". Available: ${Object.keys(SYNTHETIC_DATASETS).join(", ")}`)
  }

  const validated = validateItems(raw)
  const result = applyMode(validated, mode)
  cache.set(key, result)
  return result
}

export function listDatasets(): string[] {
  return Object.keys(SYNTHETIC_DATASETS)
}

export function clearDatasetCache(): void {
  cache.clear()
}
