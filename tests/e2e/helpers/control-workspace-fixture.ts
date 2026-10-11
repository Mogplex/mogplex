import type { Page } from "@playwright/test";
import type { UIMessage } from "ai";
import { enableScopedE2EAuth, scopedPath } from "./auth";
import {
  fulfillJson,
  mockBaseChrome,
} from "./automation-control-plane-fixtures";
import { buildSandboxFixture } from "./sandbox-fixtures";

export async function mockControlWorkspace(
  page: Page,
  theme: "light" | "dark" = "dark"
) {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await page.addInitScript(
    (value) => window.localStorage.setItem("theme", value),
    theme
  );
  await page.route("**/api/settings", (route) =>
    fulfillJson(route, { default_model: "minimax/minimax-m2.5", theme })
  );
  const messages: UIMessage[] = [
    {
      id: "request",
      role: "user",
      parts: [{ type: "text", text: "Refresh the welcome page" }],
    },
    {
      id: "answer",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "plan_mission",
          toolCallId: "plan",
          state: "output-available",
          input: {
            title: "Refresh welcome",
            tasks: [
              {
                slug: "welcome",
                title: "Update welcome copy",
                prompt: "Make the welcome page clear",
                ownedPaths: ["app/page.tsx"],
              },
            ],
          },
          output: { success: true },
        },
        {
          type: "dynamic-tool",
          toolName: "run_command",
          toolCallId: "command",
          state: "output-available",
          input: { command: "pnpm test" },
          output: {
            sandboxId: "sandbox-one",
            stdout: "12 checks passed",
            stderr: "",
          },
        },
        { type: "text", text: "The welcome page is ready for review." },
      ],
    },
  ];
  const sessions = ["one", "two"].map((id) => ({
    id: `task-${id}`,
    title: id === "one" ? "Refresh welcome page" : "Review billing flow",
    project: "acme/widgets",
    repo_id: "repo-widgets",
    model_id: null,
    orchestration_run_id: null,
    external_run_id: null as string | null,
    pinned: false,
    archived: false,
    created_at: "2026-10-10T12:00:00Z",
    updated_at: "2026-10-10T12:00:00Z",
    messages: id === "one" ? messages : [],
  }));
  const sandboxes = ["one", "two"].map((id) => ({
    ...buildSandboxFixture({
      repoId: "repo-widgets",
      sandboxRecordId: `sandbox-${id}`,
      sandboxId: `runtime-${id}`,
      previewUrl: `https://preview.example.test/${id}`,
    }),
    working_branch: `work/${id}`,
    base_branch: "main",
    root_directory: null,
  }));
  const mutations: string[] = [];
  await page.route("**/api/control/sessions**", (route) => {
    const request = route.request();
    const id = new URL(request.url()).searchParams.get("id");
    if (request.method() === "PUT")
      return fulfillJson(route, {
        ok: true,
        session: sessions.find((s) => s.id === request.postDataJSON().id),
      });
    return fulfillJson(
      route,
      id ? sessions.find((s) => s.id === id) : sessions
    );
  });
  await page.route("**/api/repos**", (route) =>
    fulfillJson(route, [
      {
        id: "repo-widgets",
        full_name: "acme/widgets",
        owner: "acme",
        name: "widgets",
        default_branch: "main",
        hidden: false,
      },
    ])
  );
  await page.route("**/api/connections**", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/sandbox**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/terminal/connect"))
      return fulfillJson(route, { available: false, reason: "disabled" });
    if (request.method() !== "GET") mutations.push(url.pathname);
    if (url.pathname.endsWith("/health"))
      return fulfillJson(route, {
        status: "running",
        healthStatus: "running",
        previewUrl: "https://preview.example.test/one",
      });
    if (url.pathname.endsWith("/changes"))
      return fulfillJson(
        route,
        url.searchParams.has("path")
          ? {
              diff: "--- a/app/page.tsx\n+++ b/app/page.tsx\n@@ -1 +1 @@\n-Old welcome\n+Welcome home\n",
            }
          : {
              branch: "work/one",
              baseBranch: "main",
              ahead: 0,
              behind: 0,
              files: [
                {
                  path: "app/page.tsx",
                  status: "modified",
                  additions: 1,
                  deletions: 1,
                },
              ],
            }
      );
    if (url.pathname.endsWith("/tree"))
      return fulfillJson(route, { paths: ["app/page.tsx", "package.json"] });
    if (url.pathname.endsWith("/files"))
      return fulfillJson(route, {
        content:
          "export default function Page() { return <h1>Welcome home</h1>; }",
      });
    if (url.pathname.includes("/terminal/transport"))
      return fulfillJson(route, { kind: "exec", reason: "unsupported" });
    return fulfillJson(route, { sandboxes });
  });
  await page.route("https://preview.example.test/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<h1>Welcome home</h1>" })
  );
  await page.goto(`${scopedPath("control")}?mission=task-one`);
  return { mutations, sessions, sandboxes };
}
