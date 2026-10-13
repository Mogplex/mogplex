import { describe, expect, it } from "vitest";

import {
  isOpenAiCompatibleModelId,
  openAiCompatibleCatalogRows,
  readOpenAiCompatibleConfig,
  withOpenAiCompatibleModels,
} from "./openai-compatible-config";

function env(values: Record<string, string>) {
  return values as unknown as NodeJS.ProcessEnv;
}

const configured = env({
  MOGPLEX_OPENAI_COMPATIBLE_BASE_URL: " https://litellm.example/v1 ",
  MOGPLEX_OPENAI_COMPATIBLE_API_KEY: " sk-local ",
  MOGPLEX_OPENAI_COMPATIBLE_MODELS:
    "llama3.1:8b=Llama 3.1 8B, qwen2.5-coder ,, llama3.1:8b=Duplicate",
});

describe("readOpenAiCompatibleConfig", () => {
  it("should parse the base URL, key, and models with optional labels", () => {
    expect(readOpenAiCompatibleConfig(configured)).toEqual({
      baseURL: "https://litellm.example/v1",
      apiKey: "sk-local",
      models: [
        {
          id: "openai-compatible/llama3.1:8b",
          upstreamId: "llama3.1:8b",
          name: "Llama 3.1 8B",
        },
        {
          id: "openai-compatible/qwen2.5-coder",
          upstreamId: "qwen2.5-coder",
          name: "qwen2.5-coder",
        },
      ],
    });
  });

  it("should return null when the base URL is unset or not an http(s) URL", () => {
    expect(readOpenAiCompatibleConfig(env({}))).toBeNull();
    expect(
      readOpenAiCompatibleConfig(
        env({ MOGPLEX_OPENAI_COMPATIBLE_BASE_URL: "litellm:4000" })
      )
    ).toBeNull();
    expect(
      readOpenAiCompatibleConfig(
        env({ MOGPLEX_OPENAI_COMPATIBLE_BASE_URL: "file:///etc/passwd" })
      )
    ).toBeNull();
  });

  it("should accept a plain http endpoint on a private network", () => {
    expect(
      readOpenAiCompatibleConfig(
        // eslint-disable-next-line sonarjs/no-clear-text-protocols -- in-cluster endpoint fixture
        env({ MOGPLEX_OPENAI_COMPATIBLE_BASE_URL: "http://ollama:11434/v1" })
      )?.baseURL
      // eslint-disable-next-line sonarjs/no-clear-text-protocols -- in-cluster endpoint fixture
    ).toBe("http://ollama:11434/v1");
  });

  it("should treat a blank key as no key", () => {
    expect(
      readOpenAiCompatibleConfig(
        env({
          MOGPLEX_OPENAI_COMPATIBLE_BASE_URL: "https://ollama.example/v1",
          MOGPLEX_OPENAI_COMPATIBLE_API_KEY: "  ",
        })
      )?.apiKey
    ).toBeNull();
  });
});

describe("withOpenAiCompatibleModels", () => {
  it("should append configured models as available, visible catalog rows", () => {
    const rows = withOpenAiCompatibleModels(
      [{ id: "openai/gpt-5", name: "GPT-5" }],
      (row) => ({ id: row.id, name: row.name }),
      configured
    );

    expect(rows).toEqual([
      { id: "openai/gpt-5", name: "GPT-5" },
      { id: "openai-compatible/llama3.1:8b", name: "Llama 3.1 8B" },
      { id: "openai-compatible/qwen2.5-coder", name: "qwen2.5-coder" },
    ]);
    expect(openAiCompatibleCatalogRows(configured)[0]).toMatchObject({
      provider: "openai-compatible",
      is_available: true,
      is_hidden: false,
      created_at: null,
    });
  });

  it("should keep a database row that already uses the same id", () => {
    const rows = withOpenAiCompatibleModels(
      [{ id: "openai-compatible/qwen2.5-coder", name: "From DB" }],
      (row) => ({ id: row.id, name: row.name }),
      configured
    );

    expect(rows.map((row) => row.name)).toEqual(["From DB", "Llama 3.1 8B"]);
  });

  it("should leave the catalog unchanged when no endpoint is configured", () => {
    expect(withOpenAiCompatibleModels(null, (row) => row, env({}))).toEqual([]);
  });
});

describe("isOpenAiCompatibleModelId", () => {
  it("should match only the openai-compatible provider prefix", () => {
    expect(isOpenAiCompatibleModelId("openai-compatible/llama3")).toBe(true);
    expect(isOpenAiCompatibleModelId("openai/gpt-5")).toBe(false);
  });
});
