import type { Page } from "@playwright/test";

const E2E_AUTH_HEADER = "x-mogplex-e2e-auth";
const E2E_USER_ID_HEADER = "x-mogplex-e2e-user-id";
const E2E_AUTH_SECRET = "playwright-auth-bypass";

export async function enableE2EAuth(page: Page) {
  await page.context().setExtraHTTPHeaders({
    [E2E_AUTH_HEADER]: E2E_AUTH_SECRET,
  });
}

export function buildE2EAuthHeaders(userId = "user-1") {
  return {
    [E2E_AUTH_HEADER]: E2E_AUTH_SECRET,
    [E2E_USER_ID_HEADER]: userId,
    "x-delegated-user-id": userId,
  };
}

/**
 * The scoped layout resolves this id against the database, so it has to be a
 * real uuid -- `"user-1"` makes the server component render blow up.
 */
export const E2E_SCOPE_USER = {
  id: "00000000-0000-4000-8000-000000000001",
  username: "alex",
} as const;

/**
 * Scoped pages such as the workflows canvas only exist under a scope: `/flows`
 * and `/automations` were retired in favour of `/<scope>/workflows`, and the
 * layout needs the scope headers to resolve who it is rendering for.
 *
 * Derive the path from the same fixture (`scopedPath`) so the URL and the
 * headers cannot drift apart.
 */
export async function enableScopedE2EAuth(
  page: Page,
  { userId = E2E_SCOPE_USER.id, slug = E2E_SCOPE_USER.username } = {}
) {
  await page.context().setExtraHTTPHeaders({
    ...buildE2EAuthHeaders(userId),
    "x-mogplex-scope-kind": "personal",
    "x-mogplex-scope-slug": slug,
    "x-mogplex-scope-id": userId,
  });
}

export function scopedPath(path: string, slug = E2E_SCOPE_USER.username) {
  return `/${slug}/${path.replace(/^\//, "")}`;
}

export async function setForgedLegacyUserCookie(page: Page, userId = "user-1") {
  await page.goto("/login");
  await page.evaluate((value) => {
    document.cookie = `user_id=${value}; path=/`;
  }, userId);
}
