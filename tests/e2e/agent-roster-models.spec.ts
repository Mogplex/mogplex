import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import { linkedVercelCapability } from "./helpers/activation-fixtures";
import type { Route } from "@playwright/test";
import type { Agent } from "../../lib/types";

const enabledModel = {
  id: "minimax/minimax-m2.7",
  provider: "minimax",
  name: "MiniMax M2.7",
  context_length: 1_000_000,
  capabilities: ["tool-use"],
  is_available: true,
};

const connectedUser = {
  id: "user-1",
  email: "alex@example.com",
  username: "alex",
  name: "Alex",
  avatar_url: "https://example.com/avatar.png",
  github_connected: true,
  github_app_connected: true,
  github_app_available: true,
  github_connection_mode: "app" as const,
  vercel: linkedVercelCapability,
};

async function fulfillJson(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
}

async function fulfillText(route: Route, body: string, status = 200) {
  await route.fulfill({
    status,
    contentType: "text/plain",
    body,
  });
}

test("new agents surface API validation errors instead of failing silently", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: connectedUser })
  );
  await page.route("**/api/settings", (route) =>
    fulfillJson(route, { default_model: enabledModel.id, theme: "dark" })
  );
  await page.route("**/api/agents", async (route) => {
    if (route.request().method() === "POST") {
      await fulfillJson(route, { error: "Server rejected payload" }, 400);
      return;
    }

    await fulfillJson(route, []);
  });
  await page.route("**/api/models", (route) =>
    fulfillJson(route, {
      models: [enabledModel],
      catalog: [{ ...enabledModel, is_enabled: true }],
    })
  );

  await page.goto(scopedPath("agents/roster"));
  await page.getByRole("button", { name: "New Agent" }).click();
  await page.locator("#agent-name-input").fill("PR Reviewer");
  const createButton = page.getByRole("button", { name: "Create Agent" });
  await expect(createButton).toBeDisabled();
  await page.getByLabel("Category").selectOption("code-review");
  await expect(createButton).toBeEnabled();
  await createButton.scrollIntoViewIfNeeded();
  await createButton.click();

  await expect(page.getByText("Server rejected payload")).toBeVisible();
});

test("roster uses standard categories and badges user-owned agent origin", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);

  const agents: Agent[] = [
    {
      id: "agent-custom",
      user_id: "user-1",
      name: "CUSTOM-REVIEWER",
      slug: "custom-reviewer",
      model: enabledModel.id,
      system_prompt: "Review code carefully.",
      description: "Reviews pull requests.",
      category: "code-review",
      source_template: null,
      is_preset: false,
      created_at: "2026-04-12T00:00:00.000Z",
    },
    {
      id: "agent-customized",
      user_id: "user-1",
      name: "CUSTOMIZED-REVIEWER",
      slug: "customized-reviewer",
      model: enabledModel.id,
      system_prompt: "Review code carefully.",
      description: "Reviews pull requests with template context.",
      category: "code-review",
      source_template: "NEXTJS-REVIEWER",
      is_preset: false,
      created_at: "2026-04-12T00:00:00.000Z",
    },
    {
      id: "agent-uncategorized",
      user_id: "user-1",
      name: "UNCATEGORIZED-REVIEWER",
      slug: "uncategorized-reviewer",
      model: enabledModel.id,
      system_prompt: "Review code carefully.",
      description: "Needs a category before reuse.",
      category: null,
      source_template: null,
      is_preset: false,
      created_at: "2026-04-12T00:00:00.000Z",
    },
  ];

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: connectedUser })
  );
  await page.route("**/api/settings", (route) =>
    fulfillJson(route, { default_model: enabledModel.id, theme: "dark" })
  );
  await page.route("**/api/agents", (route) => fulfillJson(route, agents));
  await page.route("**/api/models", (route) =>
    fulfillJson(route, {
      models: [enabledModel],
      catalog: [{ ...enabledModel, is_enabled: true }],
    })
  );

  await page.goto(scopedPath("agents/roster"));

  await expect(page.getByRole("tab", { name: /^Custom \(/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "PR Review" })).toBeVisible();
  await expect(
    page.getByRole("tab", { name: /^Needs Category \(1\)$/ })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Needs Category" })
  ).toBeVisible();
  await expect(page.getByText("Custom", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Customized", { exact: true })).toBeVisible();
  await expect(page.getByText("Needs category", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: /^PR Review \(2\)$/ }).click();
  await expect(page.getByText("CUSTOM-REVIEWER")).toBeVisible();
  await expect(page.getByText("CUSTOMIZED-REVIEWER")).toBeVisible();
  await expect(page.getByText("UNCATEGORIZED-REVIEWER")).not.toBeVisible();

  await page.getByRole("tab", { name: /^Needs Category \(1\)$/ }).click();
  await expect(page.getByText("UNCATEGORIZED-REVIEWER")).toBeVisible();
  await expect(page.getByText("CUSTOM-REVIEWER")).not.toBeVisible();

  await page.getByRole("tab", { name: /^All \(3\)$/ }).click();
  await page.getByLabel("Agent actions").last().click();
  await page.getByRole("menuitem", { name: "Edit" }).click();

  const saveButton = page.getByRole("button", { name: "Save" });
  await expect(page.getByLabel("Category", { exact: true })).toHaveValue("");
  await expect(saveButton).toBeDisabled();

  await page
    .getByLabel("Category", { exact: true })
    .selectOption("code-review");
  await expect(saveButton).toBeEnabled();
});

test("preset customization surfaces API failures", async ({ page }) => {
  await enableScopedE2EAuth(page);

  const agents: Agent[] = [
    {
      id: "preset:legacy-reviewer",
      user_id: "user-1",
      name: "LEGACY-REVIEWER",
      slug: "legacy-reviewer",
      model: enabledModel.id,
      system_prompt: "Review carefully.",
      description: "Preset reviewer.",
      category: "code-review",
      source_template: "LEGACY-REVIEWER",
      is_preset: true,
      has_fork: false,
      created_at: "1970-01-01T00:00:00.000Z",
    },
  ];

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: connectedUser })
  );
  await page.route("**/api/settings", (route) =>
    fulfillJson(route, { default_model: enabledModel.id, theme: "dark" })
  );
  await page.route("**/api/agents", async (route) => {
    if (route.request().method() === "POST") {
      await fulfillJson(route, { error: "Category is required" }, 400);
      return;
    }

    await fulfillJson(route, agents);
  });
  await page.route("**/api/models", (route) =>
    fulfillJson(route, {
      models: [enabledModel],
      catalog: [{ ...enabledModel, is_enabled: true }],
    })
  );

  await page.goto(scopedPath("agents/roster"));
  await page.getByRole("tab", { name: /^PR Review \(1\)$/ }).click();
  await page.getByRole("button", { name: "Customize" }).click();

  await expect(page.getByText("Category is required")).toBeVisible();
});

test("new agents can draft the panel fields with AI assistance", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);

  const existingAgentPayloads: Array<unknown> = [];
  let draftCallCount = 0;

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: connectedUser })
  );
  await page.route("**/api/settings", (route) =>
    fulfillJson(route, { default_model: enabledModel.id, theme: "dark" })
  );
  await page.route("**/api/agents", (route) => fulfillJson(route, []));
  await page.route("**/api/models", (route) =>
    fulfillJson(route, {
      models: [enabledModel],
      catalog: [{ ...enabledModel, is_enabled: true }],
    })
  );
  await page.route("**/api/agents/generate", async (route) => {
    draftCallCount += 1;
    const payload = route.request().postDataJSON() as {
      existingAgent?: unknown;
    };
    existingAgentPayloads.push(payload.existingAgent ?? null);

    await fulfillText(
      route,
      JSON.stringify(
        draftCallCount === 1
          ? {
              name: "PR-REVIEWER",
              description: "Reviews pull requests for release risk",
              category: "code-review",
              system_prompt:
                "You are a pull request reviewer specialized in release risk.\n\n## REVIEW FOCUS\n- Risk\n\n## OUTPUT FORMAT\n- Findings",
            }
          : {
              name: "PR-REVIEWER-V2",
              description: "Reviews pull requests for deployment safety",
              category: "code-review",
              system_prompt:
                "You are a pull request reviewer specialized in deployment safety.\n\n## REVIEW FOCUS\n- Safety\n\n## OUTPUT FORMAT\n- Findings",
            }
      )
    );
  });

  await page.goto(scopedPath("agents/roster"));
  await page.getByRole("button", { name: "New Agent" }).click();
  await page
    .getByLabel("AI request")
    .fill(
      "Create a PR review agent that flags risky migrations and weak test coverage."
    );
  await page.getByRole("button", { name: "Draft with AI" }).click();

  await expect(page.locator("#agent-name-input")).toHaveValue("PR-REVIEWER");
  await expect(page.locator("#agent-description-input")).toHaveValue(
    "Reviews pull requests for release risk"
  );
  await expect(page.getByLabel("Category")).toHaveValue("code-review");
  await expect(page.locator("#agent-system-prompt-input")).toContainText(
    "pull request reviewer specialized in release risk"
  );

  await page
    .getByLabel("AI request")
    .fill("Actually make this focus on deployment safety instead.");
  await page.getByRole("button", { name: "Draft with AI" }).click();

  await expect(page.locator("#agent-name-input")).toHaveValue("PR-REVIEWER-V2");
  await expect(page.locator("#agent-description-input")).toHaveValue(
    "Reviews pull requests for deployment safety"
  );
  await expect(page.locator("#agent-system-prompt-input")).toContainText(
    "pull request reviewer specialized in deployment safety"
  );
  await expect.poll(() => existingAgentPayloads).toEqual([null, null]);
});

test("AI assistance surfaces invalid draft output without breaking the dialog", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: connectedUser })
  );
  await page.route("**/api/settings", (route) =>
    fulfillJson(route, { default_model: enabledModel.id, theme: "dark" })
  );
  await page.route("**/api/agents", (route) => fulfillJson(route, []));
  await page.route("**/api/models", (route) =>
    fulfillJson(route, {
      models: [enabledModel],
      catalog: [{ ...enabledModel, is_enabled: true }],
    })
  );
  await page.route("**/api/agents/generate", async (route) => {
    await fulfillText(route, '{"name":"BROKEN"');
  });

  await page.goto(scopedPath("agents/roster"));
  await page.getByRole("button", { name: "New Agent" }).click();
  await page.getByLabel("AI request").fill("Create a PR review agent.");
  await page.getByRole("button", { name: "Draft with AI" }).click();

  await expect(
    page.getByText(
      "The model returned an invalid draft. Try again with a more specific request."
    )
  ).toBeVisible();
  await expect(page.locator("#agent-name-input")).toHaveValue("");
});

test("editing agents can customize the draft with AI context", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);

  let receivedExistingAgent: {
    name?: string;
    description?: string;
    category?: string;
    system_prompt?: string;
  } | null = null;
  const agents: Agent[] = [
    {
      id: "agent-1",
      user_id: "user-1",
      name: "REVIEWER-BOT",
      slug: "reviewer-bot",
      model: enabledModel.id,
      system_prompt: "Review code carefully.",
      description: "Reviews pull requests.",
      category: "code-review",
      created_at: "2026-04-12T00:00:00.000Z",
    },
  ];

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: connectedUser })
  );
  await page.route("**/api/settings", (route) =>
    fulfillJson(route, { default_model: enabledModel.id, theme: "dark" })
  );
  await page.route("**/api/agents", (route) => fulfillJson(route, agents));
  await page.route("**/api/models", (route) =>
    fulfillJson(route, {
      models: [enabledModel],
      catalog: [{ ...enabledModel, is_enabled: true }],
    })
  );
  await page.route("**/api/agents/generate", async (route) => {
    const payload = route.request().postDataJSON() as {
      existingAgent?: {
        name?: string;
        description?: string;
        category?: string;
        system_prompt?: string;
      };
    };
    receivedExistingAgent = payload.existingAgent ?? null;

    await fulfillText(
      route,
      JSON.stringify({
        name: "REVIEWER-BOT",
        description: "Reviews pull requests for rollout and caching risk",
        category: "code-review",
        system_prompt:
          "You are a pull request reviewer specialized in rollout and caching risk.\n\n## REVIEW FOCUS\n- Rollout safety\n- Caching\n\n## OUTPUT FORMAT\n- Findings",
      })
    );
  });

  await page.goto(scopedPath("agents/roster"));
  await page.getByLabel("Agent actions").first().click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await page
    .getByLabel("AI request")
    .fill(
      "Make this stricter on rollout safety and Next.js caching regressions."
    );
  await page.getByRole("button", { name: "Update with AI" }).click();

  await expect
    .poll(() => receivedExistingAgent)
    .toEqual({
      name: "REVIEWER-BOT",
      description: "Reviews pull requests.",
      category: "code-review",
    });
  await expect(page.locator("#agent-description-input")).toHaveValue(
    "Reviews pull requests for rollout and caching risk"
  );
  await expect(page.locator("#agent-system-prompt-input")).toContainText(
    "rollout and caching risk"
  );
});
