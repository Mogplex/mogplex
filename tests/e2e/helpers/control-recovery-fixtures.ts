import type { Page } from "@playwright/test";
import { enableScopedE2EAuth } from "./auth";
import {
  fulfillJson,
  mockBaseChrome,
} from "./automation-control-plane-fixtures";

export const recoverySession = {
  id: "recovery-session",
  title: "Saved investigation",
  project: "acme/widgets",
  repo_id: "repo-1",
  model_id: null,
  orchestration_run_id: "run-recovery",
  pinned: false,
  archived: false,
  messages: [
    {
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "Saved request" }],
    },
  ],
  created_at: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-10-01T00:00:00.000Z",
};
export async function mockRecoveryChrome(page: Page) {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/sandbox", (route) =>
    fulfillJson(route, { sandboxes: [] })
  );
  await page.route("**/api/repos**", (route) =>
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
}
export function recoveryStream() {
  return (
    [
      { type: "start" },
      { type: "text-start", id: "a1" },
      { type: "text-delta", id: "a1", delta: "Request recovered." },
      { type: "text-end", id: "a1" },
      { type: "finish" },
    ]
      .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
      .join("") + "data: [DONE]\n\n"
  );
}

export async function captureRecoveryEvents(page: Page) {
  await page.addInitScript(() => {
    const sources: EventSource[] = [];
    Object.defineProperty(window, "recoveryEventSources", { value: sources });
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      constructor(url: string | URL, options?: EventSourceInit) {
        super(url, options);
        sources.push(this);
      }
    };
  });
}
export async function invalidateRecoverySessions(page: Page) {
  await page.evaluate(() => {
    for (const source of (
      window as unknown as { recoveryEventSources: EventSource[] }
    ).recoveryEventSources)
      if (source.url.includes("tables=control_sessions"))
        source.dispatchEvent(
          new MessageEvent("message", {
            data: JSON.stringify({ table: "control_sessions", op: "UPDATE" }),
          })
        );
  });
}
