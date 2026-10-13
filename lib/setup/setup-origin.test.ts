import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSetupOrigin } from "./setup-origin";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveSetupOrigin", () => {
  it("should prefer the configured app URL", () => {
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://mogplex.acme.dev/");

    expect(resolveSetupOrigin(new Headers({ host: "internal:3000" }))).toBe(
      "https://mogplex.acme.dev"
    );
  });

  it("should fall back to the forwarded host outside production", () => {
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("VERCEL_URL", "");
    vi.stubEnv("NODE_ENV", "development");

    expect(
      resolveSetupOrigin(
        new Headers({
          "x-forwarded-host": "localhost:3000",
          "x-forwarded-proto": "http",
        })
      )
    ).toBe("http://localhost:3000");
  });

  it("should return null in production without a configured URL", () => {
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("VERCEL_URL", "");
    vi.stubEnv("NODE_ENV", "production");

    expect(
      resolveSetupOrigin(new Headers({ host: "evil.example" }))
    ).toBeNull();
  });
});
