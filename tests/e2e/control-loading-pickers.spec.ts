import { expect, test } from "@playwright/test";
import { scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  modelId,
} from "./helpers/automation-control-plane-fixtures";
import {
  mockRecoveryChrome,
  recoverySession,
} from "./helpers/control-recovery-fixtures";

test("new chat waits for projects and models without opening project creation", async ({
  page,
}) => {
  await mockRecoveryChrome(page);
  let releaseRepos!: () => void;
  let releaseModels!: () => void;
  const reposReady = new Promise<void>((resolve) => {
    releaseRepos = resolve;
  });
  const modelsReady = new Promise<void>((resolve) => {
    releaseModels = resolve;
  });
  await page.route("**/api/repos**", async (route) => {
    await reposReady;
    return fulfillJson(route, [{ id: "repo-1", full_name: "acme/widgets" }]);
  });
  await page.route("**/api/models", async (route) => {
    await modelsReady;
    return fulfillJson(route, {
      models: [{ id: modelId, context_length: 128000 }],
      catalog: [{ id: modelId, is_enabled: true }],
    });
  });
  let ownersRequests = 0;
  await page.route("**/api/github/owners", (route) => {
    ownersRequests++;
    return fulfillJson(route, { owners: [] });
  });
  await page.route("**/api/control/sessions**", (route) =>
    fulfillJson(route, [])
  );
  await page.goto(scopedPath("control"));
  await page.getByRole("button", { name: "New session", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Project", exact: true })
  ).toHaveText("Loading projects…");
  await expect(
    page.getByRole("combobox", { name: "Project", exact: true })
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Loading models…" })
  ).toBeDisabled();
  await expect(page.getByLabel("Owner", { exact: true })).toHaveCount(0);
  await page
    .getByPlaceholder("Ask anything or run a command...")
    .fill("Investigate this project");
  await expect(
    page.getByRole("button", { name: "Start mission" })
  ).toBeDisabled();
  releaseRepos();
  await expect(
    page.getByRole("combobox", { name: "Project", exact: true })
  ).toHaveText("acme/widgets");
  await expect(
    page.getByRole("button", { name: "Start mission" })
  ).toBeDisabled();
  releaseModels();
  await expect(
    page.getByRole("button", { name: "Start mission" })
  ).toBeEnabled();
  expect(ownersRequests).toBe(0);
});

test("a restored sandbox view waits for repository data instead of claiming none is linked", async ({
  page,
}) => {
  await mockRecoveryChrome(page);
  let releaseRepos!: () => void;
  const reposReady = new Promise<void>((resolve) => {
    releaseRepos = resolve;
  });
  await page.route("**/api/repos**", async (route) => {
    await reposReady;
    return fulfillJson(route, [{ id: "repo-1", full_name: "acme/widgets" }]);
  });
  await page.route("**/api/control/sessions**", (route) =>
    fulfillJson(
      route,
      new URL(route.request().url()).searchParams.has("id")
        ? recoverySession
        : [recoverySession]
    )
  );
  await page.goto(`${scopedPath("control")}?mission=${recoverySession.id}`);
  await expect(page.getByText("Saved request", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Sandboxes", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("status", { name: "Loading sandbox compute" })
  ).toBeVisible();
  await expect(
    page.getByText("No repository is linked", { exact: false })
  ).toHaveCount(0);
  releaseRepos();
  await expect(
    page.getByText("No current sandbox", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("No repository is linked", { exact: false })
  ).toHaveCount(0);
});

for (const newChat of [false, true]) {
  test(`a failed model load offers Retry in ${newChat ? "a new" : "a restored"} chat`, async ({
    page,
  }) => {
    await mockRecoveryChrome(page);
    let failed = true;
    await page.route("**/api/models", (route) =>
      fulfillJson(
        route,
        failed
          ? { error: "Unavailable" }
          : {
              models: [{ id: modelId, context_length: 128000 }],
              catalog: [{ id: modelId, is_enabled: true }],
            },
        failed ? 503 : 200
      )
    );
    await page.route("**/api/control/sessions**", (route) =>
      fulfillJson(
        route,
        newChat
          ? []
          : new URL(route.request().url()).searchParams.has("id")
            ? recoverySession
            : [recoverySession]
      )
    );
    await page.goto(scopedPath("control"));
    const error = page
      .getByRole("alert")
      .filter({ hasText: "Could not load models" });
    await expect(error).toBeVisible();
    failed = false;
    await error.getByRole("button", { name: "Retry" }).click();
    await expect(error).toHaveCount(0);
    await page
      .getByPlaceholder(
        newChat
          ? "Ask anything or run a command..."
          : "Ask for follow-up changes or attach images"
      )
      .fill("Continue investigation");
    await expect(
      page.getByRole("button", {
        name: newChat ? "Start mission" : "Send",
        exact: true,
      })
    ).toBeEnabled();
  });
}
