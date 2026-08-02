import assert from "node:assert/strict";
import test from "node:test";

async function loadProviderIconStorage() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/models/provider-icon-storage");
}

test("listStoredProviderIcons paginates the entire bucket and preserves refresh metadata", async () => {
  const { listStoredProviderIcons, PROVIDER_ICON_LIST_PAGE_SIZE } =
    await loadProviderIconStorage();
  const offsets: number[] = [];
  const firstPage = [
    {
      name: "anthropic.png",
      updated_at: "2026-07-20T00:00:00.000Z",
    },
    ...Array.from({ length: PROVIDER_ICON_LIST_PAGE_SIZE - 1 }, (_, index) => ({
      name: `ignored-${index}.txt`,
      updated_at: null,
    })),
  ];

  const result = await listStoredProviderIcons({
    listFiles: async (offset, limit) => {
      offsets.push(offset);
      assert.equal(limit, PROVIDER_ICON_LIST_PAGE_SIZE);
      return {
        data:
          offset === 0
            ? firstPage
            : offset === PROVIDER_ICON_LIST_PAGE_SIZE
              ? [
                  {
                    name: "openai.png",
                    updated_at: "2026-07-21T00:00:00.000Z",
                  },
                ]
              : [],
        error: null,
      };
    },
  });

  assert.deepEqual(offsets, [
    0,
    PROVIDER_ICON_LIST_PAGE_SIZE,
    PROVIDER_ICON_LIST_PAGE_SIZE + 1,
  ]);
  assert.deepEqual(result, {
    data: [
      {
        provider: "anthropic",
        updatedAt: "2026-07-20T00:00:00.000Z",
      },
      {
        provider: "openai",
        updatedAt: "2026-07-21T00:00:00.000Z",
      },
    ],
    error: null,
  });
});

test("listStoredProviderIcons stops and surfaces a later page failure", async () => {
  const { listStoredProviderIcons, PROVIDER_ICON_LIST_PAGE_SIZE } =
    await loadProviderIconStorage();
  const firstPage = Array.from(
    { length: PROVIDER_ICON_LIST_PAGE_SIZE },
    (_, index) => ({
      name: `provider-${index}.png`,
      updated_at: null,
    })
  );

  const result = await listStoredProviderIcons({
    listFiles: async (offset) =>
      offset === 0
        ? { data: firstPage, error: null }
        : { data: null, error: { message: "storage unavailable" } },
  });

  assert.deepEqual(result, {
    data: null,
    error: { message: "storage unavailable" },
  });
});

test("listStoredProviderIcons advances by the returned page length", async () => {
  const { listStoredProviderIcons, PROVIDER_ICON_LIST_PAGE_SIZE } =
    await loadProviderIconStorage();
  const offsets: number[] = [];

  const result = await listStoredProviderIcons({
    listFiles: async (offset, limit) => {
      offsets.push(offset);
      assert.equal(limit, PROVIDER_ICON_LIST_PAGE_SIZE);
      const provider = ["anthropic", "openai"][offset];
      return {
        data: provider ? [{ name: `${provider}.png`, updated_at: null }] : [],
        error: null,
      };
    },
  });

  assert.deepEqual(offsets, [0, 1, 2]);
  assert.deepEqual(
    result.data?.map((icon) => icon.provider),
    ["anthropic", "openai"]
  );
});

test("listStoredProviderIcons fails when storage pagination stops advancing", async () => {
  const { listStoredProviderIcons } = await loadProviderIconStorage();
  let calls = 0;

  const result = await listStoredProviderIcons({
    listFiles: async () => {
      calls += 1;
      return {
        data: [{ name: "openai.png", updated_at: null }],
        error: null,
      };
    },
  });

  assert.equal(calls, 2);
  assert.deepEqual(result, {
    data: null,
    error: { message: "Provider icon pagination did not advance" },
  });
});

test("listStoredProviderIcons stops when changing overlap pages add no new files", async () => {
  const { listStoredProviderIcons } = await loadProviderIconStorage();
  const pages = [
    ["anthropic.png", "openai.png"],
    ["openai.png", "google.png"],
    ["google.png", "openai.png"],
  ];
  let calls = 0;

  const result = await listStoredProviderIcons({
    listFiles: async () => {
      const names = pages[calls] ?? [];
      calls += 1;
      return {
        data: names.map((name) => ({ name, updated_at: null })),
        error: null,
      };
    },
  });

  assert.equal(calls, 3);
  assert.deepEqual(result, {
    data: null,
    error: { message: "Provider icon pagination did not advance" },
  });
});
