import { describe, expect, it } from "vitest";
import {
  exchangeGithubManifestCode,
  formatGithubAppEnvBlock,
  parseGithubManifestConversion,
  type GithubManifestApp,
} from "./github-manifest-conversion";

const PEM =
  "-----BEGIN RSA PRIVATE KEY-----\nMIIE\nabc\n-----END RSA PRIVATE KEY-----\n";

function conversionBody(overrides: Record<string, unknown> = {}) {
  return {
    id: 123,
    slug: "mogplex-acme",
    name: "Mogplex Acme",
    html_url: "https://github.com/apps/mogplex-acme",
    pem: PEM,
    webhook_secret: "whsec",
    client_id: "Iv1.abc",
    client_secret: "client-secret",
    ...overrides,
  };
}

function fakeFetch(status: number, body: unknown) {
  const calls: string[] = [];
  const impl: typeof fetch = async (input) => {
    calls.push(String(input));
    return new Response(JSON.stringify(body), { status });
  };
  return { impl, calls };
}

describe("exchangeGithubManifestCode", () => {
  it("should return the new App's credentials", async () => {
    const { impl, calls } = fakeFetch(201, conversionBody());

    const result = await exchangeGithubManifestCode("abc123", impl);

    expect(calls).toEqual([
      "https://api.github.com/app-manifests/abc123/conversions",
    ]);
    expect(result).toEqual({
      ok: true,
      app: {
        id: 123,
        slug: "mogplex-acme",
        name: "Mogplex Acme",
        htmlUrl: "https://github.com/apps/mogplex-acme",
        pem: PEM,
        webhookSecret: "whsec",
      },
    });
  });

  it("should reject a code that could change the request path without calling GitHub", async () => {
    const { impl, calls } = fakeFetch(201, conversionBody());

    const result = await exchangeGithubManifestCode("../../user", impl);

    expect(result).toEqual({ ok: false, reason: "invalid_code" });
    expect(calls).toEqual([]);
  });

  it("should report a used or expired code", async () => {
    const { impl } = fakeFetch(404, { message: "Not Found" });

    expect(await exchangeGithubManifestCode("abc", impl)).toEqual({
      ok: false,
      reason: "expired_code",
    });
  });

  it("should report GitHub failures and network errors", async () => {
    const { impl } = fakeFetch(500, {});
    const failing: typeof fetch = async () => {
      throw new Error("offline");
    };

    expect(await exchangeGithubManifestCode("abc", impl)).toEqual({
      ok: false,
      reason: "github_error",
    });
    expect(await exchangeGithubManifestCode("abc", failing)).toEqual({
      ok: false,
      reason: "github_error",
    });
  });

  it("should report a response without credentials", async () => {
    const { impl } = fakeFetch(201, conversionBody({ pem: null }));

    expect(await exchangeGithubManifestCode("abc", impl)).toEqual({
      ok: false,
      reason: "invalid_response",
    });
  });
});

describe("parseGithubManifestConversion", () => {
  it("should keep a missing webhook secret explicit", () => {
    expect(
      parseGithubManifestConversion(conversionBody({ webhook_secret: null }))
        ?.webhookSecret
    ).toBeNull();
  });

  it("should reject non-objects and invalid ids", () => {
    expect(parseGithubManifestConversion(null)).toBeNull();
    expect(
      parseGithubManifestConversion(conversionBody({ id: "123" }))
    ).toBeNull();
  });
});

describe("formatGithubAppEnvBlock", () => {
  const app: GithubManifestApp = {
    id: 123,
    slug: "mogplex-acme",
    name: "Mogplex Acme",
    htmlUrl: "https://github.com/apps/mogplex-acme",
    pem: PEM,
    webhookSecret: "whsec",
  };

  it("should write the variables lib/github-app.ts reads, with a one-line key", () => {
    const lines = formatGithubAppEnvBlock(app).split("\n");

    expect(lines).toEqual([
      "GITHUB_APP_ID=123",
      "GITHUB_APP_NAME=mogplex-acme",
      String.raw`GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIE\nabc\n-----END RSA PRIVATE KEY-----\n"`,
      'GITHUB_WEBHOOK_SECRET="whsec"',
    ]);
  });

  it("should not print the App's OAuth client secret", () => {
    expect(formatGithubAppEnvBlock(app)).not.toContain("client-secret");
  });

  it("should tell the operator to set a webhook secret when GitHub returned none", () => {
    expect(formatGithubAppEnvBlock({ ...app, webhookSecret: null })).toContain(
      "# GITHUB_WEBHOOK_SECRET"
    );
  });
});
