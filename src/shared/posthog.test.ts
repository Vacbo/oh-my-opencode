import { afterEach, beforeEach, describe, expect, it } from "bun:test";

const ORIGINAL_ENV = { ...process.env };

async function importPostHogModule(): Promise<typeof import("./posthog")> {
  return import(`./posthog?test=${Date.now()}-${Math.random()}`);
}

describe("posthog opt-in behavior", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.OMO_SEND_ANONYMOUS_TELEMETRY;
    delete process.env.OMO_DISABLE_POSTHOG;
    delete process.env.POSTHOG_API_KEY;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("defaults to a no-op client when telemetry is not explicitly enabled", async () => {
    const { createCliPostHog } = await importPostHogModule();

    const client = createCliPostHog();

    expect(await client.shutdown()).toBeUndefined();
  });

  it("stays disabled when telemetry is enabled but no API key is configured", async () => {
    process.env.OMO_SEND_ANONYMOUS_TELEMETRY = "true";

    const { createPluginPostHog } = await importPostHogModule();

    const client = createPluginPostHog();

    expect(await client.shutdown()).toBeUndefined();
  });
});
