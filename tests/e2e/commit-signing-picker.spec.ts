import { test, expect, fulfillJson } from "./helpers/run-checks-fixtures";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import { toSandboxListRecord } from "../../lib/sandbox/collection/_lib/response-shaping";

const key = {
  available: true,
  configured: true,
  publicKey: "ssh-ed25519 public-test-key",
  fingerprint: "SHA256:picker",
  registered: true,
  registrationStatus: "registered",
};
function sandbox(id: string, repo: string, branch: string, status: string) {
  return toSandboxListRecord({
    id,
    repo_id: repo,
    user_id: "owner",
    sandbox_id: `provider-${id}`,
    base_branch: "main",
    working_branch: branch,
    status,
    preview_url: null,
    runtime: "node22",
    health_status: "running",
    repos: { full_name: repo },
    created_at: "2026-11-17T00:00:00Z",
    last_active_at: "2026-11-17T00:00:00Z",
  });
}
const running = sandbox(
  "00000000-0000-4000-8000-000000000001",
  "acme/widgets",
  "feature/search",
  "running"
);
const paused = sandbox(
  "00000000-0000-4000-8000-000000000002",
  "acme/widgets",
  "fix/signing",
  "paused"
);
const release = sandbox(
  "00000000-0000-4000-8000-000000000003",
  "acme/dashboard",
  "release/ready",
  "creating"
);
release.root_directory = "apps/web";
const history = [
  sandbox(
    "00000000-0000-4000-8000-000000000004",
    "acme/widgets",
    "hidden-stopped",
    "stopped"
  ),
  sandbox(
    "00000000-0000-4000-8000-000000000005",
    "acme/widgets",
    "hidden-error",
    "error"
  ),
];

test.beforeEach(async ({ page }) => {
  await enableScopedE2EAuth(page);
  await page.route("**/api/settings/commit-signing", (route) =>
    fulfillJson(route, key)
  );
});

test("searches repository and branch, excludes historical sandboxes, and supports keyboard selection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/sandbox", (route) =>
    fulfillJson(route, { sandboxes: [running, paused, release, ...history] })
  );
  let checkedId: string | undefined;
  let finishCheck!: () => void;
  const checkPending = new Promise<void>((resolve) => {
    finishCheck = resolve;
  });
  await page.route("**/api/sandbox/*/commit-signing", async (route) => {
    checkedId = route.request().url().split("/").at(-2);
    await checkPending;
    await fulfillJson(route, {
      status: "paused",
      message: "Resume this sandbox before verifying signing.",
    });
  });
  await page.goto(scopedPath("settings/commit-signing"));
  await page
    .getByRole("button", { name: "Verify signing", exact: true })
    .click();
  const picker = page.getByRole("combobox", {
    name: "Sandbox to check",
    exact: true,
  });
  await picker.click();
  const search = page.getByRole("combobox", {
    name: "Search sandboxes",
    exact: true,
  });
  await expect(search).toBeFocused();
  await expect(page.getByRole("option")).toHaveCount(3);
  await expect(page.getByRole("option", { name: /hidden-/ })).toHaveCount(0);
  await search.fill("WIDGETS");
  await expect(page.getByRole("option")).toHaveCount(2);
  await search.press("ArrowDown");
  await expect(
    page.getByRole("option", { selected: true })
  ).toHaveAccessibleName("acme/widgets · fix/signing · Paused");
  await search.fill("RELEASE/READY");
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.getByRole("option")).toHaveAccessibleName(
    "acme/dashboard · release/ready · apps/web · Creating"
  );
  await search.fill("apps/web");
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.getByRole("option")).toHaveAccessibleName(
    "acme/dashboard · release/ready · apps/web · Creating"
  );
  await search.fill("widgets fix/signing");
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.getByRole("dialog", { name: "Sandbox choices" })).toHaveCSS(
    "opacity",
    "1"
  );
  await page.screenshot({
    path: test.info().outputPath("sandbox-search-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  const bounds = await page
    .getByRole("dialog", { name: "Sandbox choices" })
    .boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await search.press("Enter");
  await expect(search).toHaveCount(0);
  await expect(picker).toBeFocused();
  await expect(picker).toContainText("fix/signing");
  await page.getByRole("button", { name: "Verify selected sandbox" }).click();
  await expect(picker).toBeDisabled();
  finishCheck();
  await expect(
    page.getByText("Resume this sandbox before verifying signing.", {
      exact: true,
    })
  ).toBeVisible();
  expect(checkedId).toBe(paused.id);
  await picker.click();
  await expect(search).toHaveValue("");
  await search.fill("hidden");
  await expect(page.getByText("No sandboxes match your search.")).toBeVisible();
  await expect(page.getByRole("option")).toHaveCount(0);
  await search.press("Escape");
  await expect(picker).toBeFocused();
  await expect(picker).toContainText("fix/signing");
  await page.setViewportSize({ width: 1280, height: 900 });
  await picker.click();
  await expect(page.getByRole("dialog", { name: "Sandbox choices" })).toHaveCSS(
    "opacity",
    "1"
  );
  await page.screenshot({
    path: test.info().outputPath("sandbox-search-desktop.png"),
    fullPage: true,
  });
});

for (const sandboxes of [[], history]) {
  test(`explains an empty eligible list with ${sandboxes.length} historical records`, async ({
    page,
  }) => {
    await page.route("**/api/sandbox", (route) =>
      fulfillJson(route, { sandboxes })
    );
    await page.goto(scopedPath("settings/commit-signing"));
    await page
      .getByRole("button", { name: "Verify signing", exact: true })
      .click();
    await expect(
      page.getByText(
        "No available sandboxes. Launch a sandbox from a repository to verify signing."
      )
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Sandbox to check" })
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Verify selected sandbox" })
    ).toHaveCount(0);
  });
}

test("a selected sandbox that stops after refresh cannot be verified or retain a visible receipt", async ({
  page,
}) => {
  await page.clock.install();
  let sandboxes = [running, paused];
  await page.route("**/api/sandbox", (route) =>
    fulfillJson(route, { sandboxes })
  );
  await page.route("**/api/sandbox/*/commit-signing", (route) =>
    fulfillJson(route, {
      status: "verified",
      message: "This sandbox signed and verified a test commit.",
      fingerprint: key.fingerprint,
    })
  );
  await page.goto(scopedPath("settings/commit-signing"));
  await page
    .getByRole("button", { name: "Verify signing", exact: true })
    .click();
  const picker = page.getByRole("combobox", {
    name: "Sandbox to check",
    exact: true,
  });
  await picker.click();
  await page
    .getByRole("option", {
      name: "acme/widgets · feature/search · Running",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Verify selected sandbox" }).click();
  await expect(
    page.getByText("Verified in the selected sandbox", { exact: true })
  ).toBeVisible();
  sandboxes = [
    {
      ...running,
      runtime_summary: { ...running.runtime_summary, status: "stopped" },
    },
    paused,
  ];
  // Advance SWR's focus throttle and deduplication windows without a real sleep.
  await page.clock.fastForward(6000);
  const refreshed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/sandbox") && response.status() === 200
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await refreshed;
  await expect(picker).toContainText("Choose a sandbox");
  await expect(
    page.getByRole("button", { name: "Verify selected sandbox" })
  ).toBeDisabled();
  await expect(
    page.getByText("Verified in the selected sandbox", { exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByText("This sandbox signed and verified a test commit.", {
      exact: true,
    })
  ).toHaveCount(0);
  await picker.click();
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.getByRole("option")).toHaveAccessibleName(
    "acme/widgets · fix/signing · Paused"
  );
});
