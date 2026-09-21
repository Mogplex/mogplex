import { expect, test, type Page } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
  modelId,
} from "./helpers/automation-control-plane-fixtures";
import {
  buildUiMessageStreamBody,
  mockBaseApp,
  modelId as workspaceModelId,
  repo as workspaceRepo,
} from "./helpers/diff-rendering-fixtures";

const CATALOG = {
  skills: [
    {
      id: "skill-1",
      slug: "deploy-checklist",
      name: "Deploy checklist",
      description: "Steps before shipping",
      source: "library",
    },
    {
      id: "skill-2",
      slug: "release-notes",
      name: "Release notes",
      description: "Write the changelog entry",
      source: "library",
    },
  ],
};

async function mockSkillCatalog(page: Page) {
  const requests: string[] = [];
  await page.route("**/api/skills/catalog**", (route) => {
    requests.push(route.request().url());
    return fulfillJson(route, CATALOG);
  });
  return requests;
}

test("Control completes a skill handle and sends the message exactly as typed", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  const catalogRequests = await mockSkillCatalog(page);
  await page.route("**/api/models", (route) =>
    fulfillJson(route, {
      models: [{ id: modelId, context_length: 128000 }],
      catalog: [{ id: modelId, context_length: 128000, is_enabled: true }],
      default_model: modelId,
    })
  );
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/repos", (route) =>
    fulfillJson(route, [
      {
        id: "repo-1",
        full_name: "acme/widgets",
        owner: "acme",
        name: "widgets",
        default_branch: "main",
      },
    ])
  );
  await page.route("**/api/control/sessions**", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    return fulfillJson(route, {
      id: "sess-skills-1",
      title: "Session",
      project: null,
      repo_id: "repo-1",
      model_id: modelId,
      pinned: false,
      archived: false,
      created_at: "2026-09-21T00:00:00.000Z",
      updated_at: "2026-09-21T00:00:00.000Z",
      messages: [],
    });
  });
  const sentTexts: string[] = [];
  await page.route("**/api/control/chat", (route) => {
    const body = route.request().postDataJSON() as {
      messages?: Array<{ role?: string; parts?: Array<{ text?: string }> }>;
    };
    const lastUser = body.messages?.findLast((m) => m.role === "user");
    sentTexts.push(
      lastUser?.parts?.map((part) => part.text ?? "").join("") ?? ""
    );
    const chunks = [
      { type: "start" },
      { type: "text-start", id: "t1" },
      {
        type: "text-delta",
        id: "t1",
        delta: "Following the release notes skill.",
      },
      { type: "text-end", id: "t1" },
      { type: "finish" },
    ];
    return route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body:
        chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
        "data: [DONE]\n\n",
    });
  });

  await page.goto(scopedPath("control"));
  const composer = page.getByPlaceholder("Ask anything or run a command...");
  await expect(composer).toBeVisible();

  // Nothing is offered for ordinary text.
  await composer.fill("Draft the notes with ");
  const menu = page.getByRole("listbox", { name: "Skills" });
  await expect(menu).toHaveCount(0);

  // A dollar handle opens the menu anywhere in the message and narrows as typed.
  await composer.pressSequentially("$");
  await expect(menu.getByRole("option")).toHaveCount(2);
  await composer.pressSequentially("rel");
  await expect(menu.getByRole("option")).toHaveCount(1);
  await expect(menu).toContainText("$release-notes");
  await expect(menu).toContainText("Write the changelog entry");

  // Enter picks the skill instead of sending a half-typed handle.
  await composer.press("Enter");
  await expect(composer).toHaveValue("Draft the notes with $release-notes ");
  await expect(menu).toHaveCount(0);
  expect(sentTexts).toEqual([]);

  // Escape dismisses without changing the text.
  await composer.pressSequentially("and $dep");
  await expect(menu).toContainText("$deploy-checklist");
  await composer.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(composer).toHaveValue(
    "Draft the notes with $release-notes and $dep"
  );

  await composer.fill("Draft the notes with $release-notes for v2");
  await page.getByRole("button", { name: "Start mission" }).click();
  await expect(
    page
      .getByRole("log", { name: "Conversation" })
      .getByText("Following the release notes skill.")
  ).toBeVisible();
  // The handle reaches the server untouched; the server loads the skill.
  expect(sentTexts).toEqual(["Draft the notes with $release-notes for v2"]);
  // Fixture repo ids are not UUIDs, so the library catalog is requested bare.
  expect(catalogRequests.every((url) => !url.includes("repoId="))).toBe(true);

  // The follow-up composer completes a leading slash handle the same way.
  const followUp = page.getByLabel("Ask for follow-up changes");
  await followUp.pressSequentially("/dep");
  await expect(page.getByTestId("control-skill-suggestions")).toContainText(
    "$deploy-checklist"
  );
  await followUp.press("Tab");
  await expect(followUp).toHaveValue("/deploy-checklist ");
});

test("the skills library shows the handle each skill answers to", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await mockSkillCatalog(page);
  await page.route("**/api/skills/registry**", (route) =>
    fulfillJson(route, { skills: [] })
  );
  await page.route("**/api/skills", (route) =>
    fulfillJson(
      route,
      CATALOG.skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        content: "…",
        is_public: false,
        tags: [],
        usage_count: 0,
        scope: "global",
        created_at: "2026-09-01T00:00:00.000Z",
        updated_at: "2026-09-01T00:00:00.000Z",
      }))
    )
  );

  await page.goto(scopedPath("agents/skills"));
  await page.getByRole("tab", { name: /Installed/ }).click();
  await expect(page.getByText("Deploy checklist")).toBeVisible();
  await expect(page.getByTestId("skill-handle")).toHaveText([
    "$deploy-checklist",
    "$release-notes",
  ]);
});

test("the workspace composer completes /skill and sends it instead of rejecting an unknown command", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseApp(page);
  await mockSkillCatalog(page);
  await page.route("**/api/commands", (route) => fulfillJson(route, []));
  await page.route(/\/api\/conversations(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, {
        messages: [],
        local_msgs: [],
        model: workspaceModelId,
        mode: "AUTO",
      });
      return;
    }
    await fulfillJson(route, { ok: true });
  });
  const sentTexts: string[] = [];
  await page.route("**/api/chat", async (route) => {
    const body = route.request().postDataJSON() as {
      messages?: Array<{ role?: string; parts?: Array<{ text?: string }> }>;
    };
    const lastUser = body.messages?.findLast((m) => m.role === "user");
    sentTexts.push(
      lastUser?.parts?.map((part) => part.text ?? "").join("") ?? ""
    );
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body: buildUiMessageStreamBody("Checklist done."),
    });
  });

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");
  await page.getByTestId(`home-open-workspace-${workspaceRepo.id}`).click();
  const composer = page.getByRole("textbox", {
    name: "Ask the agent what to build, fix, or explain. Type / for commands or drop files here.",
  });

  // Skills sit in the slash menu beside the built-ins.
  await composer.fill("/dep");
  await expect(page.getByText("Steps before shipping")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(composer).toHaveValue("/deploy-checklist ");

  await composer.pressSequentially("staging");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Checklist done.")).toBeVisible();
  expect(sentTexts).toEqual(["/deploy-checklist staging"]);
  await expect(page.getByText(/Unknown command/)).toHaveCount(0);
});
