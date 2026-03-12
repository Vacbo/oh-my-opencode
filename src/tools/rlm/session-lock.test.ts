/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test"
import { SessionLock } from "./session-lock"

describe("SessionLock", () => {
  describe("#given two acquires for the same session", () => {
    it("#then waits to hand off the release until the first finishes", async () => {
      const lock = new SessionLock()
      const releaseFirst = await lock.acquire("same-session")

      let acquiredSecond = false
      const secondAcquire = lock.acquire("same-session").then((release) => {
        acquiredSecond = true
        return release
      })

      await Bun.sleep(0)
      expect(acquiredSecond).toBe(false)

      releaseFirst()

      const releaseSecond = await secondAcquire
      expect(acquiredSecond).toBe(true)
      releaseSecond()
    })
  })

  describe("#given acquires for different sessions", () => {
    it("#then allows them to proceed in parallel", async () => {
      const lock = new SessionLock()
      const releaseFirst = await lock.acquire("session-a")

      let acquiredSecond = false
      const secondAcquire = lock.acquire("session-b").then((release) => {
        acquiredSecond = true
        return release
      })

      const releaseSecond = await secondAcquire
      expect(acquiredSecond).toBe(true)

      releaseSecond()
      releaseFirst()
    })
  })
})
