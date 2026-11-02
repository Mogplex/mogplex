import { expect, test, type Page } from "@playwright/test";
import { mockControlWorkspace } from "./helpers/control-workspace-fixture";
import { fulfillJson } from "./helpers/automation-control-plane-fixtures";
import { scopedPath } from "./helpers/auth";

type RepoPatch = Record<string, unknown> & { id: string };

async function openProjectSettings(page: Page, item: string) {
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
  await page.goto(scopedPath("control?mission=task-one"));
  await page
    .getByRole("button", { name: "Actions for acme/widgets", exact: true })
    .click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Project settings" });
  await expect(drawer).toBeVisible();
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
