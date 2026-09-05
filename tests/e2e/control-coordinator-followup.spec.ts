import { expect, test } from "@playwright/test";
import { controlContinuationDatabase } from "../support/control-continuation-database";
import { saveControlTranscript } from "../../lib/control/transcript-store";
import { controlContinuationSummary } from "../../lib/control/continuation-presentation";
import {
  claimControlContinuation,
  listControlContinuations,
  updateClaimedControlContinuation,
} from "../../lib/control/continuation-store";
import { actOnControlContinuation } from "../../lib/control/continuation-actions";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
  mockControlSessionBootstrap,
} from "./helpers/automation-control-plane-fixtures";

test("worker handoff updates the conversation without another prompt, and cancellation survives reload", async ({
  page,
}, testInfo) => {
  const f = await controlContinuationDatabase("neon");
  const client = f.client as unknown as Parameters<
    typeof saveControlTranscript
  >[1];
  let unlisten: (() => Promise<void>) | undefined;
  try {
    const { continuation } = await f.rpc<{ continuation: { id: string } }>(
      "control_register_continuation",
      f.registerArgs
    );
    await f.checkpointParent();
    await f.rpc("control_refresh_continuation", {
      p_user_id: f.owner,
      p_continuation_id: continuation.id,
      p_parent_ai_call_id: f.parentCallId,
      p_parent_message: f.parentMessage,
    });
    await page.addInitScript(() => {
      class FixtureEventSource extends EventTarget {
        private listener: (event: Event) => void;
        constructor(url: string) {
          super();
          this.listener = (event: Event) => {
            const detail = (event as CustomEvent).detail;
            if (decodeURIComponent(url).includes(detail.table))
              this.dispatchEvent(
                new MessageEvent("message", { data: JSON.stringify(detail) })
              );
          };
          window.addEventListener("fixture-table-event", this.listener);
          queueMicrotask(() => this.dispatchEvent(new Event("open")));
        }
        close() {
          window.removeEventListener("fixture-table-event", this.listener);
        }
      }
      Object.defineProperty(window, "EventSource", {
        value: FixtureEventSource,
      });
    });
    await enableScopedE2EAuth(page);
    await mockBaseChrome(page);
    await mockControlSessionBootstrap(page);
    await page.route("**/api/control/sessions**", async (route) => {
      const saved = await saveControlTranscript(
        { userId: f.owner, sessionId: f.sessionId, messages: [] },
        client
      );
      return fulfillJson(
        route,
        new URL(route.request().url()).searchParams.has("id") ? saved : [saved]
      );
    });
    let userPrompts = 0;
    await page.route("**/api/control/chat", (route) => {
      userPrompts++;
      return fulfillJson(route, { error: "No user prompt expected" }, 500);
    });
    await page.route("**/api/control/continuations**", async (route) => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        const result = await actOnControlContinuation(
          f.owner,
          body.id,
          body.action,
          { client }
        );
        return fulfillJson(route, result, result.status);
      }
      return fulfillJson(route, {
        continuations: (
          await listControlContinuations(f.owner, f.sessionId, client)
        ).map(controlContinuationSummary),
      });
    });
    unlisten = await f.db.listen("mogplex_table_events", (payload) => {
      void page
        .evaluate(
          (detail) =>
            window.dispatchEvent(
              new CustomEvent("fixture-table-event", { detail })
            ),
          JSON.parse(payload)
        )
        .catch(() => undefined);
    });
    await page.goto(scopedPath(`control?mission=${f.sessionId}`));
    const status = page.getByRole("region", { name: "Coordinator follow-up" });
    await expect(status).toContainText("Waiting for workers");
    await expect(status).toContainText("resume here automatically");
    const composer = page.getByRole("textbox", {
      name: "Ask for follow-up changes",
    });
    await composer.fill("Keep my draft while results arrive");
    await f.db.query(
      "update external_agent_runs set status='success' where id=any($1)",
      [f.workerIds]
    );
    await claimControlContinuation(f.owner, continuation.id, "runtime", client);
    await expect(status).toContainText("Coordinator is reviewing the results");
    await saveControlTranscript(
      {
        userId: f.owner,
        sessionId: f.sessionId,
        messages: [
          {
            id: "automatic-reply",
            role: "assistant",
            parts: [
              {
                type: "text",
                text: "I reviewed the worker changes. The focused tests pass; integration remains to be checked.",
              },
            ],
          },
        ],
      },
      client
    );
    await expect(
      page.getByText(
        "I reviewed the worker changes. The focused tests pass; integration remains to be checked.",
        { exact: true }
      )
    ).toBeVisible();
    await expect(composer).toHaveValue("Keep my draft while results arrive");
    expect(userPrompts).toBe(0);
    await status.getByRole("button", { name: "Stop follow-up" }).click();
    await expect(status).toContainText("Coordinator follow-up cancelled");
    await expect(status).toContainText(
      "Workers and sandbox were left unchanged"
    );
    expect(
      await updateClaimedControlContinuation(
        {
          userId: f.owner,
          id: continuation.id,
          runtimeRunId: "runtime",
          status: "finished",
        },
        client
      )
    ).toBeNull();
    await page.reload();
    await expect(status).toContainText("Coordinator follow-up cancelled");
    await expect(
      page.getByText(
        "I reviewed the worker changes. The focused tests pass; integration remains to be checked.",
        { exact: true }
      )
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("coordinator-followup-desktop.png"),
    });
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(status).toBeVisible();
    await expect(status).toContainText("Coordinator follow-up cancelled");
    await page.screenshot({
      path: testInfo.outputPath("coordinator-followup-mobile.png"),
    });
  } finally {
    await unlisten?.();
    await f.db.close();
  }
});
