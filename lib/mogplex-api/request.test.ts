import { describe, expect, it } from "vitest";
import {
  MOGPLEX_API_IDEMPOTENCY_KEY_HEADER,
  requireMogplexApiIdempotencyKey,
} from "./request";

function headersWithKey(value?: string) {
  return new Headers(
    value === undefined ? {} : { [MOGPLEX_API_IDEMPOTENCY_KEY_HEADER]: value }
  );
}

async function errorMessage(headers: Headers) {
  const result = requireMogplexApiIdempotencyKey(headers);
  if (result.ok) throw new Error("expected a refusal");
  expect(result.response.status).toBe(400);
  const body = await result.response.json();
  expect(body.error.code).toBe("BAD_REQUEST");
  return body.error.message as string;
}

describe("requireMogplexApiIdempotencyKey", () => {
  it("should return the trimmed key when one is sent", () => {
    expect(requireMogplexApiIdempotencyKey(headersWithKey(" run-1 "))).toEqual({
      ok: true,
      value: "run-1",
    });
  });

  it("should refuse a missing or blank key as required", async () => {
    expect(await errorMessage(headersWithKey())).toBe(
      "Idempotency-Key is required"
    );
    expect(await errorMessage(headersWithKey("   "))).toBe(
      "Idempotency-Key is required"
    );
  });

  it("should refuse a key over the length limit with the limit in the message", async () => {
    expect(await errorMessage(headersWithKey("x".repeat(201)))).toBe(
      "Idempotency-Key exceeds maximum length of 200 characters"
    );
  });
});
