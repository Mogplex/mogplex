import assert from "node:assert/strict";
import test from "node:test";

async function withFetch(
  fetcher: typeof globalThis.fetch,
  run: () => Promise<void>
) {
  const previousDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "fetch"
  );
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: fetcher,
  });

  try {
    await run();
  } finally {
    if (previousDescriptor) {
      Object.defineProperty(globalThis, "fetch", previousDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "fetch");
    }
  }
}

test("fetchJsonObject preserves HTTP status and response error text", async () => {
  const { ClientFetchError, fetchJsonObject } =
    await import("../../lib/client-fetch");

  await withFetch(
    async () =>
      new Response(JSON.stringify({ error: "storage unavailable" }), {
        headers: { "content-type": "application/json" },
        status: 503,
      }),
    async () => {
      await assert.rejects(
        () => fetchJsonObject("/manifest", "manifest fallback"),
        (error: unknown) => {
          assert.ok(error instanceof ClientFetchError);
          assert.equal(error.message, "storage unavailable");
          assert.equal(error.status, 503);
          assert.equal(error.reason, "http");
          return true;
        }
      );
    }
  );
});

test("fetchJsonObject tags an invalid successful payload", async () => {
  const { ClientFetchError, fetchJsonObject } =
    await import("../../lib/client-fetch");

  await withFetch(
    async () =>
      new Response(JSON.stringify([]), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    async () => {
      await assert.rejects(
        () => fetchJsonObject("/manifest"),
        (error: unknown) => {
          assert.ok(error instanceof ClientFetchError);
          assert.equal(error.status, null);
          assert.equal(error.reason, "invalid_response");
          return true;
        }
      );
    }
  );
});

test("fetchJsonObject keeps status when an error body is not JSON", async () => {
  const { ClientFetchError, fetchJsonObject } =
    await import("../../lib/client-fetch");

  await withFetch(
    async () =>
      new Response("temporarily unavailable", {
        headers: { "content-type": "text/plain" },
        status: 502,
      }),
    async () => {
      await assert.rejects(
        () => fetchJsonObject("/manifest", "manifest fallback"),
        (error: unknown) => {
          assert.ok(error instanceof ClientFetchError);
          assert.equal(error.message, "manifest fallback");
          assert.equal(error.status, 502);
          assert.equal(error.reason, "http");
          return true;
        }
      );
    }
  );
});
