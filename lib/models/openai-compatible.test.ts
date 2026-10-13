import { generateText } from "ai";
import { describe, expect, it } from "vitest";

import { resolveOpenAiCompatibleModel } from "./openai-compatible";

function env(values: Record<string, string>) {
  return values as unknown as NodeJS.ProcessEnv;
}

type CapturedRequest = {
  url: string;
  authorization: string | null;
  body: { model?: string };
};

function chatCompletionFetch(captured: CapturedRequest[]): typeof fetch {
  return async (input, init) => {
    captured.push({
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
      body: JSON.parse(String(init?.body)),
    });
    return Response.json({
      id: "chatcmpl-1",
      object: "chat.completion",
      created: 1,
      model: "llama3.1:8b",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "ok" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  };
}

describe("resolveOpenAiCompatibleModel", () => {
  it("should call the configured endpoint's chat completions API with its key", async () => {
    const captured: CapturedRequest[] = [];
    const model = resolveOpenAiCompatibleModel(
      "llama3.1:8b",
      { fetch: chatCompletionFetch(captured) },
      env({
        MOGPLEX_OPENAI_COMPATIBLE_BASE_URL: "http://litellm.test/v1",
        MOGPLEX_OPENAI_COMPATIBLE_API_KEY: "sk-local",
      })
    );

    const result = await generateText({ model, prompt: "hi" });

    expect(result.text).toBe("ok");
    expect(captured).toEqual([
      {
        url: "http://litellm.test/v1/chat/completions",
        authorization: "Bearer sk-local",
        body: expect.objectContaining({ model: "llama3.1:8b" }),
      },
    ]);
  });

  it("should never send the platform OPENAI_API_KEY to the endpoint", async () => {
    const captured: CapturedRequest[] = [];
    const original = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-platform-secret";
    try {
      const model = resolveOpenAiCompatibleModel(
        "qwen2.5-coder",
        { fetch: chatCompletionFetch(captured) },
        env({ MOGPLEX_OPENAI_COMPATIBLE_BASE_URL: "http://ollama.test/v1" })
      );
      await generateText({ model, prompt: "hi" });
    } finally {
      if (original === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = original;
    }

    expect(captured).toHaveLength(1);
    expect(captured[0]?.authorization ?? "").not.toContain(
      "sk-platform-secret"
    );
  });

  it("should throw a configuration error when no endpoint is configured", () => {
    expect(() => resolveOpenAiCompatibleModel("llama3", {}, env({}))).toThrow(
      /MOGPLEX_OPENAI_COMPATIBLE_BASE_URL/
    );
  });
});
