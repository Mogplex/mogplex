import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
} from "./helpers/automation-control-plane-fixtures";

test("new mission validates and creates an org-scoped project before starting", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );

  let createdRepo: {
    id: string;
    full_name: string;
    owner: string;
    name: string;
    default_branch: string;
  } | null = null;
  await page.route("**/api/repos", (route) =>
    fulfillJson(route, createdRepo ? [createdRepo] : [])
  );
  await page.route("**/api/github/owners", (route) =>
    fulfillJson(route, [
      {
        login: "alex",
        kind: "personal",
        github_installation_id: null,
        scope_label: "Personal",
        source: "oauth",
      },
      {
        login: "acme",
        kind: "org",
        github_installation_id: 42,
        scope_label: "Org",
        source: "oauth+installation",
      },
    ])
  );
  await page.route("**/api/github/repos/availability?**", (route) => {
    const url = new URL(route.request().url());
    const name = url.searchParams.get("name") || "";
    return fulfillJson(route, {
      availability: name === "taken" ? "taken" : "available",
      owner: url.searchParams.get("owner"),
      name,
    });
  });

  const repoCreates: Array<{ owner_login?: string; name?: string }> = [];
  await page.route("**/api/github/repos", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataJSON() as {
      owner_login?: string;
      name?: string;
    };
    repoCreates.push(body);
    createdRepo = {
      id: "repo-created",
      full_name: `${body.owner_login}/${body.name}`,
      owner: body.owner_login || "",
      name: body.name || "",
      default_branch: "main",
    };
    return fulfillJson(route, createdRepo);
  });

  const sessionCreates: Array<{
    title?: string;
    project?: string | null;
    repo_id?: string | null;
  }> = [];
  let sessionAttempts = 0;
  await page.route("**/api/control/sessions", (route) => {
    const request = route.request();
    if (request.method() !== "POST") return route.continue();
    sessionAttempts += 1;
    if (sessionAttempts === 1) {
      return fulfillJson(route, { error: "Temporary session failure" }, 500);
    }
    const body = request.postDataJSON() as (typeof sessionCreates)[number];
    sessionCreates.push(body);
    return fulfillJson(route, {
      id: "sess-created",
      title: body.title ?? "Session",
      project: body.project ?? null,
      repo_id: body.repo_id ?? null,
      pinned: false,
      archived: false,
      created_at: "2026-08-14T00:00:00.000Z",
      updated_at: "2026-08-14T00:00:00.000Z",
      messages: [],
    });
  });

  const chatRequests: Array<Record<string, unknown>> = [];
  await page.route("**/api/control/chat", (route) => {
    chatRequests.push(
      route.request().postDataJSON() as Record<string, unknown>
    );
    return route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body: 'data: {"type":"start"}\n\ndata: [DONE]\n\n',
    });
  });

  await page.goto(scopedPath("control"));
  await page.waitForLoadState("networkidle");
  await page
    .getByPlaceholder("Ask anything or run a command...")
    .fill("Rebuild the analytics dashboard");

  const ownerPicker = page.getByLabel("GitHub owner");
  await expect(ownerPicker).toBeVisible();
  await ownerPicker.click();
  await page.getByRole("option", { name: /acme.*Org/ }).click();

  const nameInput = page.getByLabel("New project name");
  await nameInput.fill("taken");
  await expect(page.getByText("acme/taken already exists.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start mission" })
  ).toBeDisabled();

  await nameInput.fill("Analytics / redesign 🚀");
  await expect(
    page.getByText("Will create as Analytics-redesign.")
  ).toBeVisible();
  await expect(
    page.getByText("acme/Analytics-redesign is available.")
  ).toBeVisible();
  await page.getByRole("button", { name: "Start mission" }).click();

  await expect.poll(() => repoCreates.length).toBe(1);
  await expect(
    page.getByText(
      "Repository created, but the mission could not start. Try again."
    )
  ).toBeVisible();
  await expect(
    page.getByText("Could not create the mission session. Please try again.")
  ).toHaveCount(0);
  await expect(page.getByText("acme/Analytics-redesign")).toBeVisible();
  await page.getByRole("button", { name: "Start mission" }).click();

  await expect.poll(() => sessionAttempts).toBe(2);
  expect(repoCreates).toHaveLength(1);
  await expect.poll(() => sessionCreates.length).toBe(1);
  await expect.poll(() => chatRequests.length).toBe(1);
  expect(repoCreates[0]).toEqual({
    owner_login: "acme",
    name: "Analytics-redesign",
  });
  expect(sessionCreates[0]).toMatchObject({
    project: "acme/Analytics-redesign",
    repo_id: "repo-created",
  });
  expect(chatRequests[0]).toMatchObject({
    conversationId: "sess-created",
    missionId: "sess-created",
    repoId: "repo-created",
    repoFullName: "acme/Analytics-redesign",
    repoOwner: "acme",
    repoName: "Analytics-redesign",
    repoBranch: "main",
    repoBaseBranch: "main",
  });
  expect(
    await page.evaluate(() =>
      window.localStorage.getItem("mogplex:last-github-repo-owner")
    )
  ).toBe("acme");
});

test("new project explains GitHub connection and org-scope requirements", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/repos", (route) => fulfillJson(route, []));
  await page.route("**/api/control/sessions**", (route) =>
    fulfillJson(route, [])
  );
  await page.route("**/api/github/owners", (route) => fulfillJson(route, []));

  await page.goto(scopedPath("control"));
  await expect(
    page.getByText("GitHub must be connected to create a project.")
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Connect GitHub" })
    // The signed-in connect route. /api/auth/login/github is the signup path
    // and bounces an existing account to /login/beta?error=waitlist_required.
  ).toHaveAttribute("href", /\/api\/auth\/github\?next=/);
  await expect(
    page.getByRole("button", { name: "Start mission" })
  ).toBeDisabled();

  await page.unroute("**/api/github/owners");
  await page.route("**/api/github/owners", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "x-mogplex-github-reauthorize": "read:org" },
      body: JSON.stringify([
        {
          login: "alex",
          kind: "personal",
          github_installation_id: null,
          scope_label: "Personal",
          source: "oauth",
        },
      ]),
    })
  );
  await page.reload();
  await expect(
    page.getByText("Reconnect GitHub to use organization accounts.")
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Reconnect GitHub" })
    // reauthorize=1 forces the OAuth grant, the only path that can add the
    // missing read:org scope where the GitHub App is configured.
  ).toHaveAttribute("href", /\/api\/auth\/github\?next=[^"]*reauthorize=1/);
});

test("new project remains actionable when availability auth expires", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/repos", (route) => fulfillJson(route, []));
  await page.route("**/api/control/sessions**", (route) =>
    fulfillJson(route, [])
  );
  await page.route("**/api/github/owners", (route) =>
    fulfillJson(route, [
      {
        login: "alex",
        kind: "personal",
        github_installation_id: null,
        scope_label: "Personal",
        source: "oauth",
      },
    ])
  );
  await page.route("**/api/github/repos/availability**", (route) =>
    fulfillJson(
      route,
      { availability: "invalid", error: "Connect GitHub account first" },
      400
    )
  );

  await page.goto(scopedPath("control"));
  await page
    .getByPlaceholder("Ask anything or run a command...")
    .fill("Ship account settings");
  await expect(
    page.getByText("Availability could not be verified. You can still try.")
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start mission" })
  ).toBeEnabled();
});

test("new project preserves the selected owner while switching projects", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/repos", (route) =>
    fulfillJson(route, [
      {
        id: "repo-1",
        full_name: "acme/widgets",
        owner: "acme",
        name: "widgets",
        default_branch: "main",
      },
    ])
  );
  await page.route("**/api/control/sessions**", (route) =>
    fulfillJson(route, [])
  );
  await page.route("**/api/github/owners", (route) =>
    fulfillJson(route, [
      {
        login: "alex",
        kind: "personal",
        github_installation_id: null,
        scope_label: "Personal",
        source: "oauth",
      },
      {
        login: "acme",
        kind: "org",
        github_installation_id: 42,
        scope_label: "Org",
        source: "oauth+installation",
      },
    ])
  );

  await page.goto(scopedPath("control"));
  const projectPicker = page.getByLabel("Project", { exact: true });
  await projectPicker.click();
  await page.getByRole("option", { name: "New project" }).click();
  const ownerPicker = page.getByLabel("GitHub owner");
  await ownerPicker.click();
  await page.getByRole("option", { name: /acme.*Org/ }).click();
  await projectPicker.click();
  await page.getByRole("option", { name: "acme/widgets" }).click();
  await projectPicker.click();
  await page.getByRole("option", { name: "New project" }).click();

  await expect(ownerPicker).toContainText("acme");
});
