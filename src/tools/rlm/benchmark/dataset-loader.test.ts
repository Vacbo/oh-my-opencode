/// <reference types="bun-types" />

import { describe, expect, it, beforeEach } from "bun:test"
import type { DatasetItem } from "./types"
import {
  loadDataset,
  listDatasets,
  DatasetItemSchema,
  clearDatasetCache,
} from "./dataset-loader"

describe("dataset-loader", () => {
  beforeEach(() => {
    clearDatasetCache()
  })

  describe("#given synthetic browsecomp dataset", () => {
    describe("#when loading in full mode", () => {
      it("#then returns all items with required fields", async () => {
        const items = await loadDataset("browsecomp", "full")
        expect(items.length).toBeGreaterThanOrEqual(10)
        for (const item of items) {
          expect(item.id).toBeTypeOf("string")
          expect(item.query).toBeTypeOf("string")
          expect(item.context).toBeTypeOf("string")
          expect(item.id.length).toBeGreaterThan(0)
          expect(item.query.length).toBeGreaterThan(0)
          expect(item.context.length).toBeGreaterThan(0)
        }
      })

      it("#then includes expected_answer for all items", async () => {
        const items = await loadDataset("browsecomp", "full")
        for (const item of items) {
          expect(item.expected_answer).toBeTypeOf("string")
          expect(item.expected_answer!.length).toBeGreaterThan(0)
        }
      })

      it("#then includes web navigation metadata", async () => {
        const items = await loadDataset("browsecomp", "full")
        for (const item of items) {
          expect(item.metadata).toBeDefined()
          expect(item.metadata!.category).toBeTypeOf("string")
        }
      })
    })

    describe("#when loading in smoke mode", () => {
      it("#then returns a small subset", async () => {
        const items = await loadDataset("browsecomp", "smoke")
        expect(items.length).toBeGreaterThanOrEqual(3)
        expect(items.length).toBeLessThanOrEqual(5)
      })

      it("#then smoke items are a subset of full items", async () => {
        const smoke = await loadDataset("browsecomp", "smoke")
        const full = await loadDataset("browsecomp", "full")
        const fullIds = new Set(full.map((i) => i.id))
        for (const item of smoke) {
          expect(fullIds.has(item.id)).toBe(true)
        }
      })
    })
  })

  describe("#given synthetic oolong dataset", () => {
    describe("#when loading in full mode", () => {
      it("#then returns all items with required fields", async () => {
        const items = await loadDataset("oolong", "full")
        expect(items.length).toBeGreaterThanOrEqual(10)
        for (const item of items) {
          expect(item.id).toBeTypeOf("string")
          expect(item.query).toBeTypeOf("string")
          expect(item.context).toBeTypeOf("string")
        }
      })

      it("#then includes long-context reasoning metadata", async () => {
        const items = await loadDataset("oolong", "full")
        for (const item of items) {
          expect(item.metadata).toBeDefined()
          expect(item.metadata!.category).toBeTypeOf("string")
        }
      })

      it("#then context is substantially longer than query", async () => {
        const items = await loadDataset("oolong", "full")
        for (const item of items) {
          expect(item.context.length).toBeGreaterThan(item.query.length)
        }
      })
    })

    describe("#when loading in smoke mode", () => {
      it("#then returns a small subset", async () => {
        const items = await loadDataset("oolong", "smoke")
        expect(items.length).toBeGreaterThanOrEqual(3)
        expect(items.length).toBeLessThanOrEqual(5)
      })
    })
  })

  describe("#given dataset validation", () => {
    it("#then DatasetItemSchema validates a correct item", () => {
      const valid: DatasetItem = {
        id: "test-1",
        query: "What is X?",
        context: "X is a thing.",
        expected_answer: "A thing",
        metadata: { category: "test" },
      }
      const result = DatasetItemSchema.safeParse(valid)
      expect(result.success).toBe(true)
    })

    it("#then DatasetItemSchema rejects item missing id", () => {
      const result = DatasetItemSchema.safeParse({
        query: "Q",
        context: "C",
      })
      expect(result.success).toBe(false)
    })

    it("#then DatasetItemSchema rejects item with empty query", () => {
      const result = DatasetItemSchema.safeParse({
        id: "x",
        query: "",
        context: "C",
      })
      expect(result.success).toBe(false)
    })
  })

  describe("#given dataset listing", () => {
    it("#then listDatasets returns available dataset names", () => {
      const names = listDatasets()
      expect(names).toContain("browsecomp")
      expect(names).toContain("oolong")
      expect(names.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe("#given unknown dataset", () => {
    it("#then loadDataset throws for unknown name", async () => {
      await expect(loadDataset("nonexistent", "full")).rejects.toThrow(
        /unknown dataset/i,
      )
    })
  })

  describe("#given dataset caching", () => {
    it("#then returns same reference on repeated load", async () => {
      const first = await loadDataset("browsecomp", "full")
      const second = await loadDataset("browsecomp", "full")
      expect(first).toBe(second)
    })

    it("#then smoke and full are cached independently", async () => {
      const smoke = await loadDataset("browsecomp", "smoke")
      const full = await loadDataset("browsecomp", "full")
      expect(smoke).not.toBe(full)
      expect(smoke.length).toBeLessThan(full.length)
    })

    it("#then clearDatasetCache resets cache", async () => {
      const first = await loadDataset("browsecomp", "full")
      clearDatasetCache()
      const second = await loadDataset("browsecomp", "full")
      expect(first).not.toBe(second)
      expect(first).toEqual(second)
    })
  })

  describe("#given unique ids", () => {
    it("#then browsecomp items have unique ids", async () => {
      const items = await loadDataset("browsecomp", "full")
      const ids = items.map((i) => i.id)
      expect(new Set(ids).size).toBe(ids.length)
    })

    it("#then oolong items have unique ids", async () => {
      const items = await loadDataset("oolong", "full")
      const ids = items.map((i) => i.id)
      expect(new Set(ids).size).toBe(ids.length)
    })
  })
})
