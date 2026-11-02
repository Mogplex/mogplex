import { expect, test, type Page } from "@playwright/test";
import { mockControlWorkspace } from "./helpers/control-workspace-fixture";
import { fulfillJson } from "./helpers/automation-control-plane-fixtures";
import { scopedPath } from "./helpers/auth";

type RepoPatch = Record<string, unknown> & { id: string };

async function openRequest(page: Page) {
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
    sandbox_env_vars: { NODE_ENV: "development" },
    sandbox_billing_mode_override: null,
    sandbox_billing_target: "personal",
  };
  await mockControlWorkspace(page, "dark", {
    assistantParts: [
      {
        type: "dynamic-tool",
        toolName: "project_env_request",
        toolCallId: "env-request",
        state: "output-available",
        input: { names: ["STRIPE_SECRET_KEY", "DATABASE_URL", "NODE_ENV"] },
        output: {
          ok: true,
          repoId: "repo-widgets",
          requested: ["STRIPE_SECRET_KEY", "DATABASE_URL", "NODE_ENV"],
          missing: ["STRIPE_SECRET_KEY", "DATABASE_URL"],
          reason: "Checkout needs Stripe and the app needs its database.",
        },
      },
    ],
  });
  await page.route("**/api/repos**", (route) => {
    if (route.request().method() !== "PATCH") return fulfillJson(route, [repo]);
    const body = route.request().postDataJSON() as RepoPatch;
    patches.push(body);
    repo = { ...repo, ...body };
    return fulfillJson(route, repo);
  });
  await page.goto(scopedPath("control?mission=task-one"));
  await expect(
    page.getByText("Checkout needs Stripe and the app needs its database.")
  ).toBeVisible();
  return { patches };
}

test("Set variables opens project settings with the requested names ready to fill", async ({
  page,
}) => {
  const { patches } = await openRequest(page);
  const requested = page.getByRole("list", { name: "Requested variables" });
  await expect(requested.getByRole("listitem")).toHaveCount(3);
  await expect(requested.getByText("not set")).toHaveCount(2);

  await page.getByRole("button", { name: "Set variables" }).click();
  const drawer = page.getByRole("dialog", { name: "Project settings" });
  await expect(drawer).toBeVisible();
  await expect(
    drawer.getByRole("tab", { name: "Environment variables" })
  ).toHaveAttribute("aria-selected", "true");
  const stripe = drawer.getByLabel("STRIPE_SECRET_KEY value", { exact: true });
  await expect(stripe).toHaveValue("");
  await expect(stripe).toHaveAttribute("placeholder", "Needed by Control");
  await expect(
    drawer.getByLabel("DATABASE_URL value", { exact: true })
  ).toHaveValue("");
  await expect(
    drawer.getByLabel("NODE_ENV value", { exact: true })
  ).toHaveValue("development");

  // Fill one; the one left empty is not saved as an empty value.
  await stripe.fill("test-stripe-value");
  await drawer.getByRole("button", { name: "Save variables" }).click();
  await expect(page.getByText("Settings saved", { exact: true })).toBeVisible();
  expect(patches).toHaveLength(1);
  expect(patches[0]?.sandbox_env_vars).toEqual({
    NODE_ENV: "development",
    STRIPE_SECRET_KEY: "test-stripe-value",
  });
  await expect(drawer.getByRole("status")).toHaveText(
    /Still empty, not saved: DATABASE_URL\./
  );

  // The card follows the saved project, not the snapshot from the request.
  await drawer.getByRole("button", { name: "Close" }).click();
  await expect(drawer).toBeHidden();
  await expect(requested.getByText("not set")).toHaveCount(1);
  await page.getByRole("button", { name: "Set variables" }).click();
  await expect(
    drawer.getByLabel("STRIPE_SECRET_KEY value", { exact: true })
  ).toHaveValue("test-stripe-value");
});
