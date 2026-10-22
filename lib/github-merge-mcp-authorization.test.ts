import assert from "node:assert/strict";
import { test } from "vitest";
import { createMogplexMcpPost } from "@/lib/harness/mogplex-mcp";
import { buildHarnessResearchEnv } from "@/lib/harness/research-auth";
import { createGithubPullRequestMergeTool } from "@/lib/agents/tools/github-pr-merge";
import { ALL_CAPABILITIES } from "@/lib/team-capabilities";
import {
  withEnv,
  withPatchedFetch,
} from "@/tests/unit/helpers/agents-tools-fixtures";
import {
  mergeFetch,
  REVIEWED_HEAD_SHA,
  withAcmeInstallation,
  type MergeFetchCall,
} from "@/tests/unit/helpers/github-pr-merge-fixtures";

test("MCP cached tool ignores retired settings and rechecks live team permission", async () => {
  await withEnv(
    {
      EXA_API_KEY: "test-research-key",
      EXA_RESEARCH_SECRET: "test-signing-secret",
      NEXT_PUBLIC_APP_URL: "https://example.com",
    },
    async () => {
      await withAcmeInstallation(async () => {
        const calls: MergeFetchCall[] = [];
        await withPatchedFetch(mergeFetch(calls), async () => {
          let requireApproval = false;
          let permitted = true;
          let builds = 0;
          let reads = 0;
          const tool = createGithubPullRequestMergeTool({
            userId: "user-1",
            teamId: "team-1",
            aiCallId: "call-1",
            recordAuditEvent: async () => ({ ok: true }),
            mergePolicyDeps: {
              read: async () => {
                reads += 1;
                if (!permitted) throw new Error("Merge permission revoked");
                return { requireApproval, contextRepoOnly: false };
              },
            },
          });
          const post = createMogplexMcpPost({
            authorizeRun: async () => ({
              run: {
                userId: "user-1",
                aiCallId: "call-1",
                sandboxRecordId: "sandbox-1",
                repoId: "repo-1",
                teamId: "team-1",
                conversationId: null,
              },
              capabilities: ALL_CAPABILITIES,
            }),
            buildTools: async () => {
              builds += 1;
              return {
                tools: { github_merge_pull_request: tool },
                cleanup: async () => undefined,
              };
            },
          });
          const token = buildHarnessResearchEnv({
            userId: "user-1",
            aiCallId: "call-1",
            id: "sandbox-1",
          }).MOGPLEX_RESEARCH_TOKEN;
          const call = async (method: string) => {
            const response = await post(
              new Request("https://example.com/api/harness-research/mcp", {
                method: "POST",
                headers: { authorization: `Bearer ${token}` },
                body: JSON.stringify({
                  jsonrpc: "2.0",
                  id: reads + 1,
                  method,
                  params:
                    method === "tools/call"
                      ? {
                          name: "github_merge_pull_request",
                          arguments: {
                            owner: "acme",
                            repo: "widgets",
                            number: 84,
                            expectedHeadSha: REVIEWED_HEAD_SHA,
                          },
                        }
                      : {},
                }),
              })
            );
            assert.equal(response.status, 200);
            return (await response.json()) as {
              result: { isError?: boolean; content?: Array<{ text: string }> };
            };
          };
          await call("tools/list");
          assert.equal(
            JSON.parse((await call("tools/call")).result.content![0].text)
              .merged,
            true
          );
          requireApproval = true;
          const withOldSetting = await call("tools/call");
          assert.equal(withOldSetting.result.isError, false);
          assert.equal(
            JSON.parse(withOldSetting.result.content![0].text).merged,
            true
          );
          const afterDefault = calls.length;
          permitted = false;
          const denied = await call("tools/call");
          assert.equal(denied.result.isError, true);
          assert.match(denied.result.content![0].text, /merge permission/);
          assert.equal(calls.length, afterDefault);
          permitted = true;
          const allowed = await call("tools/call");
          assert.equal(allowed.result.isError, false);
          assert.equal(
            JSON.parse(allowed.result.content![0].text).merged,
            true
          );
          assert.equal(builds, 1);
          assert.equal(reads, 4);
        });
      });
    }
  );
});
