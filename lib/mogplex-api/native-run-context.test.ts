import { expect, it } from "vitest";
import {
  buildNativeRunMessages,
  loadNativeRunContext,
} from "./native-run-context";
import { buildRunRow } from "../../tests/unit/helpers/mogplex-api-runs-fixtures";

const run = buildRunRow({ harness: "mogplex", working_branch: "fix/header" });
const sandbox = { recordId: "sandbox-record-1", sandboxId: "sbx_123" };
const record = {
  id: sandbox.recordId,
  user_id: run.user_id,
  repo_id: run.repo_id,
  sandbox_id: "sbx_123",
  status: "running",
  product_team_id: "team-1",
  working_branch: "fix/header",
  base_branch: "main",
  repo: { full_name: "example/app" },
};

it("binds the full native tools to the owned sandbox, repository, branch and team", async () => {
  const context = await loadNativeRunContext(run, sandbox, async () => record);
  expect(context).toMatchObject({
    userId: run.user_id,
    repoId: run.repo_id,
    sandboxId: sandbox.recordId,
    teamId: "team-1",
    repoFullName: "example/app",
    repoOwner: "example",
    repoName: "app",
    repoBranch: "fix/header",
    repoBaseBranch: "main",
    surface: "chat",
    enableTools: true,
  });
});

it.each([
  { user_id: "another-user" },
  { repo_id: "another-repo" },
  { sandbox_id: "replaced-vm" },
  { status: "stopped" },
  { id: "another-record" },
  { working_branch: "another-branch" },
])("rejects stale or foreign sandbox bindings: %j", async (override) => {
  await expect(
    loadNativeRunContext(run, sandbox, async () => ({ ...record, ...override }))
  ).rejects.toThrow("Active sandbox not found");
});

it("rejects a missing repo and accepts PostgREST's array embed shape", async () => {
  await expect(
    loadNativeRunContext(run, sandbox, async () => ({ ...record, repo: null }))
  ).rejects.toThrow("Repository not found");
  const context = await loadNativeRunContext(run, sandbox, async () => ({
    ...record,
    repo: [record.repo],
  }));
  expect(context.repoFullName).toBe("example/app");
});

const withImage = () =>
  buildRunRow({
    harness: "mogplex",
    prompt: "Fix the mobile header",
    metadata: {
      slack_image_attachments: {
        teamId: "T1",
        files: [
          {
            id: "F1",
            mimetype: "image/png",
            name: "header.png",
            urlPrivateDownload:
              "https://files.slack.com/files-pri/T1-F1/header.png",
          },
        ],
      },
    },
  });

it("passes downloaded Slack image bytes to the native model alongside the user's text", async () => {
  const messages = await buildNativeRunMessages(withImage(), {
    getToken: async (teamId) => {
      expect(teamId).toBe("T1");
      return "test-token";
    },
    fetch: async (url, options) => {
      expect(String(url)).toBe(
        "https://files.slack.com/files-pri/T1-F1/header.png"
      );
      expect(options?.redirect).toBe("error");
      expect(new Headers(options?.headers).get("Authorization")).toBe(
        "Bearer test-token"
      );
      return new Response(new Uint8Array([1, 2, 3]));
    },
  });
  expect(messages).toEqual([
    {
      role: "user",
      parts: [
        { type: "text", text: "Fix the mobile header" },
        {
          type: "file",
          mediaType: "image/png",
          filename: "header.png",
          url: "data:image/png;base64,AQID",
        },
      ],
    },
  ]);
});

it("reports an unavailable image in model input instead of pretending it was inspected", async () => {
  const messages = await buildNativeRunMessages(withImage(), {
    getToken: async () => "test-token",
    fetch: async () => new Response(null, { status: 403 }),
  });
  expect(messages[0].parts).toEqual([
    {
      type: "text",
      text: "Fix the mobile header\n\n(couldn't load attached image)",
    },
  ]);
});

it("fails clearly when Slack image credentials are absent", async () => {
  await expect(
    buildNativeRunMessages(withImage(), {
      getToken: async () => null,
      fetch: async () => {
        throw new Error("must not fetch");
      },
    })
  ).rejects.toThrow("Slack image access is unavailable");
});

it("does not need Slack credentials for a text-only native run", async () => {
  expect(await buildNativeRunMessages(buildRunRow())).toEqual([
    { role: "user", parts: [{ type: "text", text: "Fix the tests" }] },
  ]);
});
