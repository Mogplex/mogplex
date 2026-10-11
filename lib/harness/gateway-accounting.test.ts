import { expect, it } from "vitest";
import { codexProviderArgs } from "./codex-provider";
import { codexAcpAuth } from "./acp/agent";

const env = { OPENAI_BASE_URL: "https://ai-gateway.vercel.sh/v1" };
const callId = "00000000-0000-4000-8000-000000000123";

it("attributes ACP and CLI requests to the same server-owned call", () => {
  expect(codexAcpAuth(env, callId)).toMatchObject({
    headers: { "ai-reporting-tags": `surface:harness,ai-call:${callId}` },
  });
  expect(codexProviderArgs(env, callId)).toContain(
    `model_providers.mogplex_gateway.http_headers."ai-reporting-tags"="surface:harness,ai-call:${callId}"`
  );
});

it("does not attribute a direct provider or an untracked run", () => {
  expect(codexAcpAuth({}, callId)).not.toHaveProperty("headers");
  expect(codexAcpAuth(env)).not.toHaveProperty("headers");
  expect(codexProviderArgs({}, callId)).toEqual([]);
});
