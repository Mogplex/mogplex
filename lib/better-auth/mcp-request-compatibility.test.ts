import { describe, expect, it } from "vitest";
import {
  legacyMcpMetadata,
  rewriteLegacyMcpRequest,
} from "./mcp-request-compatibility";

const resource = "https://mogplex.com/api/v1/mogplex/mcp";
const base = "https://mogplex.com/api/auth/mcp/";

describe("cached MCP OAuth endpoints", () => {
  it("retains PKCE and state while providing an explicit default audience and scope", async () => {
    const request = new Request(
      `${base}authorize?client_id=existing&state=opaque%2Bstate&code_challenge=challenge&code_challenge_method=S256`
    );
    const url = new URL((await rewriteLegacyMcpRequest(request, resource)).url);
    expect(url.pathname).toBe("/api/auth/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "existing",
      state: "opaque+state",
      code_challenge: "challenge",
      code_challenge_method: "S256",
      resource,
      scope: "read write",
    });
  });

  it("preserves explicit repeated resources instead of silently widening a grant", async () => {
    const request = new Request(
      `${base}authorize?scope=read&resource=https%3A%2F%2Fone.example&resource=https%3A%2F%2Ftwo.example`
    );
    const url = new URL((await rewriteLegacyMcpRequest(request, resource)).url);
    expect(url.searchParams.getAll("resource")).toEqual([
      "https://one.example",
      "https://two.example",
    ]);
    expect(url.searchParams.get("scope")).toBe("read");
  });

  for (const json of [false, true]) {
    it(`forwards ${json ? "JSON" : "form"} refresh exchanges without changing credentials`, async () => {
      const body = {
        grant_type: "refresh_token",
        refresh_token: "old+refresh/token",
        client_id: "existing",
      };
      const request = new Request(`${base}token`, {
        method: "POST",
        headers: {
          "content-type": json
            ? "application/json"
            : "application/x-www-form-urlencoded",
          authorization: "Basic encoded-client-credentials",
          "content-length": "123",
        },
        body: json ? JSON.stringify(body) : new URLSearchParams(body),
      });
      const forwarded = await rewriteLegacyMcpRequest(request, resource);
      expect(new URL(forwarded.url).pathname).toBe("/api/auth/oauth2/token");
      expect(forwarded.method).toBe("POST");
      expect(forwarded.headers.get("authorization")).toBe(
        "Basic encoded-client-credentials"
      );
      expect(forwarded.headers.get("content-length")).toBeNull();
      expect(
        Object.fromEntries(new URLSearchParams(await forwarded.text()))
      ).toEqual({ ...body, resource });
    });
  }

  it("leaves malformed payloads for the native provider to reject", async () => {
    for (const body of [
      "{invalid",
      JSON.stringify({ client_id: ["one", "two"] }),
    ]) {
      const request = new Request(`${base}token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      expect(
        await (await rewriteLegacyMcpRequest(request, resource)).text()
      ).toBe(body);
    }
    const untouched = new Request(`${base}get-session`);
    expect(await rewriteLegacyMcpRequest(untouched, resource)).toBe(untouched);
  });

  it("retains cached discovery URLs and issuer while preserving supported native capabilities", () => {
    expect(
      legacyMcpMetadata({
        issuer: "https://mogplex.com",
        token_endpoint: "https://mogplex.com/api/auth/oauth2/token",
        jwks_uri: "https://mogplex.com/api/auth/jwks",
        code_challenge_methods_supported: ["S256"],
      })
    ).toEqual({
      issuer: "https://mogplex.com",
      token_endpoint: `${base}token`,
      jwks_uri: `${base}jwks`,
      code_challenge_methods_supported: ["S256"],
    });
  });
});
