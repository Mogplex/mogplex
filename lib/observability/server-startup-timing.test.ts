import { afterEach, describe, expect, it, vi } from "vitest";
import { startServerStartupTiming } from "./server-startup-timing";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("server startup timing", () => {
  it("emits separate nested startup measurements without request or credential data", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "a".repeat(40));
    vi.stubEnv("SENTRY_DSN", "https://private.example/credential");
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(125)
      .mockReturnValueOnce(150.126)
      .mockReturnValueOnce(180.129);
    const log = vi.spyOn(console, "info").mockImplementation(() => {});

    const finishImport = startServerStartupTiming("sentry_config_import");
    const finishInit = startServerStartupTiming("sentry_init");
    finishInit();
    finishImport();

    expect(log.mock.calls.map(([message]) => JSON.parse(message))).toEqual([
      {
        event: "mogplex.server_startup",
        phase: "sentry_init",
        durationMs: 25.13,
        release: "a".repeat(40),
      },
      {
        event: "mogplex.server_startup",
        phase: "sentry_config_import",
        durationMs: 80.13,
        release: "a".repeat(40),
      },
    ]);
  });

  it.each(["development", "preview", undefined])(
    "does not emit measurements or read the clock in %s",
    (environment) => {
      vi.stubEnv("VERCEL_ENV", environment);
      const clock = vi.spyOn(performance, "now");
      const log = vi.spyOn(console, "info").mockImplementation(() => {});

      startServerStartupTiming("sentry_init")();

      expect(clock).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    }
  );

  it("allows startup to finish when the log sink fails", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", undefined);
    vi.spyOn(console, "info").mockImplementation(() => {
      throw new Error("Log sink unavailable");
    });

    expect(() => startServerStartupTiming("sentry_init")()).not.toThrow();
  });
});
