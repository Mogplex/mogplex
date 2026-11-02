import { expect, test, type Page } from "@playwright/test";
import { mockControlWorkspace } from "./helpers/control-workspace-fixture";
import { fulfillJson } from "./helpers/automation-control-plane-fixtures";
import { scopedPath } from "./helpers/auth";
import { navigateWithPalette } from "./helpers/command-palette-nav";

type RepoPatch = Record<string, unknown> & { id: string };

async function mockProject(page: Page) {
  const patches: RepoPatch[] = [];
  let repo: Record<string, unknown> = {
    id: "repo-widgets",
    full_name: "acme/widgets",
    owner: "acme",
    name: "widgets",
    default_branch: "main",
    is_hidden: false,
    runtime: null,
    env_sync_mode: "sandbox-only",
    sandbox_env_vars: { API_URL: "https://old.example.test", TOKEN: "s3cret" },
    sandbox_billing_mode_override: null,
    sandbox_billing_target: "personal",
    vercel_team_id: "team-acme",
    vercel_project_id: "legacy-app",
  };
  await mockControlWorkspace(page);
  await page.route("**/api/repos**", (route) => {
    if (route.request().method() !== "PATCH") return fulfillJson(route, [repo]);
    const body = route.request().postDataJSON() as RepoPatch;
    patches.push(body);
    repo = { ...repo, ...body };
    return fulfillJson(route, repo);
  });
  return patches;
}

async function openFromProjectMenu(page: Page, item: string) {
  await page
    .getByRole("button", { name: "Actions for acme/widgets", exact: true })
    .click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Project settings" });
  await expect(drawer).toBeVisible();
  return drawer;
}

async function openProjectSettings(page: Page, item: string) {
  const patches = await mockProject(page);
  await page.goto(scopedPath("control?mission=task-one"));
  const drawer = await openFromProjectMenu(page, item);
  await expect(drawer.getByText("acme/widgets")).toBeVisible();
  return { drawer, patches };
}

test("environment variables open from the project menu, stay masked, and save with pasted .env values", async ({
  page,
}) => {
  const { drawer, patches } = await openProjectSettings(
    page,
    "Environment variables"
  );
  await expect(
    drawer.getByRole("tab", { name: "Environment variables" })
  ).toHaveAttribute("aria-selected", "true");

  const token = drawer.getByLabel("TOKEN value", { exact: true });
  await expect(token).toHaveAttribute("type", "password");
  await drawer.getByRole("button", { name: "Show TOKEN value" }).click();
  await expect(token).toHaveAttribute("type", "text");
  await expect(token).toHaveValue("s3cret");

  await drawer.getByRole("button", { name: "Paste .env" }).click();
  await drawer
    .getByLabel("Paste .env contents")
    .fill('API_URL="https://new.example.test"\nNEW_FLAG=1\n');
  await drawer.getByRole("button", { name: "Import", exact: true }).click();
  await expect(
    drawer.getByLabel("NEW_FLAG value", { exact: true })
  ).toHaveValue("1");
  // The unsaved draft survives a trip to another tab.
  await drawer.getByRole("tab", { name: "General" }).click();
  await drawer.getByRole("tab", { name: "Environment variables" }).click();
  await expect(
    drawer.getByLabel("NEW_FLAG value", { exact: true })
  ).toHaveValue("1");
  await expect(token).toHaveAttribute("autocomplete", "off");
  await drawer.getByLabel("Variable scope").selectOption("sandbox-and-preview");
  await drawer.getByRole("button", { name: "Save variables" }).click();

  await expect(page.getByText("Settings saved", { exact: true })).toBeVisible();
  expect(patches).toHaveLength(1);
  expect(patches[0]).toMatchObject({
    id: "repo-widgets",
    env_sync_mode: "sandbox-and-preview",
    sandbox_env_vars: {
      API_URL: "https://new.example.test",
      TOKEN: "s3cret",
      NEW_FLAG: "1",
    },
  });
});

test("after a save the table shows the values the server stored", async ({
  page,
}) => {
  const { drawer } = await openProjectSettings(page, "Environment variables");
  let stored: Record<string, unknown> | null = null;
  await page.route("**/api/repos**", (route) => {
    if (route.request().method() !== "PATCH")
      return stored ? fulfillJson(route, [stored]) : route.fallback();
    const body = route.request().postDataJSON() as RepoPatch;
    // The server normalizes values; the drawer must not keep the draft.
    stored = {
      ...body,
      full_name: "acme/widgets",
      owner: "acme",
      name: "widgets",
      is_hidden: false,
      sandbox_env_vars: {
        API_URL: "https://stored.example.test",
        TOKEN: "s3cret",
      },
    };
    return fulfillJson(route, stored);
  });
  await drawer
    .getByLabel("API_URL value", { exact: true })
    .fill("'https://stored.example.test'");
  await drawer.getByRole("button", { name: "Save variables" }).click();

  await expect(page.getByText("Settings saved", { exact: true })).toBeVisible();
  await expect(drawer.getByLabel("API_URL value", { exact: true })).toHaveValue(
    "https://stored.example.test"
  );
});

test("an unparseable .env line shows an error and keeps the table unchanged", async ({
  page,
}) => {
  const { drawer, patches } = await openProjectSettings(
    page,
    "Environment variables"
  );
  await drawer.getByRole("button", { name: "Paste .env" }).click();
  await drawer.getByLabel("Paste .env contents").fill("GOOD=1\nnot a pair");
  await drawer.getByRole("button", { name: "Import", exact: true }).click();

  await expect(drawer.getByRole("alert")).toHaveText(
    "Invalid env var line: not a pair"
  );
  await expect(drawer.getByLabel("GOOD value", { exact: true })).toHaveCount(0);
  expect(patches).toEqual([]);
});

test("a non-JSON save failure shows a save message", async ({ page }) => {
  const { drawer } = await openProjectSettings(page, "Environment variables");
  await page.route("**/api/repos**", (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({ status: 502, body: "<html>Bad gateway</html>" })
      : route.fallback()
  );
  await drawer.getByRole("button", { name: "Save variables" }).click();

  await expect(drawer.getByRole("alert")).toHaveText(
    "Failed to save project settings"
  );
});

test("a duplicated variable name blocks saving with an explanation", async ({
  page,
}) => {
  const { drawer, patches } = await openProjectSettings(
    page,
    "Environment variables"
  );
  await drawer.getByRole("button", { name: "Add variable" }).click();
  await drawer.getByLabel("Variable 3 name").fill("TOKEN");
  await drawer.getByRole("button", { name: "Save variables" }).click();

  await expect(drawer.getByRole("alert")).toHaveText("TOKEN is defined twice.");
  expect(patches).toEqual([]);
});

test("project settings retire legacy personal Vercel configuration without touching variables", async ({
  page,
}) => {
  const { drawer, patches } = await openProjectSettings(
    page,
    "Project settings"
  );
  await expect(drawer.getByRole("tab", { name: "General" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await drawer
    .getByRole("combobox", { name: "Runtime", exact: true })
    .selectOption("node26");
  await expect(
    drawer.getByRole("combobox", { name: "Sandbox Billing" })
  ).toHaveValue("inherit");
  await drawer.getByRole("button", { name: "Save Settings" }).click();

  await expect(page.getByText("Settings saved", { exact: true })).toBeVisible();
  expect(patches.at(-1)).toMatchObject({
    runtime: "node26",
    sandbox_billing_mode_override: null,
    sandbox_billing_target: "personal",
    vercel_team_id: null,
    vercel_project_id: null,
    env_sync_mode: "sandbox-only",
    sandbox_env_vars: { API_URL: "https://old.example.test", TOKEN: "s3cret" },
  });
});

test("leaving Control with project settings open does not reopen them on return", async ({
  page,
}) => {
  await mockProject(page);
  // Arrive client-side so going back and forward keeps the app (and its
  // stores) alive, the way a user moving between pages would.
  await page.goto(scopedPath("control?mission=task-one"));
  const projectActions = page.getByRole("button", {
    name: "Actions for acme/widgets",
    exact: true,
  });
  await expect(projectActions).toBeVisible();
  await navigateWithPalette(page, "Repository settings");
  await expect(page).toHaveURL(/\/settings\//);
  await navigateWithPalette(page, "Control");
  await expect(projectActions).toBeVisible();
  await openFromProjectMenu(page, "Environment variables");
  await page.goBack();
  await expect(page).not.toHaveURL(/\/control/);
  await page.goForward();
  await expect(projectActions).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Project settings" })
  ).toBeHidden();
});

test("on a phone, project settings replace the sessions sheet", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockProject(page);
  await page.goto(scopedPath("control?mission=task-one"));
  await page
    .getByRole("button", { name: "Open sessions", exact: true })
    .click();
  const sessions = page.getByRole("dialog", { name: "Sessions", exact: true });
  await sessions
    .getByRole("button", { name: "Actions for acme/widgets", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Environment variables", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "Project settings" });
  await expect(settings).toBeVisible();
  // The open settings dialog hides everything else from assistive tech, so
  // check the sessions sheet once settings close: it must not be left behind.
  await settings.getByRole("button", { name: "Close" }).click();
  await expect(settings).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Open sessions" })
  ).toBeVisible();
  await expect(sessions).toBeHidden();
});
