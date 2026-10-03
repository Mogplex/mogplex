import { describe, expect, it } from "vitest";
import { parseJsonBody } from "./parse-json-body";

describe("parseJsonBody", () => {
  it("returns the parsed body without changing valid JSON", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      body: '{"enabled":false,"items":[1,null]}',
    });
    expect(await parseJsonBody<unknown>(request)).toEqual({
      ok: true,
      body: { enabled: false, items: [1, null] },
    });
  });

  it.each(["{", "", "   "])(
    "returns a 400 for invalid JSON %j",
    async (body) => {
      const result = await parseJsonBody<unknown>(
        new Request("http://localhost", { method: "POST", body })
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(400);
        expect(result.response.headers.get("content-type")).toContain(
          "application/json"
        );
        expect(await result.response.json()).toEqual({
          error: "Invalid JSON body.",
        });
      }
    }
  );

  it("returns a safe 400 when the request body cannot be read", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      body: "{}",
    });
    await request.text();
    const result = await parseJsonBody<unknown>(request);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      expect(await result.response.json()).toEqual({
        error: "Invalid JSON body.",
      });
    }
  });
});
