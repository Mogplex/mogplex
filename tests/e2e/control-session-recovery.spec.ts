import { expect, test } from "@playwright/test";
import { scopedPath } from "./helpers/auth";
import { fulfillJson } from "./helpers/automation-control-plane-fixtures";
import {
  mockRecoveryChrome,
  recoverySession,
  recoveryStream,
} from "./helpers/control-recovery-fixtures";

test("failed session history shows an error and recovers through Retry", async ({
  page,
}) => {
  await mockRecoveryChrome(page);
  let failed = true;
  await page.route("**/api/control/sessions**", (route) => {
    const id = new URL(route.request().url()).searchParams.get("id");
    return fulfillJson(
      route,
      id
        ? recoverySession
        : failed
          ? { error: "Could not load chats. Try again." }
          : [recoverySession],
      !id && failed ? 500 : 200
    );
  });
  await page.goto(scopedPath("control"));
  const sidebar = page.getByRole("complementary", { name: "Sessions" });
  await expect(sidebar.getByRole("alert")).toContainText(
    "Could not load chats"
  );
  await expect(page.getByText("No sessions yet", { exact: false })).toHaveCount(
    0
  );
  failed = false;
  await sidebar.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("Saved request", { exact: true })).toBeVisible();
});

for (const explicitNew of [false, true]) {
  test(`pending history ${explicitNew ? "allows an explicit new chat" : "keeps the new-chat form hidden"}`, async ({
    page,
  }) => {
    await mockRecoveryChrome(page);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/control/sessions**", async (route) => {
      const id = new URL(route.request().url()).searchParams.get("id");
      if (!id) await pending;
      return fulfillJson(route, id ? recoverySession : [recoverySession]);
    });
    await page.goto(scopedPath("control"));
    await expect(
      page.getByRole("status", { name: "Loading conversation" })
    ).toBeVisible();
    const composer = page.getByPlaceholder("Ask anything or run a command...");
    await expect(composer).toHaveCount(0);
    if (explicitNew) {
      await page
        .getByRole("button", { name: "New session", exact: true })
        .click();
      await expect(composer).toBeVisible();
    }
    release();
    await (explicitNew
      ? expect(composer).toBeVisible()
      : expect(page.getByText("Saved request", { exact: true })).toBeVisible());
  });
}

test("a missing session selection reports the failure while keeping the current chat", async ({
  page,
}) => {
  await mockRecoveryChrome(page);
  const gone = { ...recoverySession, id: "gone", title: "Deleted elsewhere" };
  let goneRequests = 0;
  let listRequests = 0;
  await page.route("**/api/control/sessions**", (route) => {
    const id = new URL(route.request().url()).searchParams.get("id");
    if (id === "gone") goneRequests++;
    if (!id) listRequests++;
    return fulfillJson(
      route,
      id === "gone"
        ? { error: "Not found" }
        : id
          ? recoverySession
          : [recoverySession, ...(goneRequests ? [] : [gone])],
      id === "gone" ? 404 : 200
    );
  });
  await page.goto(`${scopedPath("control")}?mission=${recoverySession.id}`);
  await expect(page.getByText("Saved request", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Deleted elsewhere / }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "That session no longer exists" })
  ).toContainText("That session no longer exists");
  await expect(page.getByText("Saved request", { exact: true })).toBeVisible();
  await page
    .getByRole("alert")
    .filter({ hasText: "That session no longer exists" })
    .getByRole("button", { name: "Retry" })
    .click();
  await expect(
    page.getByRole("button", { name: /^Deleted elsewhere / })
  ).toHaveCount(0);
  await expect(
    page.getByRole("alert").filter({ hasText: "That session no longer exists" })
  ).toHaveCount(0);
  expect(goneRequests).toBe(1);
  expect(listRequests).toBeGreaterThan(1);
  await expect(page.getByText("Saved request", { exact: true })).toBeVisible();
});

test("a failed restore is retried on the next history refresh without reloading", async ({
  page,
}) => {
  await mockRecoveryChrome(page);
  let attempts = 0;
  await page.route("**/api/control/sessions**", (route) => {
    const id = new URL(route.request().url()).searchParams.get("id");
    if (!id) return fulfillJson(route, [recoverySession]);
    attempts++;
    return fulfillJson(
      route,
      attempts === 1
        ? { error: "Could not load this chat. Try again." }
        : recoverySession,
      attempts === 1 ? 503 : 200
    );
  });
  await page.goto(scopedPath("control"));
  const error = page
    .getByRole("alert")
    .filter({ hasText: "Could not load this chat" });
  await expect(error).toBeVisible();
  await error.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Saved request", { exact: true })).toBeVisible();
  expect(attempts).toBeGreaterThan(1);
});

for (const hasOtherChats of [false, true]) {
  test(`archiving the selected chat opens a fresh composer ${hasOtherChats ? "with another chat remaining" : "when history becomes empty"}`, async ({
    page,
  }) => {
    await mockRecoveryChrome(page);
    let archived = false;
    const other = {
      ...recoverySession,
      id: "other-chat",
      title: "Another chat",
      messages: [],
    };
    await page.route("**/api/control/sessions**", (route) => {
      if (route.request().method() === "PUT") {
        archived = true;
        return fulfillJson(route, {
          session: { ...recoverySession, archived: true },
        });
      }
      const id = new URL(route.request().url()).searchParams.get("id");
      return fulfillJson(
        route,
        id
          ? recoverySession
          : [
              ...(archived ? [] : [recoverySession]),
              ...(hasOtherChats ? [other] : []),
            ]
      );
    });
    await page.goto(`${scopedPath("control")}?mission=${recoverySession.id}`);
    await expect(
      page.getByText("Saved request", { exact: true })
    ).toBeVisible();
    await page.getByRole("button", { name: "More options" }).click();
    await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Start mission" })
    ).toBeVisible();
    await expect(
      page.getByRole("status", { name: "Loading conversation" })
    ).toHaveCount(0);
    await expect(page.getByText("Saved request", { exact: true })).toHaveCount(
      0
    );
  });
}

test("a slow automatic restore cannot replace a newly created mission", async ({
  page,
}) => {
  await mockRecoveryChrome(page);
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const received = new Promise<void>((resolve) => {
    started = resolve;
  });
  const created = {
    ...recoverySession,
    id: "new-during-restore",
    title: "New work",
    messages: [],
  };
  await page.route("**/api/control/sessions**", async (route) => {
    const method = route.request().method();
    if (method === "POST") return fulfillJson(route, created);
    if (method === "PUT") return fulfillJson(route, { session: created });
    const id = new URL(route.request().url()).searchParams.get("id");
    if (id === recoverySession.id) {
      started();
      await pending;
    }
    return fulfillJson(
      route,
      id ? (id === created.id ? created : recoverySession) : [recoverySession]
    );
  });
  await page.route("**/api/control/chat", (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body: recoveryStream(),
    })
  );
  await page.goto(scopedPath("control"));
  await received;
  await page.getByRole("button", { name: "New session", exact: true }).click();
  await page
    .getByPlaceholder("Ask anything or run a command...")
    .fill("Keep the new mission selected");
  await page
    .getByRole("button", { name: "Start mission", exact: true })
    .click();
  await expect(
    page.getByText("Request recovered.", { exact: true })
  ).toBeVisible();
  const restored = page.waitForResponse(
    (response) =>
      new URL(response.url()).searchParams.get("id") === recoverySession.id
  );
  release();
  await restored;
  await expect(page).toHaveURL(/mission=new-during-restore/);
  await expect(page.getByText("Saved request", { exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("mogplex.control.lastSessionId")
    )
  ).toBe(created.id);
});

test("Retry leaves a current chat confirmed deleted by refreshed history", async ({
  page,
}) => {
  await mockRecoveryChrome(page);
  let reads = 0;
  await page.route("**/api/control/sessions**", (route) => {
    const id = new URL(route.request().url()).searchParams.get("id");
    if (!id) return fulfillJson(route, reads > 1 ? [] : [recoverySession]);
    reads++;
    return fulfillJson(
      route,
      reads > 1 ? { error: "Not found" } : recoverySession,
      reads > 1 ? 404 : 200
    );
  });
  await page.goto(scopedPath("control"));
  const banner = page
    .getByRole("alert")
    .filter({ hasText: "That session no longer exists" });
  await expect(banner).toBeVisible();
  await expect(page.getByText("Saved request", { exact: true })).toBeVisible();
  await banner.getByRole("button", { name: "Retry" }).click();
  await expect(
    page.getByRole("button", { name: "Start mission", exact: true })
  ).toBeVisible();
  await expect(page.getByText("Saved request", { exact: true })).toHaveCount(0);
  await expect(banner).toHaveCount(0);
});

test("a chat arriving after empty history preserves the unsent new-chat composer", async ({
  page,
}) => {
  await mockRecoveryChrome(page);
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
  let arrived = false;
  await page.route("**/api/control/sessions**", (route) => {
    const id = new URL(route.request().url()).searchParams.get("id");
    return fulfillJson(
      route,
      id ? recoverySession : arrived ? [recoverySession] : []
    );
  });
  await page.goto(scopedPath("control"));
  const composer = page.getByPlaceholder("Ask anything or run a command...");
  await composer.fill("Keep this unsent new draft");
  arrived = true;
  await page.evaluate(() => {
    const sources = (
      window as unknown as { recoveryEventSources: EventSource[] }
    ).recoveryEventSources;
    for (const source of sources)
      if (source.url.includes("tables=control_sessions"))
        source.dispatchEvent(
          new MessageEvent("message", {
            data: JSON.stringify({ table: "control_sessions", op: "INSERT" }),
          })
        );
  });
  await expect(
    page.getByRole("button", { name: /^Saved investigation / })
  ).toBeVisible();
  await expect(composer).toHaveValue("Keep this unsent new draft");
  await expect(
    page.getByRole("status", { name: "Loading conversation" })
  ).toHaveCount(0);
});

test("Retry recovers a failed manual selection with no active chat", async ({
  page,
}) => {
  await mockRecoveryChrome(page);
  let archived = false;
  let otherReads = 0;
  const other = {
    ...recoverySession,
    id: "manual-other",
    title: "Another saved chat",
    messages: [
      {
        id: "other-user",
        role: "user",
        parts: [{ type: "text", text: "Recovered selection" }],
      },
    ],
  };
  await page.route("**/api/control/sessions**", (route) => {
    if (route.request().method() === "PUT") {
      archived = true;
      return fulfillJson(route, {
        session: { ...recoverySession, archived: true },
      });
    }
    const id = new URL(route.request().url()).searchParams.get("id");
    if (id === other.id) {
      otherReads++;
      return fulfillJson(
        route,
        otherReads === 1
          ? { error: "Could not load this chat. Try again." }
          : other,
        otherReads === 1 ? 503 : 200
      );
    }
    return fulfillJson(
      route,
      id ? recoverySession : [...(archived ? [] : [recoverySession]), other]
    );
  });
  await page.goto(`${scopedPath("control")}?mission=${recoverySession.id}`);
  await expect(page.getByText("Saved request", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "More options" }).click();
  await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Start mission", exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: /^Another saved chat / }).click();
  const banner = page
    .getByRole("alert")
    .filter({ hasText: "Could not load this chat" });
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Retry" }).click();
  await expect(
    page.getByText("Recovered selection", { exact: true })
  ).toBeVisible();
  await expect(banner).toHaveCount(0);
});

test("a new mission remains usable after the history request fails", async ({
  page,
}) => {
  await mockRecoveryChrome(page);
  const created = {
    ...recoverySession,
    id: "created-after-history-error",
    messages: [] as unknown[],
  };
  await page.route("**/api/control/sessions**", (route) => {
    const method = route.request().method();
    if (method === "POST") return fulfillJson(route, created);
    if (method === "PUT") {
      created.messages = route.request().postDataJSON().messages ?? [];
      return fulfillJson(route, { session: created });
    }
    const id = new URL(route.request().url()).searchParams.get("id");
    return fulfillJson(
      route,
      id ? created : { error: "Could not load chats. Try again." },
      id ? 200 : 503
    );
  });
  await page.route("**/api/control/chat", (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body: recoveryStream(),
    })
  );
  await page.goto(scopedPath("control"));
  await expect(
    page.getByRole("alert").filter({ hasText: "Could not load chats" })
  ).toBeVisible();
  await page.getByRole("button", { name: "New session", exact: true }).click();
  await page
    .getByPlaceholder("Ask anything or run a command...")
    .fill("Create despite unavailable history");
  await page
    .getByRole("button", { name: "Start mission", exact: true })
    .click();
  await expect(
    page.getByText("Request recovered.", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByPlaceholder("Ask for follow-up changes or attach images")
  ).toBeEnabled();
});
