import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

const ORIGINAL_ENV = { ...process.env };

async function importPostHogModule(): Promise<typeof import("./posthog")> {
  return import(`./posthog?test=${Date.now()}-${Math.random()}`);
}

describe("posthog client creation", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.OMO_SEND_ANONYMOUS_TELEMETRY;
    delete process.env.OMO_DISABLE_POSTHOG;
    delete process.env.POSTHOG_API_KEY;
    delete process.env.POSTHOG_HOST;
  });

  afterEach(() => {
    mock.restore();
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

  it("returns a no-op client when PostHog construction throws", async () => {
    // given
    process.env.OMO_DISABLE_POSTHOG = "0";
    process.env.OMO_SEND_ANONYMOUS_TELEMETRY = "1";
    process.env.POSTHOG_API_KEY = "test-api-key";

    mock.module("posthog-node", () => ({
      PostHog: class {
        constructor() {
          throw new Error("posthog init failed");
        }
      },
    }));

    const { createCliPostHog, createPluginPostHog } =
      await importPostHogModule();

    // when
    const cliPostHog = createCliPostHog();
    const pluginPostHog = createPluginPostHog();

    // then
    expect(() =>
      cliPostHog.capture({
        distinctId: "cli",
        event: "run_started",
      }),
    ).not.toThrow();
    expect(() =>
      cliPostHog.captureException(new Error("cli failure"), "cli"),
    ).not.toThrow();
    expect(() => cliPostHog.trackActive("cli", "run_started")).not.toThrow();
    await expect(cliPostHog.shutdown()).resolves.toBeUndefined();

    expect(() =>
      pluginPostHog.capture({
        distinctId: "plugin",
        event: "plugin_loaded",
      }),
    ).not.toThrow();
    expect(() =>
      pluginPostHog.captureException(new Error("plugin failure"), "plugin"),
    ).not.toThrow();
    expect(() =>
      pluginPostHog.trackActive("plugin", "plugin_loaded"),
    ).not.toThrow();
    await expect(pluginPostHog.shutdown()).resolves.toBeUndefined();
  });
});
