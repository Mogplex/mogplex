import assert from "node:assert/strict";
import test from "node:test";
import { deriveGithubRequestMutationAuthorizations } from "@/lib/agents/tools/github-mutation-authorization";
import {
  createTestGithubAppPrivateKey,
  loadToolsModule,
  withEnv,
  withPatchedFetch,
  withPatchedGithubInstallations,
} from "./helpers/agents-tools-fixtures";

test("shared issue tools execute contextual follow-ups without sentence-shaped grants", async () => {
  const { buildStaticTools } = await loadToolsModule();
  const writes: unknown[] = [];
  await withEnv(
    {
      GITHUB_APP_ID: "12345",
      GITHUB_APP_NAME: "mogplex-test",
      GITHUB_APP_PRIVATE_KEY: createTestGithubAppPrivateKey(),
    },
    async () => {
      await withPatchedGithubInstallations(
        {
          data: [{ installation_id: 321, account_login: "acme" }],
          error: null,
        },
        async () => {
          await withPatchedFetch(
            async (url, init) => {
              if (new URL(String(url)).pathname.endsWith("/access_tokens")) {
                return Response.json({ token: "ghs-installation" });
              }
              if (init?.method === "PATCH")
                writes.push(JSON.parse(String(init.body)));
              return Response.json({
                number: 42,
                html_url: "https://github.com/acme/widgets/issues/42",
                body: "Existing criteria\n- Include the home page.",
                state: "open",
              });
            },
            async () => {
              for (const userText of [
                "In the issue, make sure it includes the home page too",
                "Explicit authorization granted",
                "Update acme/widgets issue #42 to include the home page too",
                "Update issue acme/widgets#42 to include the home page too",
              ]) {
                const tools = buildStaticTools(
                  undefined,
                  "user-1",
                  undefined,
                  undefined,
                  undefined,
                  undefined,
                  undefined,
                  undefined,
                  undefined,
                  deriveGithubRequestMutationAuthorizations({ userText })
                );
                const result = await tools.github_update_issue!.execute!(
                  {
                    owner: "acme",
                    repo: "widgets",
                    number: 42,
                    body: "Existing criteria\n- Include the home page.",
                  },
                  { toolCallId: "update", messages: [], context: undefined }
                );
                assert.equal((result as { ok?: boolean }).ok, true, userText);
              }
            }
          );
        }
      );
    }
  );
  assert.deepEqual(
    writes,
    Array.from({ length: 4 }, () => ({
      body: "Existing criteria\n- Include the home page.",
    }))
  );
});

test("team capability restrictions still remove issue write tools", async () => {
  const { buildStaticTools } = await loadToolsModule();
  const tools = buildStaticTools(
    undefined,
    "user-1",
    undefined,
    undefined,
    undefined,
    undefined,
    new Set()
  );
  assert.equal("github_update_issue" in tools, false);
  assert.equal("github_comment_issue" in tools, false);
});
