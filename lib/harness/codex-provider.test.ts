import { expect, it } from "vitest";
import { codexProviderArgs } from "./codex-provider";

it("uses the Codex gateway compatibility endpoint without putting secrets in arguments", () => {
  const args = codexProviderArgs({
    OPENAI_BASE_URL: "https://ai-gateway.vercel.sh/v1",
    CODEX_API_KEY: "private-fixture",
  });
  expect(args).toContain('model_provider="mogplex_gateway"');
  expect(args).toContain(
    'model_providers.mogplex_gateway.base_url="https://ai-gateway.vercel.sh/codex/v1"'
  );
  expect(args).toContain(
    'model_providers.mogplex_gateway.env_key="CODEX_API_KEY"'
  );
  expect(args).toContain(
    'model_providers.mogplex_gateway.wire_api="responses"'
  );
  expect(args).toContain('model="openai/gpt-5.6-sol"');
  expect(args.join(" ")).not.toContain("private-fixture");
  expect(
    args.filter((_, index) => index % 2 === 0).every((arg) => arg === "-c")
  ).toBe(true);
});

it("does not override direct OpenAI or user-configured providers", () => {
  expect(codexProviderArgs({})).toEqual([]);
  expect(
    codexProviderArgs({ OPENAI_BASE_URL: "https://api.openai.com/v1" })
  ).toEqual([]);
  expect(
    codexProviderArgs({ OPENAI_BASE_URL: "https://user-provider.example/v1" })
  ).toEqual([]);
});
