import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import type { ControlSessionRecord } from "@/lib/control/session-types";
import {
  fulfillJson,
  mockBaseChrome,
} from "./helpers/automation-control-plane-fixtures";

test("command palette opens Control and restores a saved session from another dashboard page", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await page.route("**/api/repos**", (route) => fulfillJson(route, []));
  await page.route("**/api/agents**", (route) => fulfillJson(route, []));
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  const session = {
    id: "mission-invoices",
    title: "Reconcile September invoices",
    project: null,
    repo_id: null,
    model_id: null,
    orchestration_run_id: null,
    pinned: false,
    archived: false,
    messages: [],
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
  } satisfies ControlSessionRecord & { archived: boolean; created_at: string };
  const other = {
    ...session,
    id: "mission-quarterly",
    title: "Check quarterly totals",
  };
  await page.route("**/api/control/sessions**", (route) =>
    fulfillJson(
      route,
      new URL(route.request().url()).searchParams.has("id")
        ? new URL(route.request().url()).searchParams.get("id") === other.id
          ? other
          : session
        : [session, other]
    )
  );
  await page.goto(scopedPath("agents/roster"));
  await page.getByRole("button", { name: "New Agent", exact: true }).waitFor();
  await page.keyboard.press("Meta+k");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox").fill("Control");
  await expect(dialog.getByRole("option", { name: /Control/ })).toBeVisible();
  await dialog.getByRole("combobox").press("Enter");
  await expect(page).toHaveURL(new RegExp(`${scopedPath("control")}$`));
  await page.goto(scopedPath("agents/roster"));
  await page.getByRole("button", { name: "New Agent", exact: true }).waitFor();
  await page.keyboard.press("Meta+k");
  await dialog.getByRole("combobox").fill("September invoices");
  await expect(dialog.getByText("Sessions", { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole("option", { name: /Reconcile September invoices/ })
  ).toBeVisible();
  await dialog.getByRole("combobox").press("Enter");
  await expect(page).toHaveURL(
    new RegExp(`${scopedPath("control")}\\?mission=mission-invoices$`)
  );
  await expect(
    page.getByText(session.title, { exact: true }).last()
  ).toBeVisible();
  const composer = page.getByPlaceholder(
    "Ask for follow-up changes or attach images"
  );
  await composer.fill("Keep this unsent invoice draft");
  await page.keyboard.press("Meta+k");
  await dialog.getByRole("combobox").fill("quarterly totals");
  await dialog.getByRole("combobox").press("Enter");
  await expect(page).toHaveURL(
    new RegExp(`${scopedPath("control")}\\?mission=mission-quarterly$`)
  );
  await expect(
    page.getByText(other.title, { exact: true }).last()
  ).toBeVisible();
  await expect(composer).toHaveValue("");
  await page.keyboard.press("Meta+k");
  await dialog.getByRole("combobox").fill("September invoices");
  await dialog.getByRole("combobox").press("Enter");
  await expect(composer).toHaveValue("Keep this unsent invoice draft");
});

test("session search reports a failed list and retries without closing the palette", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await page.route("**/api/repos**", (route) => fulfillJson(route, []));
  await page.route("**/api/agents**", (route) => fulfillJson(route, []));
  let failed = true;
  await page.route("**/api/control/sessions**", (route) =>
    fulfillJson(
      route,
      failed
        ? { error: "Session store unavailable" }
        : [
            {
              id: "retry-mission",
              title: "Recovered invoice chat",
              project: null,
              repo_id: null,
              model_id: null,
              orchestration_run_id: null,
              pinned: false,
              messages: [],
              updated_at: "2026-09-01T00:00:00Z",
            } satisfies ControlSessionRecord,
          ],
      failed ? 500 : 200
    )
  );
  await page.goto(scopedPath("agents/roster"));
  await page.getByRole("button", { name: "New Agent", exact: true }).waitFor();
  await page.keyboard.press("Meta+k");
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("option", { name: "Could not load chats. Try again." })
  ).toBeVisible();
  failed = false;
  await dialog
    .getByRole("option", { name: "Could not load chats. Try again." })
    .click();
  await expect(
    dialog.getByRole("option", { name: "Recovered invoice chat" })
  ).toBeVisible();
  await expect(
    dialog.getByRole("option", { name: "Could not load chats. Try again." })
  ).toHaveCount(0);
});
