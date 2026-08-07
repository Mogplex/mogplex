import type { Page, Route } from "@playwright/test";
import type { TrackedEvent, MockUser } from "./activation-fixtures-types";
import { modelId } from "./activation-fixtures-data";

export async function fulfillJson(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
}

export function buildUiMessageStreamBody(text: string) {
  return [
    `data: ${JSON.stringify({ type: "text-start", id: "assistant-1" })}`,
    "",
    `data: ${JSON.stringify({ type: "text-delta", id: "assistant-1", delta: text })}`,
    "",
    `data: ${JSON.stringify({ type: "text-end", id: "assistant-1" })}`,
    "",
    "data: [DONE]",
    "",
  ].join("\n");
}

export async function initializeTrackedEvents(page: Page) {
  await page.addInitScript(() => {
    window.__mogplexTrackedEvents = [];
    const bootstrapKey = "mogplex-e2e-bootstrap-done";
    if (!window.sessionStorage.getItem(bootstrapKey)) {
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.sessionStorage.setItem(bootstrapKey, "1");
    }
  });
}

export async function getTrackedEvents(page: Page): Promise<TrackedEvent[]> {
  return page.evaluate(() => {
    const events = window.__mogplexTrackedEvents;
    if (Array.isArray(events) && events.length > 0) {
      return events;
    }

    try {
      return JSON.parse(
        window.sessionStorage.getItem("mogplex-tracked-events") || "[]"
      ) as TrackedEvent[];
    } catch {
      return [];
    }
  });
}

export async function waitForTrackedEvent(
  page: Page,
  name: TrackedEvent["name"]
) {
  await page.waitForFunction(
    (eventName) =>
      (window.__mogplexTrackedEvents ?? []).some(
        (event) => event.name === eventName
      ),
    name
  );
}

export async function mockSettingsPage(page: Page, user: MockUser) {
  await page.route("**/api/auth/user", (route) => fulfillJson(route, { user }));
  await page.route("**/api/settings", (route) =>
    fulfillJson(route, { default_model: modelId, theme: "dark" })
  );
  await page.route("**/api/models", (route) =>
    fulfillJson(route, {
      models: [{ id: modelId, context_length: 128000 }],
      catalog: [{ id: modelId, context_length: 128000, is_enabled: true }],
    })
  );
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/github/installations", (route) =>
    fulfillJson(route, [])
  );
  await page.route("**/api/github/owners", (route) => fulfillJson(route, []));
}
