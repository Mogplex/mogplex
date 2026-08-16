import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
} from "./helpers/automation-control-plane-fixtures";

const GITHUB_REAUTHORIZE_HEADER = "x-mogplex-github-reauthorize";

/** Composer with no repos, so it opens straight onto the new-project controls. */
async function openComposer(
  page: import("@playwright/test").Page,
  options: { missingOrgScope?: boolean } = {}
) {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/repos", (route) => fulfillJson(route, []));
  await page.route("**/api/github/owners", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: options.missingOrgScope
        ? { [GITHUB_REAUTHORIZE_HEADER]: "read:org" }
        : {},
      body: JSON.stringify([
        {
          login: "charlesrhoward",
          kind: "personal",
          github_installation_id: null,
          scope_label: "Person",
          source: "oauth",
        },
      ]),
    })
  );
  await page.route("**/api/github/repos/availability?**", (route) =>
    fulfillJson(route, { availability: "available" })
  );
  await page.goto(scopedPath("/control"));
  await page.waitForLoadState("networkidle");
  await expect(page.getByLabel("GitHub owner")).toBeVisible();
}

test("new-project controls sit on one aligned row", async ({ page }) => {
  await openComposer(page);

  const boxes = await page.evaluate(() => {
    const rect = (selector: string) => {
      const el = document.querySelector<HTMLElement>(selector);
      return el ? el.getBoundingClientRect() : null;
    };
    return {
      project: rect('[aria-label="Project"]'),
      owner: rect('[aria-label="GitHub owner"]'),
      name: rect('[aria-label="New project name"]'),
    };
  });

  expect(boxes.project).not.toBeNull();
  expect(boxes.owner).not.toBeNull();
  expect(boxes.name).not.toBeNull();

  // The status line used to live inside the new-project block, making it taller
  // than the project select; centring then pushed the select out of line.
  const centre = (b: { top: number; height: number }) => b.top + b.height / 2;
  expect(centre(boxes.owner!)).toBeCloseTo(centre(boxes.project!), 0);
  expect(centre(boxes.name!)).toBeCloseTo(centre(boxes.project!), 0);
  expect(boxes.owner!.height).toBeCloseTo(boxes.project!.height, 0);
  expect(boxes.name!.height).toBeCloseTo(boxes.project!.height, 0);
});

test("reconnect GitHub points at the signed-in connect route, not the waitlist gate", async ({
  page,
}) => {
  await openComposer(page, { missingOrgScope: true });

  const link = page.getByRole("link", { name: "Reconnect GitHub" });
  await expect(link).toBeVisible();

  const href = await link.getAttribute("href");
  // The signup route (/api/auth/login/github) is behind the legacy access-code
  // gate and bounces an existing account to /login/beta?error=waitlist_required.
  expect(href).not.toContain("/api/auth/login/github");
  expect(href).toContain("/api/auth/github?");
  // Only the OAuth grant can add the missing read:org scope.
  expect(href).toContain("reauthorize=1");
  expect(href).toContain(`next=${encodeURIComponent(scopedPath("/control"))}`);

  // The status message starts at the left edge of the project row rather than
  // hanging off the owner select.
  const offsets = await page.evaluate(() => {
    const row = document.querySelector<HTMLElement>(
      '[data-testid="control-project-row"]'
    );
    const message = document.querySelector<HTMLElement>('[aria-live="polite"]');
    if (!row || !message) return null;
    return {
      rowLeft: row.getBoundingClientRect().left,
      messageLeft: message.getBoundingClientRect().left,
      messageTop: message.getBoundingClientRect().top,
      rowBottom: row.getBoundingClientRect().bottom,
    };
  });
  expect(offsets).not.toBeNull();
  expect(offsets!.messageLeft).toBeLessThanOrEqual(offsets!.rowLeft + 1);
  expect(offsets!.messageTop).toBeGreaterThanOrEqual(offsets!.rowBottom - 1);
});

test("the signed-in connect route never lands on the legacy access-code gate", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);

  // Follow the redirect without completing the GitHub round trip: what matters
  // is that a signed-in user is not bounced to /login/beta.
  const response = await page.request.get(
    `/api/auth/github?next=${encodeURIComponent(scopedPath("/control"))}&reauthorize=1`,
    { maxRedirects: 0 }
  );
  expect([302, 303, 307]).toContain(response.status());
  const location = response.headers()["location"] ?? "";
  expect(location).not.toContain("/login/beta");
  expect(location).not.toContain("waitlist_required");
  expect(location).toContain("github.com/login/oauth/authorize");
  expect(decodeURIComponent(location)).toContain("read:org");
});
