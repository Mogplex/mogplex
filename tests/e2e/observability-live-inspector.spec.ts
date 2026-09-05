import { createServer, type ServerResponse } from "node:http";
import { expect, test, type WebSocketRoute } from "@playwright/test";
import type { ObservabilityJobDetail } from "../../lib/types";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import { mockActivationFlow } from "./helpers/activation-fixtures";
import { fulfillJson } from "./helpers/automation-control-plane-fixtures";

test("live inspector separates connection loss from execution and reconciles on reconnect", async ({
  page,
}, testInfo) => {
  const run: ObservabilityJobDetail = {
    id: "00000000-0000-4000-8000-000000000077",
    assignment_id: null,
    trigger_id: null,
    source_kind: "agent_run",
    source_type: "slack",
    status: "running",
    created_at: "2026-09-05T10:00:00Z",
    started_at: "2026-09-05T10:00:00Z",
    completed_at: null,
    input_tokens: null,
    output_tokens: null,
    duration_ms: null,
    cost_usd: null,
    error: null,
    start_attempts: 1,
    metadata: { prompt: "Fix the mobile header", run_status: "streaming" },
    repo: { id: "repo-1", full_name: "acme/widgets" },
    agent: { id: "agent-1", name: "Mogplex", slug: "mogplex" },
    latest_ai_call: null,
    latest_dispatch_event: null,
    cancelable: false,
    repairable: false,
    requeueable: false,
    dispatch_events: [],
    ai_calls: [],
    review_findings: [],
  };
  await enableScopedE2EAuth(page);
  await mockActivationFlow(page);
  await page.route(`**/api/observability/jobs/${run.id}?*`, (route) =>
    fulfillJson(route, { run })
  );
  const streams = new Set<ServerResponse>();
  const sockets = new Set<WebSocketRoute>();
  const changes: (() => void)[] = [];
  const server = createServer((_request, response) => {
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
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture address");
  try {
    await page.route("**/api/realtime/events?*", (route) =>
      route.continue({ url: `http://127.0.0.1:${address.port}/events` })
    );
    // Speak the actual Phoenix wire protocol; do not replace application hooks.
    await page.routeWebSocket("**/realtime/v1/websocket*", (socket) => {
      sockets.add(socket);
      socket.onMessage((raw) => {
        const [join, ref, topic, event, payload] = JSON.parse(String(raw));
        if (event === "phx_join") {
          const filters = (
            payload.config.postgres_changes as { table: string }[]
          ).map((filter, index) => ({ ...filter, id: index + 1 }));
          socket.send(
            JSON.stringify([
              join,
              ref,
              topic,
              "phx_reply",
              { status: "ok", response: { postgres_changes: filters } },
            ])
          );
          if (String(topic).includes("run-inspector:"))
            changes.push(() =>
              socket.send(
                JSON.stringify([
                  join,
                  null,
                  topic,
                  "postgres_changes",
                  {
                    ids: filters.map((filter) => filter.id),
                    data: {
                      schema: "public",
                      table: "external_agent_runs",
                      type: "UPDATE",
                      columns: [],
                      record: { id: run.id },
                      old_record: {},
                      commit_timestamp: new Date().toISOString(),
                    },
                  },
                ])
              )
            );
        } else if (event === "heartbeat")
          socket.send(
            JSON.stringify([
              join,
              ref,
              topic,
              "phx_reply",
              { status: "ok", response: {} },
            ])
          );
      });
    });
    await page.goto(
      scopedPath(`observability?view=runs&run_kind=agent_run&run_id=${run.id}`)
    );
    const inspector = page.getByRole("region", { name: "Run details" });
    await expect(
      inspector.getByText("Connected to updates", { exact: true })
    ).toBeVisible();
    run.metadata = { ...run.metadata, run_status: "awaiting_input" };
    for (const response of streams)
      response.write('data: {"table":"external_agent_runs","op":"UPDATE"}\n\n');
    for (const change of changes) change();
    await expect(
      inspector.getByText("Needs your input", { exact: true })
    ).toBeVisible();
    for (const response of streams) response.end();
    for (const socket of sockets) socket.close();
    await expect(
      inspector.getByText(
        "Updates disconnected. Execution may still be running."
      )
    ).toBeVisible();
    await expect(
      inspector.getByText("Needs your input", { exact: true })
    ).toBeVisible();
    run.status = "success";
    run.completed_at = "2026-09-05T10:03:00Z";
    // The update occurred during the gap: reconnection must fetch without another event.
    await expect(
      inspector.getByText("Connected to updates", { exact: true })
    ).toBeVisible();
    await expect(
      inspector.locator("span").filter({ hasText: /^Completed$/ })
    ).toBeVisible();
    for (const response of streams) response.end();
    for (const socket of sockets) socket.close();
    await expect(
      inspector.getByText(
        "Updates disconnected. Showing the last saved result."
      )
    ).toBeVisible();
  } finally {
    for (const response of streams) response.end();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});
