import { expect, test } from "@playwright/test";
import {
  buildRoutes,
  withDatabase,
} from "../support/sandbox-pause-race-harness";
import {
  withResumeDatabase,
  legacyMissingVmWrite,
} from "../support/sandbox-resume-race-harness";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  initializeTrackedEvents,
  mockActivationFlow,
  syncedRepo,
} from "./helpers/activation-fixtures";

test("pause and resume preserve the saved workspace across concurrent provider-status reads", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  const harness = await mockActivationFlow(page, {
    initialRepos: [syncedRepo],
  });
  const recordId = "sandbox-record-repo-1";
  harness.seedSandbox("repo-1", { status: "running" });
  let pausedSandbox: { runtime_summary: { status: string } } | undefined;
  await page.route(`**/api/sandbox/${recordId}/health`, async (route) => {
    if (!pausedSandbox) return route.fallback();
    // Health reads the same saved record, including persistence/snapshot
    // metadata. The generic activation fixture models a legacy sandbox.
    await route.fulfill({
      json: {
        health: { status: pausedSandbox.runtime_summary.status },
        sandbox: pausedSandbox,
      },
    });
  });
  await page.route(`**/api/sandbox/${recordId}/pause`, async (route) => {
    await withDatabase(async (pg) => {
      const routes = buildRoutes(
        pg,
        async () => {
          await routes.detail();
        },
        async () => "stopped",
        recordId
      );
      const result = await routes.pause();
      const payload = await result.json();
      pausedSandbox = payload.sandbox;
      await route.fulfill({
        status: result.status,
        contentType: "application/json",
        body: JSON.stringify(payload),
      });
    }, recordId);
  });
  await page.goto(scopedPath("projects/workspace"));
  await page.getByTestId("home-open-workspace-repo-1").click();
  const pauseResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/pause")
  );
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const response = await pauseResponse;
  const payload = await response.json();
  expect(response.status(), JSON.stringify(payload)).toBe(200);
  expect(payload.sandbox.id).toBe(recordId);
  expect(payload.sandbox.runtime_summary.status).toBe("paused");
  await expect(
    page.getByRole("button", { name: "Resume", exact: true })
  ).toBeVisible();
  await expect(page.getByText("Sandbox paused", { exact: true })).toBeVisible();

  await page.route(`**/api/sandbox/${recordId}/resume`, async (route) => {
    await withResumeDatabase(
      async ({ resume }) => {
        const resumed = await resume();
        const body = await resumed.text();
        const ready = body
          .split("\n\n")
          .filter((frame) => frame.startsWith("data: "))
          .map((frame) => JSON.parse(frame.slice(6)))
          .find((event) => event.type === "ready");
        expect(ready?.sandbox.id).toBe(recordId);
        expect(ready?.sandbox.working_branch).toBe("saved-work");
        expect(ready?.sandbox.snapshot_id).toBe("snap_saved");
        pausedSandbox = ready.sandbox;
        harness.setSandboxState("repo-1", {
          status: "running",
          health_status: "running",
        });
        await route.fulfill({
          status: resumed.status,
          contentType: "text/event-stream",
          body,
        });
      },
      recordId,
      legacyMissingVmWrite
    );
  });
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("Sandbox paused", { exact: true })
  ).not.toBeVisible();
});
