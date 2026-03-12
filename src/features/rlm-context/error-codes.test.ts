type ExpectChain = {
  toBe: (expected: unknown) => void
  toEqual: (expected: unknown) => void
  toBeDefined: () => void
  toBeUndefined: () => void
  toBeInstanceOf: (expected: unknown) => void
  toContain: (expected: unknown) => void
  toHaveProperty: (key: string, value?: unknown) => void
}

type BunTestModule = {
  describe: (name: string, fn: () => void) => void
  it: (name: string, fn: () => void) => void
  expect: (value: unknown) => ExpectChain
}

const bunTestSpecifier = "bun:test"
const { describe, expect, it } = (await import(bunTestSpecifier)) as BunTestModule

const errorCodesPath = "./error-codes"
const {
  RlmErrorCode,
  RlmError,
  rlmError,
  toErrorJson,
  errorSlug,
  defaultMessage,
} = (await import(errorCodesPath)) as typeof import("./error-codes")

describe("error-codes", () => {
  describe("#given RlmErrorCode enum", () => {
    it("#then has all 25 expected codes", () => {
      const codes = Object.keys(RlmErrorCode)
      expect(codes.length).toBe(25)
    })

    it("#then SESSION_NOT_FOUND is a valid code", () => {
      expect(RlmErrorCode.SESSION_NOT_FOUND).toBe("SESSION_NOT_FOUND")
    })

    it("#then INTERNAL_ERROR is a valid code", () => {
      expect(RlmErrorCode.INTERNAL_ERROR).toBe("INTERNAL_ERROR")
    })

    it("#then all enum values are uppercase string representations", () => {
      for (const [key, value] of Object.entries(RlmErrorCode)) {
        expect(key).toBe(value)
      }
    })
  })

  describe("#given RlmError class", () => {
    it("#when constructed #then has correct properties", () => {
      const err = new RlmError(
        RlmErrorCode.SESSION_NOT_FOUND,
        "Session missing",
        { sessionID: "abc" },
      )
      expect(err).toBeInstanceOf(Error)
      expect(err).toBeInstanceOf(RlmError)
      expect(err.name).toBe("RlmError")
      expect(err.code).toBe(RlmErrorCode.SESSION_NOT_FOUND)
      expect(err.userMessage).toBe("Session missing")
      expect(err.message).toBe("Session missing")
      expect(err.context).toEqual({ sessionID: "abc" })
    })

    it("#when constructed without context #then defaults to empty object", () => {
      const err = new RlmError(RlmErrorCode.INTERNAL_ERROR, "boom")
      expect(err.context).toEqual({})
    })
  })

  describe("#given rlmError factory", () => {
    it("#when called with code only #then uses default message", () => {
      const err = rlmError(RlmErrorCode.SESSION_NOT_FOUND)
      expect(err.code).toBe(RlmErrorCode.SESSION_NOT_FOUND)
      expect(err.userMessage).toBe("RLM session not found for this chat.")
      expect(err.context).toEqual({})
    })

    it("#when called with custom message #then overrides default", () => {
      const err = rlmError(RlmErrorCode.VARIABLE_NOT_FOUND, {
        message: "custom msg",
        variable_name: "foo",
      })
      expect(err.userMessage).toBe("custom msg")
      expect(err.context).toEqual({ variable_name: "foo" })
    })

    it("#when called with context but no message #then keeps default message", () => {
      const err = rlmError(RlmErrorCode.INVALID_REF, { ref: "bad-ref" })
      expect(err.userMessage).toBe("Invalid variable reference.")
      expect(err.context).toEqual({ ref: "bad-ref" })
    })

    it("#then message key is stripped from context", () => {
      const err = rlmError(RlmErrorCode.INVALID_INPUT, { message: "nope" })
      expect(err.context).toEqual({})
    })
  })

  describe("#given toErrorJson", () => {
    it("#when called with RlmError #then produces backward-compat JSON", () => {
      const err = rlmError(RlmErrorCode.SESSION_NOT_FOUND, { sessionID: "abc" })
      const json = toErrorJson(err)
      expect(json.error).toBe("session_not_found")
      expect(json.code).toBe("SESSION_NOT_FOUND")
      expect(json.message).toBe("RLM session not found for this chat.")
      expect((json as Record<string, unknown>).sessionID).toBe("abc")
    })

    it("#when called with MANIFEST_REJECTED #then slug is manifest_not_allowed", () => {
      const err = rlmError(RlmErrorCode.MANIFEST_REJECTED)
      const json = toErrorJson(err)
      expect(json.error).toBe("manifest_not_allowed")
    })

    it("#when called with INVALID_INPUT #then slug is invalid_arguments", () => {
      const err = rlmError(RlmErrorCode.INVALID_INPUT)
      const json = toErrorJson(err)
      expect(json.error).toBe("invalid_arguments")
    })

    it("#when called with PLAN_OP_FAILED #then slug is plan_execution_error", () => {
      const err = rlmError(RlmErrorCode.PLAN_OP_FAILED)
      const json = toErrorJson(err)
      expect(json.error).toBe("plan_execution_error")
    })

    it("#when called with REGEX_ERROR #then slug is invalid_regex", () => {
      const err = rlmError(RlmErrorCode.REGEX_ERROR)
      const json = toErrorJson(err)
      expect(json.error).toBe("invalid_regex")
    })

    it("#when called with plain Error #then falls back to internal_error", () => {
      const err = new Error("something broke")
      const json = toErrorJson(err)
      expect(json.error).toBe("internal_error")
      expect(json.code).toBe("INTERNAL_ERROR")
      expect(json.message).toBe("something broke")
    })

    it("#when called with Error with empty message #then uses default", () => {
      const err = new Error("")
      const json = toErrorJson(err)
      expect(json.message).toBe("An internal error occurred.")
    })
  })

  describe("#given errorSlug helper", () => {
    it("#then maps all codes to lowercase snake_case slugs", () => {
      expect(errorSlug(RlmErrorCode.SESSION_NOT_FOUND)).toBe("session_not_found")
      expect(errorSlug(RlmErrorCode.REGEX_TIMEOUT)).toBe("regex_timeout")
      expect(errorSlug(RlmErrorCode.TOO_MANY_OPERATIONS)).toBe("too_many_operations")
    })
  })

  describe("#given defaultMessage helper", () => {
    it("#then returns human-readable message for each code", () => {
      expect(defaultMessage(RlmErrorCode.EXEC_TIMEOUT)).toBe("Execution timed out.")
      expect(defaultMessage(RlmErrorCode.DEPTH_LIMIT)).toBe("Maximum recursion depth exceeded.")
    })
  })

  describe("#given backward-compat slug mapping", () => {
    it("#then every RlmErrorCode has a slug", () => {
      for (const code of Object.values(RlmErrorCode)) {
        const slug = errorSlug(code as typeof RlmErrorCode[keyof typeof RlmErrorCode])
        expect(typeof slug).toBe("string")
        expect(slug.length > 0).toBe(true)
      }
    })
  })
})
