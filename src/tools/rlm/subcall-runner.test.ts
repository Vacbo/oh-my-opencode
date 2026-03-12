import { describe, it, expect, vi, beforeEach } from "bun:test"
import { calculateNextInterval, type BackoffConfig } from "./subcall-runner"

describe("calculateNextInterval", () => {
  const defaultConfig: BackoffConfig = {
    initial_interval_ms: 400,
    backoff_multiplier: 1.5,
    jitter_percent: 15,
    max_interval_ms: 5000,
  }

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("should start at initial_interval_ms on first call (current=0)", () => {
    // Mock Math.random to return 0.5 (middle of range, no jitter effect)
    vi.spyOn(Math, "random").mockReturnValue(0.5)

    const result = calculateNextInterval(0, defaultConfig)
    // With random() = 0.5, jitter is 0 (jitter_percent * (random - 0.5) = 15 * 0 = 0)
    expect(result).toBe(400)
  })

  it("should multiply by backoff_multiplier on subsequent calls", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5)

    // Second poll: 400 * 1.5 = 600
    const second = calculateNextInterval(400, defaultConfig)
    expect(second).toBe(600)

    // Third poll: 600 * 1.5 = 900
    const third = calculateNextInterval(600, defaultConfig)
    expect(third).toBe(900)

    // Fourth poll: 900 * 1.5 = 1350
    const fourth = calculateNextInterval(900, defaultConfig)
    expect(fourth).toBe(1350)

    // Fifth poll: 1350 * 1.5 = 2025
    const fifth = calculateNextInterval(1350, defaultConfig)
    expect(fifth).toBe(2025)
  })

  it("should apply positive jitter when Math.random() > 0.5", () => {
    // Mock random to return 1.0 (max jitter: +15%)
    vi.spyOn(Math, "random").mockReturnValue(1.0)

    const result = calculateNextInterval(400, defaultConfig)
    // 400 * 1.5 = 600, then +15% = 690
    expect(result).toBe(690)
  })

  it("should apply negative jitter when Math.random() < 0.5", () => {
    // Mock random to return 0.0 (min jitter: -15%)
    vi.spyOn(Math, "random").mockReturnValue(0.0)

    const result = calculateNextInterval(400, defaultConfig)
    // 400 * 1.5 = 600, then -15% = 510
    expect(result).toBe(510)
  })

  it("should cap at max_interval_ms", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5)

    // Start with a value that would exceed max after backoff
    const result = calculateNextInterval(4000, defaultConfig)
    // 4000 * 1.5 = 6000, capped at 5000
    expect(result).toBe(5000)
  })

  it("should cap at max_interval_ms even with positive jitter", () => {
    vi.spyOn(Math, "random").mockReturnValue(1.0)

    // 3500 * 1.5 = 5250, +15% = 6037.5, capped at 5000
    const result = calculateNextInterval(3500, defaultConfig)
    expect(result).toBe(5000)
  })

  it("should use custom config values", () => {
    const customConfig: BackoffConfig = {
      initial_interval_ms: 100,
      backoff_multiplier: 2.0,
      jitter_percent: 10,
      max_interval_ms: 1000,
    }

    vi.spyOn(Math, "random").mockReturnValue(0.5)

    // First call: starts at initial_interval_ms
    const first = calculateNextInterval(0, customConfig)
    expect(first).toBe(100)

    // Second call: 100 * 2.0 = 200
    const second = calculateNextInterval(100, customConfig)
    expect(second).toBe(200)

    // Third call: 200 * 2.0 = 400
    const third = calculateNextInterval(200, customConfig)
    expect(third).toBe(400)

    // Fourth call: 400 * 2.0 = 800
    const fourth = calculateNextInterval(400, customConfig)
    expect(fourth).toBe(800)

    // Fifth call: 800 * 2.0 = 1600, capped at 1000
    const fifth = calculateNextInterval(800, customConfig)
    expect(fifth).toBe(1000)
  })

  it("should produce expected sequence for 5 polls with no jitter", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5)

    // Expected sequence: ~400, ~600, ~900, ~1350, ~2025
    const intervals: number[] = []
    let current = 0

    for (let i = 0; i < 5; i++) {
      current = calculateNextInterval(current, defaultConfig)
      intervals.push(current)
    }

    expect(intervals).toEqual([400, 600, 900, 1350, 2025])
  })

  it("should handle edge case when current equals max_interval_ms", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5)

    // If already at max, should stay at max
    const result = calculateNextInterval(5000, defaultConfig)
    expect(result).toBe(5000)
  })

  it("should handle edge case when current exceeds max_interval_ms", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5)

    // If already exceeds max, should stay at max
    const result = calculateNextInterval(6000, defaultConfig)
    expect(result).toBe(5000)
  })
})