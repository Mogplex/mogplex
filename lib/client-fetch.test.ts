import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientFetchError, mutateJson } from "./client-fetch";

afterEach(() => vi.unstubAllGlobals());

describe("mutateJson", () => {
  it("returns the saved JSON", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ id: "saved" }));
    await expect(mutateJson("/api/rules", { method: "PUT" })).resolves.toEqual({
      id: "saved",
    });
  });

  it("throws the server message and status on failed writes", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({ error: "  Rule access denied  " }, { status: 403 })
    );
    await expect(
      mutateJson("/api/rules", { method: "PUT" })
    ).rejects.toMatchObject({
      name: "ClientFetchError",
      message: "Rule access denied",
      status: 403,
    });
  });

  it.each(["Service unavailable", '{"error":42}', '{"error":" "}'])(
    "uses a useful fallback for an invalid error body: %s",
    async (body) => {
      vi.stubGlobal("fetch", async () => new Response(body, { status: 500 }));
      await expect(
        mutateJson("/api/rules", { method: "POST" })
      ).rejects.toThrow("Action failed");
    }
  );

  it("does not report success when the response is not JSON", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>Sign in</html>"));
    await expect(
      mutateJson("/api/rules", { method: "PUT" })
    ).rejects.toMatchObject({
      reason: "invalid_response",
      message: "Cannot read server response",
    });
  });

  it("accepts successful writes with no response content", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 204 }));
    await expect(
      mutateJson("/api/rules", { method: "DELETE" })
    ).resolves.toBeNull();
  });

  it("propagates a network failure", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Network unavailable");
    });
    await expect(mutateJson("/api/rules", { method: "PUT" })).rejects.toThrow(
      "Network unavailable"
    );
    expect(new ClientFetchError("Failed", 500)).toBeInstanceOf(Error);
  });
});
