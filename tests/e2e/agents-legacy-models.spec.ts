import { expect, test } from "@playwright/test";
import { enableE2EAuth } from "./helpers/auth";
import { linkedVercelCapability } from "./helpers/activation-fixtures";
import type { Route } from "@playwright/test";
import type { Agent } from "../../lib/types";

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

test("agents page highlights legacy hidden models and supports quick replacement", async ({
  page,
}) => {
  await enableE2EAuth(page);

  let agents: Agent[] = [
    {
      id: "agent-legacy",
      user_id: "user-1",
      name: "Legacy Reviewer",
      slug: "legacy-reviewer",
      model: "openai/o1",
      system_prompt: "Review code carefully.",
      description: "Reviews pull requests.",
      category: "code-review",
      is_preset: false,
      created_at: "2026-03-30T00:00:00.000Z",
    },
  ];

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: connectedUser })
  );
  await page.route("**/api/settings", (route) =>
    fulfillJson(route, { default_model: "minimax/minimax-m2.5", theme: "dark" })
  );
  await page.route("**/api/models", (route) =>
    fulfillJson(route, {
      models: [
        {
          id: "minimax/minimax-m2.5",
          provider: "minimax",
          name: "MiniMax M2.5",
          context_length: 200000,
          capabilities: ["text"],
          is_available: true,
          is_hidden: false,
        },
        {
          id: "openai/gpt-5.4",
          provider: "openai",
          name: "GPT-5.4",
          context_length: 200000,
          capabilities: ["text"],
          is_available: true,
          is_hidden: false,
        },
      ],
      catalog: [
        {
          id: "minimax/minimax-m2.5",
          provider: "minimax",
          name: "MiniMax M2.5",
          context_length: 200000,
          capabilities: ["text"],
          is_available: true,
          is_hidden: false,
          is_enabled: true,
        },
        {
          id: "openai/gpt-5.4",
          provider: "openai",
          name: "GPT-5.4",
          context_length: 200000,
          capabilities: ["text"],
          is_available: true,
          is_hidden: false,
          is_enabled: true,
        },
        {
          id: "openai/o1",
          provider: "openai",
          name: "OpenAI o1",
          context_length: 200000,
          capabilities: ["text"],
          is_available: true,
          is_hidden: true,
          is_enabled: true,
        },
      ],
    })
  );
  await page.route("**/api/agents", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, agents);
      return;
    }

    if (route.request().method() === "PUT") {
      const payload = route.request().postDataJSON() as {
        id: string;
        model: string;
        name: string;
        description?: string | null;
        system_prompt?: string | null;
        category?: string | null;
      };
      agents = agents.map((agent) =>
        agent.id === payload.id ? { ...agent, ...payload } : agent
      );
      await fulfillJson(route, { ok: true });
      return;
    }

    await fulfillJson(route, { ok: true });
  });

  await page.goto("/agents");
  await page.waitForLoadState("networkidle");

  await expect(page.getByText("Legacy model").first()).toBeVisible();
  await page.getByLabel("Agent actions").first().click();
  await page.getByRole("menuitem", { name: "Edit" }).click();

  await expect(page.getByTestId("agents-legacy-model-warning")).toBeVisible();
  await expect(page.getByLabel("Model")).toHaveValue("openai/o1");

  await page.getByTestId("agents-legacy-model-replace").click();
  await expect(page.getByLabel("Model")).toHaveValue("minimax/minimax-m2.5");
  await expect(page.locator('select option[value="openai/o1"]')).toHaveCount(0);

  await page.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => agents[0]?.model).toBe("minimax/minimax-m2.5");
});
