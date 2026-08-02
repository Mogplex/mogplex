import assert from "node:assert/strict";
import test from "node:test";

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const NOW = Date.parse("2026-07-27T00:00:00.000Z");

async function loadProviderIconSync() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/models/provider-icon-sync");
}

function pngResponse() {
  return new Response(PNG_BYTES, {
    headers: {
      "content-length": String(PNG_BYTES.length),
      "content-type": "image/png",
    },
  });
}

const noStoredProviders = async () => ({ data: [], error: null });

function storedProvider(provider: string, updatedAt: string | null) {
  return { provider, updatedAt };
}

test("AI Gateway logo acquisition keeps provider-specific upstream aliases server-side", async () => {
  const { getAiGatewayProviderLogoUrl } = await loadProviderIconSync();

  assert.equal(
    getAiGatewayProviderLogoUrl(" Alibaba "),
    "https://7nyt0uhk7sse4zvn.public.blob.vercel-storage.com/docs-assets/static/docs/ai-gateway/logos/alibaba%20cloud.png"
  );
  assert.equal(
    getAiGatewayProviderLogoUrl("amazon"),
    "https://7nyt0uhk7sse4zvn.public.blob.vercel-storage.com/docs-assets/static/docs/ai-gateway/logos/amazon%20bedrock.png"
  );
  assert.equal(getAiGatewayProviderLogoUrl("../openai"), null);
});

test("syncProviderIcons deduplicates providers and persists validated PNGs", async () => {
  const { PROVIDER_ICON_UPLOAD_OPTIONS, syncProviderIcons } =
    await loadProviderIconSync();
  const fetchedUrls: string[] = [];
  const uploadedPaths: string[] = [];

  const result = await syncProviderIcons(
    [" OpenAI ", "openai", "amazon", "../invalid"],
    {
      listStoredProviders: noStoredProviders,
      fetchLogo: async (url) => {
        fetchedUrls.push(url);
        return pngResponse();
      },
      uploadLogo: async (path, body) => {
        uploadedPaths.push(path);
        assert.deepEqual(body, PNG_BYTES);
        return { error: null };
      },
    }
  );

  assert.deepEqual(result, {
    attempted: 2,
    skipped: 0,
    upserted: 2,
    failedProviders: [],
  });
  assert.deepEqual(uploadedPaths, ["openai.png", "amazon.png"]);
  assert.equal(fetchedUrls.length, 2);
  assert.equal(PROVIDER_ICON_UPLOAD_OPTIONS.upsert, true);
  assert.equal(PROVIDER_ICON_UPLOAD_OPTIONS.contentType, "image/png");
});

test("an upstream failure leaves the existing stored provider icon untouched", async () => {
  const { syncProviderIcons } = await loadProviderIconSync();
  let uploadCalls = 0;

  const result = await syncProviderIcons(["openai"], {
    listStoredProviders: noStoredProviders,
    fetchLogo: async () => new Response("unavailable", { status: 503 }),
    uploadLogo: async () => {
      uploadCalls += 1;
      return { error: null };
    },
  });

  assert.deepEqual(result, {
    attempted: 1,
    skipped: 0,
    upserted: 0,
    failedProviders: ["openai"],
  });
  assert.equal(uploadCalls, 0);
});

test("invalid image responses never overwrite the stored provider icon", async () => {
  const { syncProviderIcons } = await loadProviderIconSync();
  let uploadCalls = 0;

  const result = await syncProviderIcons(["openai"], {
    listStoredProviders: noStoredProviders,
    fetchLogo: async () =>
      new Response("<html>not an image</html>", {
        headers: { "content-type": "image/png" },
      }),
    uploadLogo: async () => {
      uploadCalls += 1;
      return { error: null };
    },
  });

  assert.deepEqual(result.failedProviders, ["openai"]);
  assert.equal(uploadCalls, 0);
});

test("syncProviderIcons skips fresh providers and refreshes stale logos", async () => {
  const { PROVIDER_ICON_REFRESH_INTERVAL_MS, syncProviderIcons } =
    await loadProviderIconSync();
  const fetchedUrls: string[] = [];
  const uploadedPaths: string[] = [];
  const freshUpdatedAt = new Date(
    NOW - PROVIDER_ICON_REFRESH_INTERVAL_MS + 1
  ).toISOString();
  const staleUpdatedAt = new Date(
    NOW - PROVIDER_ICON_REFRESH_INTERVAL_MS - 1
  ).toISOString();

  const result = await syncProviderIcons(["openai", "amazon", "anthropic"], {
    now: () => NOW,
    listStoredProviders: async () => ({
      data: [
        storedProvider("openai", freshUpdatedAt),
        storedProvider("amazon", staleUpdatedAt),
      ],
      error: null,
    }),
    fetchLogo: async (url) => {
      fetchedUrls.push(url);
      return pngResponse();
    },
    uploadLogo: async (path) => {
      uploadedPaths.push(path);
      return { error: null };
    },
  });

  assert.deepEqual(result, {
    attempted: 2,
    skipped: 1,
    upserted: 2,
    failedProviders: [],
  });
  assert.equal(fetchedUrls.length, 2);
  assert.deepEqual(uploadedPaths, ["amazon.png", "anthropic.png"]);
});

test("syncProviderIcons refreshes stored providers with missing timestamps", async () => {
  const { syncProviderIcons } = await loadProviderIconSync();
  const uploadedPaths: string[] = [];

  const result = await syncProviderIcons(["openai"], {
    now: () => NOW,
    listStoredProviders: async () => ({
      data: [storedProvider("openai", null)],
      error: null,
    }),
    fetchLogo: async () => pngResponse(),
    uploadLogo: async (path) => {
      uploadedPaths.push(path);
      return { error: null };
    },
  });

  assert.equal(result.attempted, 1);
  assert.equal(result.upserted, 1);
  assert.deepEqual(uploadedPaths, ["openai.png"]);
});

test("syncProviderIcons bounds acquisition concurrency", async () => {
  const { PROVIDER_ICON_SYNC_CONCURRENCY, syncProviderIcons } =
    await loadProviderIconSync();
  let activeFetches = 0;
  let maxActiveFetches = 0;
  const providers = Array.from(
    { length: 12 },
    (_, index) => `provider-${index}`
  );

  const result = await syncProviderIcons(providers, {
    listStoredProviders: noStoredProviders,
    fetchLogo: async () => {
      activeFetches += 1;
      maxActiveFetches = Math.max(maxActiveFetches, activeFetches);
      await Promise.resolve();
      activeFetches -= 1;
      return pngResponse();
    },
    uploadLogo: async () => ({ error: null }),
  });

  assert.equal(result.upserted, providers.length);
  assert.equal(maxActiveFetches, PROVIDER_ICON_SYNC_CONCURRENCY);
});

test("syncProviderIcons avoids upstream work when stored-icon discovery fails", async () => {
  const { syncProviderIcons } = await loadProviderIconSync();
  let fetchCalls = 0;

  const result = await syncProviderIcons([" OpenAI ", "../invalid"], {
    listStoredProviders: async () => ({
      data: null,
      error: { message: "storage unavailable" },
    }),
    fetchLogo: async () => {
      fetchCalls += 1;
      return pngResponse();
    },
  });

  assert.deepEqual(result, {
    attempted: 0,
    skipped: 0,
    upserted: 0,
    failedProviders: ["openai"],
  });
  assert.equal(fetchCalls, 0);
});
