import { describe, expect, it } from "vitest";
import {
  allowsCliBearerApiPath,
  allowsCliPatApiPath,
  isPublicRoutePath,
  isUnscopedAuthedRoutePath,
} from "./auth-route-policy";
import { isMogplexBearerApiRequest } from "./internal-api-auth";

describe("authenticated root route policy", () => {
  it("keeps checkout authenticated and outside workspace scope resolution", () => {
    expect(isPublicRoutePath("/checkout")).toBe(false);
    expect(isUnscopedAuthedRoutePath("/checkout")).toBe(true);
    expect(isUnscopedAuthedRoutePath("/checkout/complete")).toBe(true);
    expect(isUnscopedAuthedRoutePath("/checkout-old")).toBe(false);
  });
});

describe("hosted CLI bearer route policy", () => {
  it("allows only declared CLI API paths", () => {
    expect(allowsCliBearerApiPath("/api/settings")).toBe(true);
    expect(allowsCliBearerApiPath("/api/models")).toBe(true);
    expect(allowsCliBearerApiPath("/api/mcp-servers")).toBe(true);
    expect(allowsCliBearerApiPath("/api/sandbox/session-1")).toBe(true);
    expect(allowsCliBearerApiPath("/api/cli/inference/chat/completions")).toBe(
      true
    );
    expect(allowsCliBearerApiPath("/api/skills/registry")).toBe(false);
  });

  it("keeps the PAT compatibility policy aligned", () => {
    expect(allowsCliPatApiPath("/api/settings")).toBe(true);
    expect(allowsCliPatApiPath("/api/skills/registry")).toBe(false);
  });

  it("delegates bearer validation only on hosted CLI routes", () => {
    const bearerRequest = new Request("https://mogplex.com/api/settings", {
      headers: { authorization: "Bearer oauth-token" },
    });

    expect(isMogplexBearerApiRequest(bearerRequest, "/api/settings")).toBe(
      true
    );
    expect(
      isMogplexBearerApiRequest(bearerRequest, "/api/skills/registry")
    ).toBe(false);
    expect(
      isMogplexBearerApiRequest(
        new Request("https://mogplex.com/api/settings"),
        "/api/settings"
      )
    ).toBe(false);
  });
});
