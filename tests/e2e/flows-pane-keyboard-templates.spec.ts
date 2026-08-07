import { expect, test } from "@playwright/test";
import { selectAppOption } from "./helpers/app-select";
import {
  stubFlowsPage,
  fulfillJson,
} from "./helpers/flows-pane-keyboard-fixtures";

test("new workflow picker creates a selected starter template", async ({
  page,
}) => {
  const createPayloads: Record<string, unknown>[] = [];
  await stubFlowsPage(page, {
    onFlowCreate: (payload) => {
      createPayloads.push(payload);
    },
  });

  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "New workflow" }).click();
  const picker = page.getByTestId("flow-template-picker");
  await expect(picker).toBeVisible();
  await expect(picker).toContainText("Nothing runs until you publish it.");
  await expect(picker.getByRole("button")).toHaveCount(5);

  await page.getByTestId("flow-template-dependabot-autopilot").click();

  await expect
    .poll(() => createPayloads[0]?.template_id)
    .toBe("dependabot-autopilot");
  expect(createPayloads[0]?.installation_id).toBe(101);
  await expect(picker).toBeHidden();
  await expect(
    page.getByText("Started from Dependabot autopilot.", { exact: true })
  ).toBeVisible();
});

test("personal workflow templates bind a target repository and can be saved from the picker", async ({
  page,
}) => {
  const flowCreatePayloads: Record<string, unknown>[] = [];
  const templateCreatePayloads: Record<string, unknown>[] = [];
  await stubFlowsPage(page, {
    installations: [
      {
        id: "inst-1",
        installation_id: 101,
        account_login: "webrenew",
        account_type: "Organization",
        repositories: [
          { id: "repo-1", full_name: "webrenew/blackbox" },
          { id: "repo-2", full_name: "webrenew/mogplex" },
        ],
      },
    ],
    personalTemplates: [
      {
        id: "template-strict-review",
        name: "Strict PR review",
        description: "Extra checks for critical repositories.",
        trigger_event: "webhook",
        reconnect: ["webhook"],
        requires_repository: true,
      },
    ],
    onFlowCreate: (payload) => flowCreatePayloads.push(payload),
    onTemplateCreate: (payload) => templateCreatePayloads.push(payload),
  });

  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "New workflow" }).click();
  const personalTemplate = page.getByTestId(
    "flow-personal-template-template-strict-review"
  );
  await expect(personalTemplate).toBeDisabled();
  await expect(personalTemplate).toContainText("Reconnect webhook");

  await selectAppOption(
    page.getByRole("combobox", { name: "New workflow repository" }),
    "webrenew/blackbox"
  );
  await expect(personalTemplate).toBeEnabled();
  await personalTemplate.click();

  await expect
    .poll(() => flowCreatePayloads[0]?.personal_template_id)
    .toBe("template-strict-review");
  expect(flowCreatePayloads[0]?.repo_full_name).toBe("webrenew/blackbox");

  await page.getByRole("button", { name: "New workflow" }).click();
  await page.getByTestId("flow-save-personal-template").click();
  const dialog = page.getByTestId("flow-save-template-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Template name").fill("Critical repo review");
  await page.getByTestId("flow-save-template-submit").click();

  await expect
    .poll(() => templateCreatePayloads[0]?.name)
    .toBe("Critical repo review");
  expect(templateCreatePayloads[0]?.flow_id).toBe("flow-1");

  await page
    .getByRole("button", { name: "Delete Critical repo review template" })
    .click();
  await page.getByRole("button", { name: "Delete template" }).click();
  await expect(
    page.getByRole("button", { name: "Delete Critical repo review template" })
  ).toHaveCount(0);
  const deletionToast = page
    .locator("li[class*='destructive']")
    .filter({ hasText: "Template deleted" });
  await expect(deletionToast).toBeVisible();
  await expect(deletionToast).toContainText(
    '"Critical repo review" was permanently deleted.'
  );
});

test("team workflow templates are separated, reused, and saved in active team scope", async ({
  page,
}) => {
  const teamId = "11111111-2222-4333-8444-555555555555";
  const flowCreateRequests: Array<{
    payload: Record<string, unknown>;
    teamId: string | undefined;
  }> = [];
  const templateCreates: Array<{
    payload: Record<string, unknown>;
    scope: "personal" | "team";
  }> = [];

  await stubFlowsPage(page, {
    teamId,
    personalTemplates: [
      {
        id: "template-personal",
        name: "My review",
        description: "Personal baseline",
        trigger_event: "pr_opened",
        reconnect: [],
        requires_repository: false,
      },
    ],
    teamTemplates: [
      {
        id: "template-team",
        name: "Team release gate",
        description: "Shared release checks",
        trigger_event: "pr_opened",
        reconnect: ["agent"],
        requires_repository: false,
      },
    ],
    onFlowCreate: (payload) => {
      flowCreateRequests.push({ payload, teamId: undefined });
    },
    onTemplateCreate: (payload, scope) => {
      templateCreates.push({ payload, scope });
    },
  });
  await page.route("**/api/flows", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    flowCreateRequests.push({
      payload: route.request().postDataJSON() as Record<string, unknown>,
      teamId: route.request().headers()["x-mogplex-team-id"],
    });
    await fulfillJson(
      route,
      {
        id: "flow-created",
        name: "Team release gate",
      },
      201
    );
  });

  await page.goto("/acme/workflows");
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "New workflow" }).click();
  const picker = page.getByTestId("flow-template-picker");
  await expect(picker).toContainText("Team templates");
  await expect(picker).toContainText("Your templates");
  const teamTemplate = page.getByTestId("flow-team-template-template-team");
  await expect(teamTemplate).toContainText("Reconnect agent");
  await teamTemplate.click();

  await expect
    .poll(() => flowCreateRequests.at(-1)?.payload.team_template_id)
    .toBe("template-team");
  expect(flowCreateRequests.at(-1)?.teamId).toBe(teamId);

  await page.getByRole("button", { name: "New workflow" }).click();
  await page.getByTestId("flow-save-personal-template").click();
  const dialog = page.getByTestId("flow-save-template-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("flow-template-scope-team")).toBeChecked();
  await dialog.getByLabel("Template name").fill("Shared critical review");
  await page.getByTestId("flow-save-template-submit").click();

  await expect.poll(() => templateCreates.at(-1)?.scope).toBe("team");
  expect(templateCreates.at(-1)?.payload.name).toBe("Shared critical review");
});
