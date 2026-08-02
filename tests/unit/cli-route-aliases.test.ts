import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function loadCliRoutes() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

  const [inferenceRoute, openAiRoute, inferenceRouteSource, openAiRouteSource] =
    await Promise.all([
      import("../../app/api/cli/inference/chat/completions/route"),
      import("../../app/api/cli/openai/chat/completions/route"),
      readFile(
        new URL(
          "../../app/api/cli/inference/chat/completions/route.ts",
          import.meta.url
        ),
        "utf8"
      ),
      readFile(
        new URL(
          "../../app/api/cli/openai/chat/completions/route.ts",
          import.meta.url
        ),
        "utf8"
      ),
    ]);

  return {
    inferenceRoute,
    openAiRoute,
    inferenceRouteSource,
    openAiRouteSource,
  };
}

test("CLI inference and OpenAI compat routes stay aliased to the same POST handler", async () => {
  const {
    inferenceRoute,
    openAiRoute,
    inferenceRouteSource,
    openAiRouteSource,
  } = await loadCliRoutes();

  assert.equal(inferenceRoute.runtime, "nodejs");
  assert.equal(openAiRoute.runtime, "nodejs");
  assert.equal(typeof inferenceRoute.POST, "function");
  assert.equal(typeof openAiRoute.POST, "function");
  assert.equal(inferenceRoute.POST.name, "postChatCompletions");
  assert.equal(openAiRoute.POST.name, "postChatCompletions");
  assert.match(
    inferenceRouteSource,
    /export \{ postChatCompletions as POST \} from "\.\/handler";/
  );
  assert.match(
    openAiRouteSource,
    /export \{ postChatCompletions as POST \} from "\.\.\/\.\.\/\.\.\/inference\/chat\/completions\/handler";/
  );
});
