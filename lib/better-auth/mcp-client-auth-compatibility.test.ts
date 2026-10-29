import { describe, expect, it } from "vitest";
import { normalizeLegacyClientSecret } from "./mcp-client-auth-compatibility";

const basic = (id = "existing", secret = "secret+with:/punctuation") =>
  `Basic ${Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString("base64")}`;

describe("retained client secret transports", () => {
  it("encodes legacy form credentials for native Basic authentication", async () => {
    const form = new URLSearchParams({
      client_id: "existing",
      client_secret: "secret+with:/punctuation",
    });
    const headers = new Headers();
    await normalizeLegacyClientSecret(
      form,
      headers,
      async () => "client_secret_basic"
    );
    expect(headers.get("authorization")).toBe(basic());
    expect(form.has("client_secret")).toBe(false);
    expect(form.get("client_id")).toBe("existing");
  });

  it("decodes legacy Basic credentials for a migrated Post client", async () => {
    const form = new URLSearchParams();
    const headers = new Headers({ authorization: basic() });
    await normalizeLegacyClientSecret(
      form,
      headers,
      async () => "client_secret_post"
    );
    expect(headers.has("authorization")).toBe(false);
    expect(Object.fromEntries(form)).toEqual({
      client_id: "existing",
      client_secret: "secret+with:/punctuation",
    });
  });

  it("preserves strict method binding for new clients", async () => {
    const form = new URLSearchParams({
      client_id: "new",
      client_secret: "new-secret",
    });
    const headers = new Headers();
    await normalizeLegacyClientSecret(form, headers, async () => null);
    expect(headers.has("authorization")).toBe(false);
    expect(form.get("client_secret")).toBe("new-secret");
  });

  it("leaves repeated, mixed, malformed and mismatched credentials for native rejection", async () => {
    for (const [body, authorization] of [
      ["client_id=existing&client_id=other&client_secret=secret", ""],
      ["client_id=existing&client_secret=secret&client_secret=other", ""],
      ["client_id=existing&client_secret=secret", basic()],
      ["client_id=other", basic()],
      ["client_id=existing", "Basic @@invalid"],
      ["client_id=existing&client_assertion=assertion", basic()],
    ]) {
      const form = new URLSearchParams(body);
      const original = form.toString();
      const headers = new Headers(authorization ? { authorization } : {});
      const originalHeaders = [...headers];
      await normalizeLegacyClientSecret(
        form,
        headers,
        async () => "client_secret_post"
      );
      expect(form.toString()).toBe(original);
      expect([...headers]).toEqual(originalHeaders);
    }
  });
});
