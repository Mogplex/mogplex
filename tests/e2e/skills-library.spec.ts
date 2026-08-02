import { expect, test } from "@playwright/test";
import { enableE2EAuth } from "./helpers/auth";
import { linkedVercelCapability } from "./helpers/activation-fixtures";
import { GLOBAL_SKILL_SCOPE, type SkillScope } from "@/lib/skills";
import type { Route } from "@playwright/test";

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

type SkillRecord = {
  id: string;
  name: string;
  description: string | null;
  scope: SkillScope;
  content: string;
  is_public: boolean;
  tags: string[];
  usage_count: number;
  created_at: string;
};

type SaveSkillPayload = Omit<
  SkillRecord,
  "id" | "scope" | "tags" | "usage_count" | "created_at"
> & {
  scope?: SkillScope;
};

async function fulfillJson(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
}

test("registry install saves the skill and takes the user to the installed list", async ({
  page,
}) => {
  const skills: SkillRecord[] = [
    {
      id: "project-skill-1",
      name: "Project Review",
      description: "Project-specific review guidance",
      scope: "project",
      content: "# Project Review",
      is_public: false,
      tags: [],
      usage_count: 0,
      created_at: new Date().toISOString(),
    },
  ];

  await enableE2EAuth(page);

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: connectedUser })
  );
  await page.route("**/api/skills/registry/acme/toolbox/review-bot", (route) =>
    fulfillJson(route, {
      name: "Review Bot",
      description: "Review incoming pull requests",
      installs: 42,
      source: "acme/toolbox",
      content: "# Review Bot\nReview incoming pull requests.",
      installCommand: "npx skills add acme/toolbox --skill review-bot",
      audited: true,
    })
  );
  await page.route("**/api/skills/registry*", async (route) => {
    if (
      route
        .request()
        .url()
        .includes("/api/skills/registry/acme/toolbox/review-bot")
    ) {
      await route.fallback();
      return;
    }
    await fulfillJson(route, {
      skills: [
        {
          id: "acme/toolbox/review-bot",
          skillId: "review-bot",
          name: "Review Bot",
          source: "acme/toolbox",
          installs: 42,
          description: "Review incoming pull requests",
        },
      ],
    });
  });
  await page.route("**/api/skills**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());

    if (
      url.pathname.startsWith("/api/skills/registry") ||
      url.pathname.startsWith("/api/skills/vercel-docs")
    ) {
      await route.fallback();
      return;
    }

    if (req.method() === "GET") {
      const q = url.searchParams.get("q")?.toLowerCase();
      const filtered = q
        ? skills.filter((skill) => skill.name.toLowerCase().includes(q))
        : skills;
      await fulfillJson(route, filtered);
      return;
    }

    if (req.method() === "POST") {
      const payload = req.postDataJSON() as SaveSkillPayload;
      const saved: SkillRecord = {
        id: `skill-${skills.length + 1}`,
        name: payload.name,
        description: payload.description ?? null,
        scope: payload.scope ?? GLOBAL_SKILL_SCOPE,
        content: payload.content,
        is_public: payload.is_public,
        tags: [],
        usage_count: 0,
        created_at: new Date().toISOString(),
      };
      skills.push(saved);
      await fulfillJson(route, saved);
      return;
    }

    await route.abort();
  });

  await page.goto("/primitives?tab=skills");
  await page.waitForLoadState("networkidle");

  await page
    .getByRole("button", { name: "Install", exact: true })
    .first()
    .click();

  await expect(
    page.getByText("Skill installed", { exact: true })
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "Installed (2)" })).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Installed (2)" })
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByText("Review Bot", { exact: true }).first()
  ).toBeVisible();
  await expect(page.getByText("Scope: Global", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Scope: Project-specific", { exact: true })
  ).toBeVisible();
});
