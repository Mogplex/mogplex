import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  initializeTrackedEvents,
  mockActivationFlow,
  fulfillJson,
} from "./helpers/activation-fixtures";

type SavedConversation = {
  id: string;
  repo_id: string | null;
  sandbox_id: string | null;
  workspace_session_id: string | null;
  model: string;
  messages: unknown[];
  local_msgs: unknown[];
  updated_at: string;
};

test("a draft reloaded before sandbox records arrive saves its selected sandbox and retains it", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  await mockActivationFlow(page);
  const saved = new Map<string, SavedConversation>();
  const writes: SavedConversation[] = [];
  await page.route(/\/api\/conversations(?:\?.*)?$/, async (route) => {
    const request = route.request();
    const id = new URL(request.url()).searchParams.get("id");
    if (request.method() === "GET") {
      await fulfillJson(route, id ? (saved.get(id) ?? null) : []);
    } else if (request.method() === "PUT") {
      const body = request.postDataJSON() as SavedConversation;
      const conversation = { ...body, updated_at: new Date().toISOString() };
      writes.push(conversation);
      saved.set(body.id, conversation);
      await fulfillJson(route, { ok: true, conversation });
    } else await route.fallback();
  });
  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");
  await page.getByTestId("home-sync-repos").click();
  await page.getByTestId("home-open-workspace-repo-1").click();
  await expect(page.getByTestId("preview-grab-button")).toBeEnabled();
  await page.waitForLoadState("networkidle");
  let releaseRecords!: () => void;
  const recordsReleased = new Promise<void>((resolve) => {
    releaseRecords = resolve;
  });
  await page.route(/\/api\/sandbox(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "GET") await recordsReleased;
    await route.fallback();
  });
  const draftLoaded = page.waitForResponse((response) =>
    response.url().includes("/api/conversations?id=")
  );
  await page.reload();
  await draftLoaded;
  const composer = page.getByRole("textbox", {
    name: "Ask the agent what to build, fix, or explain. Type / for commands or drop files here.",
  });
  await composer.fill("Use this workspace sandbox");
  releaseRecords();
  await expect(page.getByTestId("preview-grab-button")).toBeEnabled();
  await composer.press("Enter");
  await expect(page.getByText("Applied preview feedback.")).toBeVisible();
  expect(writes.length).toBeGreaterThan(0);
  expect(writes[0]).toMatchObject({
    repo_id: "repo-1",
    sandbox_id: "sandbox-record-repo-1",
  });
  await page.reload();
  await expect(page.getByText("Use this workspace sandbox")).toBeVisible();
  await composer.fill("Keep the same saved sandbox");
  await composer.press("Enter");
  await expect(page.getByText("Applied preview feedback.")).toHaveCount(2);
  expect(writes.at(-1)?.sandbox_id).toBe("sandbox-record-repo-1");
});
