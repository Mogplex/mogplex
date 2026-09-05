import { expect, test } from "@playwright/test";
import { sanitizeObservabilityPayload } from "../../lib/observability/user-facing-errors";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  initializeTrackedEvents,
  mockActivationFlow,
} from "./helpers/activation-fixtures";
import { buildSandboxBackedCall } from "./helpers/sandbox-fixtures";

test("successful command output does not display a failure for empty stderr", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  const call = {
    ...buildSandboxBackedCall({
      repoId: "repo-1",
      sandboxRecordId: "sandbox-record-repo-1",
      sandboxId: "sandbox-1",
      previewUrl: null,
      computeBillingSource: "platform",
      billingProjectId: null,
      billingTeamId: null,
      aiBillingSource: "platform",
      callId: "call-empty-stderr",
    }),
    status: "success",
    tool_calls_count: 1,
    tool_calls: [
      {
        name: "bash",
        input: { command: "printf completed" },
        duration_ms: 10,
        output: { exitCode: 0, stdout: "command completed", stderr: "" },
      },
    ],
  };
  await mockActivationFlow(page, {
    observabilityCalls: [sanitizeObservabilityPayload(call, "CALL", call.id)],
  });
  await page.goto(scopedPath(`observability?call_id=${call.id}`));
  await expect(
    page.getByRole("heading", { name: "Observability", level: 1 })
  ).toBeVisible();
  await expect(page.getByText(/command completed/)).toBeVisible();
  await expect(page.getByText(/internal service error/)).toHaveCount(0);
  await expect(page.getByText(/"stderr": ""/)).toBeVisible();
});
