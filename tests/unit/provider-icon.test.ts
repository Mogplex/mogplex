import assert from "node:assert/strict";
import test from "node:test";
import {
  getProviderIconPath,
  getProviderFromIconPath,
  getProviderIconUrl,
  getProviderInitial,
  normalizeProviderIconProviders,
} from "../../lib/models/provider-icon";

test("getProviderIconUrl resolves provider slugs against persistent Supabase storage", () => {
  const previousPublicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co/";
  try {
    assert.equal(
      getProviderIconUrl(" OpenAI "),
      "https://example.supabase.co/storage/v1/object/public/provider-icons/openai.png"
    );
  } finally {
    if (previousPublicUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = previousPublicUrl;
    }
  }
});

test("provider icon paths reject values that are unsafe as storage object names", () => {
  assert.equal(getProviderIconPath("arcee-ai"), "arcee-ai.png");
  assert.equal(getProviderIconPath("../openai"), null);
  assert.equal(getProviderIconPath("provider/name"), null);
  assert.equal(getProviderIconPath("provider name"), null);
  assert.equal(getProviderIconPath("---"), null);
});

test("stored icon paths only resolve valid provider PNGs", () => {
  assert.equal(getProviderFromIconPath("openai.png"), "openai");
  assert.equal(getProviderFromIconPath("nested/openai.png"), null);
  assert.equal(getProviderFromIconPath("../openai.png"), null);
  assert.equal(getProviderFromIconPath("openai.svg"), null);
});

test("provider icon candidates are normalized, filtered, and deduplicated", () => {
  assert.deepEqual(
    normalizeProviderIconProviders([
      " OpenAI ",
      "openai",
      "arcee-ai",
      "../invalid",
    ]),
    ["openai", "arcee-ai"]
  );
});

test("getProviderIconUrl ignores server-only Supabase configuration", () => {
  const previousPublicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousServerUrl = process.env.SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.SUPABASE_URL = "https://server-only.supabase.co";

  try {
    assert.equal(getProviderIconUrl("openai"), null);
  } finally {
    if (previousPublicUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = previousPublicUrl;
    }
    if (previousServerUrl === undefined) {
      delete process.env.SUPABASE_URL;
    } else {
      process.env.SUPABASE_URL = previousServerUrl;
    }
  }
});

test("getProviderInitial matches the AI Gateway catalog fallback for providers without logos", () => {
  assert.equal(getProviderInitial("tencent"), "T");
  assert.equal(getProviderInitial("  inclusionai"), "I");
  assert.equal(getProviderInitial(" 模型"), "模");
  assert.equal(getProviderInitial("---"), "?");
});
