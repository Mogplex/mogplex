import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import {
  loadObservabilityCallsRoute,
  FakeQuery,
} from "./helpers/observability-calls-route-fixtures";

test("GET /api/observability/calls keeps an old live call that is still making progress", async () => {
  const { createObservabilityCallsGetHandler } =
    await loadObservabilityCallsRoute();
  const { isStaleLiveInteractiveCall } =
    await import("../../lib/interactive-runs");
  const hoursAgo = (hours: number) =>
    new Date(Date.now() - hours * 60 * 60_000).toISOString();
  const lookedUp: string[][] = [];

  const handler = createObservabilityCallsGetHandler({
    requireUserId: async () => "user-123",
    buildQuery: () =>
      new FakeQuery({
        data: [
          {
            id: "busy",
            type: "agent",
            status: "streaming",
            started_at: hoursAgo(8),
            metadata: {},
          },
          {
            id: "quiet",
            type: "agent",
            status: "streaming",
            started_at: hoursAgo(8),
            metadata: {},
          },
          {
            id: "fresh",
            type: "agent",
            status: "streaming",
            started_at: hoursAgo(1),
            metadata: {},
          },
          {
            id: "unreadable",
            type: "agent",
            status: "streaming",
            started_at: hoursAgo(8),
            metadata: {},
          },
        ],
        count: 4,
        error: null,
      }) as never,
    isStaleLiveInteractiveCall,
    loadLatestActivity: async (callIds) => {
      lookedUp.push(callIds);
      return new Map<string, string | null | undefined>([
        ["busy", hoursAgo(0.1)],
        ["quiet", null],
        ["unreadable", undefined],
      ]);
    },
  });

  const response = await handler(
    new NextRequest(
      "http://localhost/api/observability/calls?live_only=true&page=1&limit=10"
    )
  );
  const payload = await response.json();

  assert.deepEqual(lookedUp, [["busy", "quiet", "unreadable"]]);
  assert.deepEqual(
    payload.calls.map((call: { id: string }) => call.id),
    ["busy", "fresh", "unreadable"]
  );
});
