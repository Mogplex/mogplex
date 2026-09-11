import { expect, type Page } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./auth";
import {
  fulfillJson,
  mockBaseChrome,
} from "./automation-control-plane-fixtures";
import type { ControlSessionRecord } from "@/lib/control/session-types";

type Session = ControlSessionRecord & { archived: boolean };

export async function setupControlSidebar(
  page: Page,
  gates?: {
    beforeUpdate?: () => Promise<void>;
    updated?: (session: Session) => Promise<void>;
    selected?: (session: Session) => Promise<void>;
  }
) {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  const sessions: Session[] = Array.from({ length: 7 }, (_, i) => ({
    id: `chat-${i}`,
    title: i === 0 ? "Zebra investigation" : `Fix ${i}`,
    project: "acme/widgets",
    repo_id: "repo-1",
    model_id: null,
    orchestration_run_id: null,
    pinned: false,
    archived: false,
    messages: [],
    updated_at: `2026-09-11T12:00:0${i}.000Z`,
  }));
  sessions.push({
    ...sessions[0],
    id: "other",
    title: "Another project",
    project: "acme/other",
    repo_id: "repo-2",
    updated_at: "2026-09-11T13:00:00.000Z",
  });
  let failArchive = false;
  const rejectedIds = new Set<string>();
  await page.route("**/api/repos", (route) =>
    fulfillJson(route, [
      {
        id: "repo-1",
        full_name: "acme/widgets",
        name: "widgets",
        owner: "acme",
        default_branch: "main",
      },
      {
        id: "repo-2",
        full_name: "acme/other",
        name: "other",
        owner: "acme",
        default_branch: "main",
      },
    ])
  );
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/control/worktrees**", (route) =>
    fulfillJson(route, { worktrees: [] })
  );
  await page.route("**/api/sandbox", (route) =>
    fulfillJson(route, { sandboxes: [] })
  );
  await page.route("**/api/control/sessions**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "PUT") {
      const body = request.postDataJSON() as Partial<Session>;
      if (typeof body.archived === "boolean") await gates?.beforeUpdate?.();
      if (body.archived && (failArchive || rejectedIds.has(body.id ?? "")))
        return fulfillJson(route, { error: "Save failed" }, 500);
      const target = sessions.find((s) => s.id === body.id);
      if (!target) return fulfillJson(route, { error: "Not found" }, 404);
      Object.assign(target, body, { updated_at: new Date().toISOString() });
      if (typeof body.archived === "boolean") await gates?.updated?.(target);
      const session =
        url.searchParams.get("summary") === "true"
          ? Object.fromEntries(
              Object.entries(target).filter(([key]) => key !== "messages")
            )
          : target;
      return fulfillJson(route, { ok: true, session });
    }
    if (request.method() === "GET") {
      const id = url.searchParams.get("id");
      if (id) {
        const snapshot = structuredClone(sessions.find((s) => s.id === id));
        if (snapshot) await gates?.selected?.(snapshot);
        return fulfillJson(route, snapshot);
      }
      const after = url.searchParams.get("after");
      return fulfillJson(
        route,
        sessions
          .filter(
            (s) => s.archived === (url.searchParams.get("archived") === "true")
          )
          .filter((s) => !after || s.id.localeCompare(after) > 0)
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(0, 200)
      );
    }
    return route.fallback();
  });
  await page.goto(`${scopedPath("control")}?mission=chat-0`);
  const sidebar = page.getByRole("complementary", { name: "Sessions" });
  await expect(
    sidebar.getByRole("button", { name: "Actions for acme/widgets" })
  ).toBeVisible();
  return {
    sidebar,
    sessions,
    failArchiveId: (id: string) => {
      rejectedIds.add(id);
    },
    failArchives: () => {
      failArchive = true;
    },
  };
}
