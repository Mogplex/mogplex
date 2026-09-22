import { expect, test, fulfillJson } from "./helpers/run-checks-fixtures";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import type { Page } from "@playwright/test";
import type { McpServer } from "@/components/settings/mcp-servers/types";
import { readToolPolicy, toolApproval } from "@/lib/mcp-servers/policy";
import type { DiagnosticCode } from "@/lib/mcp-servers/diagnostic-result";

async function setup(page: Page, extra: Record<string, unknown> = {}) {
  await enableScopedE2EAuth(page);
  let server: McpServer = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Documentation",
    enabled: true,
    transport: "http",
    command: null,
    args: [],
    envPlain: {},
    envSecretNames: [],
    url: "https://docs.example.com/mcp",
    headerPlain: {},
    headerSecretNames: ["Authorization"],
    extra,
    createdAt: "2026-09-22T01:00:00Z",
    updatedAt: "2026-09-22T01:00:00Z",
  };
  const saved: Record<string, unknown>[] = [];
  let testCount = 0;
  await page.route("**/api/mcp-servers", (route) =>
    fulfillJson(route, { servers: [server] })
  );
  await page.route(`**/api/mcp-servers/${server.id}`, async (route) => {
    const body = route.request().postDataJSON();
    saved.push(body);
    server = {
      ...server,
      ...body,
      updatedAt: new Date(Date.parse(server.updatedAt) + 1000).toISOString(),
    };
    await fulfillJson(route, { server });
  });
  await page.route(`**/api/mcp-servers/${server.id}/test`, async (route) => {
    testCount++;
    const policy = readToolPolicy(server.extra);
    await fulfillJson(route, {
      status: "success",
      enabled: server.enabled,
      checkedAt: new Date().toISOString(),
      serverUpdatedAt: server.updatedAt,
      tools: ["search", "publish", "delete"].map((name) => ({
        name,
        approval: toolApproval(policy, name),
      })),
    });
  });
  await page.goto(scopedPath("connections?tab=mcp"));
  return { saved, testCount: () => testCount };
}

test("tests saved connections on demand and edits approval rules without losing saved restrictions or secrets", async ({
  page,
}) => {
  const fixture = await setup(page, {
    cwd: "/repo",
    disabled_tools: ["delete"],
    tools: { publish: { approval_mode: "prompt", custom: 17 } },
  });
  await expect(page.getByText("Not tested in this visit.")).toBeVisible();
  expect(fixture.testCount()).toBe(0);
  await page
    .getByRole("button", { name: "Test connection", exact: true })
    .click();
  await expect(
    page.getByText("Connection test passed. 3 tools found.")
  ).toBeVisible();
  await expect(
    page.getByText(
      "1 available in workspace chat. Control approval required: 1. Blocked: 1."
    )
  ).toBeVisible();
  await page.getByText("Discovered tools", { exact: true }).click();
  await expect(
    page.getByText("publish: Control only: approval required")
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByPlaceholder("Overwrite saved secret")).toHaveValue("");
  await page
    .getByRole("combobox", { name: "Default approval", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Ask in Control", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Approval for search", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Run automatically", exact: true })
    .click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Not tested in this visit.")).toBeVisible();
  expect(fixture.saved[0]).toMatchObject({
    headerSecrets: {},
    extra: {
      cwd: "/repo",
      disabled_tools: ["delete"],
      default_tools_approval_mode: "prompt",
      tools: {
        publish: { approval_mode: "prompt", custom: 17 },
        search: { approval_mode: "auto" },
      },
    },
  });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Default approval", exact: true })
  ).toHaveText("Ask in Control");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.reload();
  await expect(page.getByText("Not tested in this visit.")).toBeVisible();
  expect(fixture.testCount()).toBe(1);
});

test("allowlist editing supports keyboard newlines and never makes an empty allowlist permissive", async ({
  page,
}) => {
  const fixture = await setup(page);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("switch", { name: "Allow all tools unless blocked" })
    .click();
  await expect(
    page.getByLabel("Allowed tools (one name per line)")
  ).toHaveValue("");
  await page.getByRole("button", { name: "Save changes" }).click();
  expect(fixture.saved[0]).toMatchObject({ extra: { enabled_tools: [] } });
  await page
    .getByRole("button", { name: "Test connection", exact: true })
    .click();
  await expect(
    page.getByText(
      "0 available in workspace chat. Control approval required: 0. Blocked: 3."
    )
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const allowed = page.getByLabel("Allowed tools (one name per line)");
  await allowed.fill("search");
  await allowed.press("End");
  await allowed.press("Enter");
  await allowed.pressSequentially("publish");
  await expect(allowed).toHaveValue("search\npublish");
  await allowed.fill(" search \nsearch\n \npublish ");
  await page
    .getByLabel("Blocked tools (one name per line)")
    .fill(" publish \n\npublish");
  await page.getByRole("button", { name: "Save changes" }).click();
  expect(fixture.saved[1]).toMatchObject({
    extra: {
      enabled_tools: ["search", "publish"],
      disabled_tools: ["publish"],
    },
  });
});

test("invalid saved permissions stay blocked and can be repaired without changing CLI settings", async ({
  page,
}) => {
  const fixture = await setup(page, { cwd: "/repo", enabled_tools: "all" });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Tool permissions are invalid"
  );
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByText("Correct the tool permissions before saving.")
  ).toBeVisible();
  expect(fixture.saved).toHaveLength(0);
  await page
    .getByLabel("Extra JSON", { exact: true })
    .fill('{"cwd":"/repo","enabled_tools":[]}');
  await page.getByRole("button", { name: "Save changes" }).click();
  expect(fixture.saved[0]).toMatchObject({
    extra: { cwd: "/repo", enabled_tools: [] },
  });
});

test("shows pending, failure and retry states without automatic tests", async ({
  page,
}) => {
  await setup(page);
  let resolveTest!: () => void;
  const responseReady = new Promise<void>((resolve) => {
    resolveTest = resolve;
  });
  let calls = 0;
  await page.route("**/api/mcp-servers/*/test", async (route) => {
    calls++;
    await responseReady;
    await fulfillJson(route, {
      status: "error",
      code: "authentication" satisfies DiagnosticCode,
      checkedAt: new Date().toISOString(),
      serverUpdatedAt: "2026-09-22T01:00:00Z",
    });
  });
  await page
    .getByRole("button", { name: "Test connection", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Testing connection..." })
  ).toBeDisabled();
  resolveTest();
  await expect(
    page.getByText(
      "The server rejected access. Check the saved authorization header and its permissions."
    )
  ).toBeVisible();
  expect(calls).toBe(1);
  await page
    .getByRole("button", { name: "Test connection", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Test connection", exact: true })
  ).toBeEnabled();
  expect(calls).toBe(2);
});

test("lets users add and remove tool approval overrides, and preserves disabled rules", async ({
  page,
}) => {
  const fixture = await setup(page, {
    tools: { search: { enabled: false, custom: true } },
  });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("switch", { name: "Enable search" }).click();
  await page.getByLabel("Tool name for approval override").fill("publish");
  await page.getByRole("button", { name: "Add tool rule" }).click();
  await page.getByRole("combobox", { name: "Approval for publish" }).click();
  await page.getByRole("option", { name: "Block", exact: true }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  expect(fixture.saved[0]).toMatchObject({
    extra: {
      tools: {
        search: { enabled: true, custom: true },
        publish: { approval_mode: "deny" },
      },
    },
  });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("combobox", { name: "Approval for publish" }).click();
  await page.getByRole("option", { name: "Use default", exact: true }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  expect(
    (fixture.saved[1].extra as { tools: { publish: object } }).tools.publish
  ).toEqual({});
});

for (const variant of [
  { name: "desktop-light", theme: "light", width: 1440, height: 1000 },
  { name: "desktop-dark", theme: "dark", width: 1440, height: 1000 },
  { name: "mobile-dark", theme: "dark", width: 390, height: 844 },
] as const) {
  test(`permissions and diagnostics remain usable in ${variant.name}`, async ({
    page,
  }) => {
    await page.setViewportSize({
      width: variant.width,
      height: variant.height,
    });
    await page.addInitScript(
      (theme) => localStorage.setItem("mogplex-theme", theme),
      variant.theme
    );
    await page.emulateMedia({ colorScheme: variant.theme });
    await page.route(/\/api\/settings(?:\?.*)?$/, (route) =>
      fulfillJson(route, { theme: variant.theme })
    );
    await setup(page, { default_tools_approval_mode: "prompt" });
    await expect(page.locator("html")).toHaveClass(
      new RegExp(`(^| )${variant.theme}( |$)`)
    );
    await page
      .getByRole("button", { name: "Test connection", exact: true })
      .click();
    await expect(
      page.getByText("Connection test passed. 3 tools found.")
    ).toBeVisible();
    await expect(page.locator("html")).toHaveClass(
      new RegExp(`(^| )${variant.theme}( |$)`)
    );
    await page.screenshot({
      path: `/tmp/mcp-controls-${variant.name}-diagnostics.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Default approval", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("combobox", { name: "Default approval", exact: true })
    ).toHaveText("Ask in Control");
    expect(
      await page
        .getByRole("dialog")
        .evaluate((element) => element.scrollWidth <= element.clientWidth)
    ).toBe(true);
    await page.screenshot({
      path: `/tmp/mcp-controls-${variant.name}-permissions.png`,
    });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
  });
}

test("reports disabled and empty servers without promising tools are available", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/mcp-servers/*/test", (route) =>
    fulfillJson(route, {
      status: "success",
      enabled: false,
      tools: [],
      checkedAt: new Date().toISOString(),
      serverUpdatedAt: "2026-09-22T01:00:00Z",
    })
  );
  await page
    .getByRole("button", { name: "Test connection", exact: true })
    .click();
  await expect(
    page.getByText("Connection test passed. 0 tools found.")
  ).toBeVisible();
  await expect(
    page.getByText(
      "This server is disabled. Enable it to make its allowed tools available."
    )
  ).toBeVisible();
  await expect(
    page.getByText("The server did not advertise any tools.")
  ).toBeVisible();
});

test("handles unavailable, malformed, and stale test responses without displaying a success", async ({
  page,
}) => {
  await setup(page);
  for (const scenario of [
    { status: 401, body: {}, text: "Sign in again to test this connection." },
    {
      status: 404,
      body: {},
      text: "This server no longer exists. Refresh the page.",
    },
    { status: 503, body: {}, text: "The test could not complete. Try again." },
    {
      status: 200,
      body: { status: "success", tools: "invalid" },
      text: "The test could not complete. Check your connection and try again.",
    },
    {
      status: 200,
      body: {
        status: "success",
        tools: [],
        enabled: true,
        checkedAt: new Date().toISOString(),
        serverUpdatedAt: "2026-09-22T03:00:00Z",
      },
      text: "The saved settings changed. Refresh the page, then test again.",
    },
  ]) {
    await page.route("**/api/mcp-servers/*/test", (route) =>
      fulfillJson(route, scenario.body, scenario.status)
    );
    await page
      .getByRole("button", { name: "Test connection", exact: true })
      .click();
    await expect(page.getByText(scenario.text, { exact: true })).toBeVisible();
    await expect(page.getByText(/Connection test passed/)).toHaveCount(0);
  }
});
