import { createServer, type ServerResponse } from "node:http";
import { expect, test } from "@playwright/test";
import type { RunWorkspaceContext } from "../../lib/run-workspace/types";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  initializeTrackedEvents,
  mockActivationFlow,
  syncedRepo,
} from "./helpers/activation-fixtures";
import { buildSandboxFixture } from "./helpers/sandbox-fixtures";

test("workspace reconnect reconciles status and sandbox without a new table event or stale overwrite", async ({
  page,
}, testInfo) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  await mockActivationFlow(page, { initialRepos: [syncedRepo] });
  const run: RunWorkspaceContext = {
    runId: "00000000-0000-4000-8000-000000000902",
    aiCallId: "call-reconnect",
    prompt: "Fix mobile controls",
    status: "streaming",
    sandboxRecordId: null,
    workingBranch: "fix/mobile",
    canGuide: true,
    repo: {
      ...syncedRepo,
      user_id: "user-1",
      created_at: "2026-09-05T00:00:00Z",
    },
  };
  let holdNext = false;
  let releaseStale = () => {};
  let staleStarted = () => {};
  const staleRequest = new Promise<void>((resolve) => {
    staleStarted = resolve;
  });
  const staleGate = new Promise<void>((resolve) => {
    releaseStale = resolve;
  });
  await page.route("**/api/runs/*/workspace", async (route) => {
    const snapshot = structuredClone(run);
    const stale = holdNext;
    if (stale) {
      holdNext = false;
      staleStarted();
      await staleGate;
    }
    await route.fulfill({
      json: snapshot,
      headers: { "x-test-snapshot": stale ? "stale" : "fresh" },
    });
  });
  const sandbox = buildSandboxFixture({
    repoId: "repo-1",
    billingSource: "platform",
    status: "paused",
    healthStatus: "paused",
  });
  await page.route("**/api/sandbox/sandbox-record-repo-1", (route) =>
    fulfillJson(route, { sandbox })
  );
  await page.route("**/api/sandbox/sandbox-record-repo-1/health", (route) =>
    fulfillJson(route, { sandbox, health: { status: "paused" } })
  );
  await page.route(/\/api\/sandbox(?:\?.*)?$/, (route) =>
    fulfillJson(route, { sandboxes: run.sandboxRecordId ? [sandbox] : [] })
  );
  const streams = new Map<ServerResponse, string>();
  const server = createServer((request, response) => {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Access-Control-Allow-Origin": new URL(
        String(testInfo.project.use.baseURL)
      ).origin,
      "Cache-Control": "no-cache",
    });
    response.write("retry: 1500\n\n");
    const path = request.url ?? "";
    streams.set(response, path);
    if (path === "/run")
      response.write(
        `event: run\ndata: ${JSON.stringify(run)}\n\nevent: replay_complete\ndata: {}\n\n`
      );
    response.on("close", () => streams.delete(response));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture address");
  try {
    await page.route("**/api/runs/*/stream", (route) =>
      route.continue({ url: `http://127.0.0.1:${address.port}/run` })
    );
    await page.route("**/api/realtime/events?*", (route) =>
      route.continue({ url: `http://127.0.0.1:${address.port}/tables` })
    );
    await page.goto(scopedPath(`projects/workspace?run=${run.runId}`));
    await expect(
      page.getByText("Agent is working", { exact: true })
    ).toBeVisible();
    await expect(page.getByText("Live", { exact: true })).toBeVisible();
    holdNext = true;
    for (const [response, path] of streams)
      if (path === "/tables")
        response.write('data: {"table":"ai_calls","op":"UPDATE"}\n\n');
    await staleRequest;
    for (const [response, path] of streams) if (path === "/run") response.end();
    await expect(
      page.getByText("Connection interrupted. Reconnecting…")
    ).toBeVisible();
    run.status = "awaiting_input";
    run.canGuide = false;
    run.sandboxRecordId = "sandbox-record-repo-1";
    // No table notification follows: stream reconnection must reconcile the gap.
    await expect(
      page.getByText("Waiting for input", { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText("Sandbox Paused", { exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Guide this run" })
    ).toHaveCount(0);
    const staleResponse = page.waitForResponse(
      (response) => response.headers()["x-test-snapshot"] === "stale"
    );
    releaseStale();
    await (await staleResponse).finished();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
    await expect(
      page.getByText("Waiting for input", { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText("Sandbox Paused", { exact: true })
    ).toBeVisible();
    const sessions = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("mogplex-sessions") ?? "{}").state
          .sessions
    );
    expect(
      sessions.find(
        (session: { externalRunId?: string }) =>
          session.externalRunId === run.runId
      ).activeSandboxId
    ).toBe(run.sandboxRecordId);
  } finally {
    releaseStale();
    for (const response of streams.keys()) response.end();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test("an awaiting-input workspace resumes its stream without remounting", async ({
  page,
}, testInfo) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  await mockActivationFlow(page, { initialRepos: [syncedRepo] });
  const run: RunWorkspaceContext = {
    runId: "00000000-0000-4000-8000-000000000904",
    aiCallId: "call-resume",
    prompt: "Fix mobile controls",
    status: "awaiting_input",
    sandboxRecordId: null,
    workingBranch: "fix/mobile",
    canGuide: true,
    repo: {
      ...syncedRepo,
      user_id: "user-1",
      created_at: "2026-09-05T00:00:00Z",
    },
  };
  await page.route("**/api/runs/*/workspace", (route) =>
    fulfillJson(route, run)
  );
  const streams = new Set<ServerResponse>();
  const server = createServer((request, response) => {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Access-Control-Allow-Origin": new URL(
        String(testInfo.project.use.baseURL)
      ).origin,
      "Cache-Control": "no-cache",
    });
    response.write("retry: 1500\n\n");
    streams.add(response);
    response.on("close", () => streams.delete(response));
    if (request.url !== "/run") return;
    response.write(`event: run\ndata: ${JSON.stringify(run)}\n\n`);
    if (run.status === "awaiting_input") {
      response.end("event: replay_complete\ndata: {}\n\n");
      return;
    }
    const event = (id: string, type: string, message: string, payload = {}) =>
      `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify({ id, type, message, payload, toolName: null, createdAt: "2026-09-05T00:00:00Z" })}\n\n`;
    response.write(
      event("resumed-report", "log", "Resumed and finished the mobile fix.", {
        kind: "assistant_final",
      })
    );
    run.status = "success";
    response.end(event("resumed-done", "finished", "Completed"));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture address");
  try {
    await page.route("**/api/runs/*/stream", (route) =>
      route.continue({ url: `http://127.0.0.1:${address.port}/run` })
    );
    await page.route("**/api/realtime/events?*", (route) =>
      route.continue({ url: `http://127.0.0.1:${address.port}/tables` })
    );
    await page.goto(scopedPath(`projects/workspace?run=${run.runId}`));
    await expect(
      page.getByText("Waiting for input", { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText("History loaded", { exact: true })
    ).toBeVisible();
    // A decision in another tab resumes the run; this workspace stays mounted.
    run.status = "streaming";
    for (const response of streams)
      response.write('data: {"table":"external_agent_runs","op":"UPDATE"}\n\n');
    await expect(
      page.getByText("Resumed and finished the mobile fix.", { exact: true })
    ).toBeVisible();
    await expect(page.getByText("Run complete", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue in workspace chat" })
    ).toBeEnabled();
    await expect(
      page.getByText("Resumed and finished the mobile fix.", { exact: true })
    ).toHaveCount(1);
  } finally {
    for (const response of streams) response.end();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});
