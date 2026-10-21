import assert from "node:assert/strict";
import test from "node:test";
import { buildLoadedSandboxRestartRecord } from "./sandbox-record-route-test-harness/record-builders";
import { loadSandboxRestartRouteModule } from "./sandbox-record-route-test-harness/loaders";
import {
  buildResolvedSandboxRouteContext,
  buildSandboxRouteParams,
} from "./sandbox-record-route-test-harness";

for (const scenario of [
  "running failure",
  "stopped failure",
  "successful snapshot",
  "metadata failure",
  "rotated failure",
  "missing after failure",
  "unknown after failure",
  "missing end watermark",
] as const) {
  test(`legacy snapshot billing recovers ${scenario} without discarding work`, async () => {
    const { createSandboxRestartHandler } =
      await loadSandboxRestartRouteModule();
    const attempt = {
      sessionId: "billing-1",
      closeGeneration: 1,
      actorUserId: "user-1",
      meteredThroughAt:
        scenario === "missing end watermark"
          ? undefined
          : new Date("2026-01-01T00:00:00Z"),
    };
    const endedAt = new Date("2026-01-01T00:00:30Z");
    let ledger: "open" | "closing" | "closed" = "open";
    let providerReads = 0;
    let providerStops = 0;
    let launches = 0;
    let providerStatus = "running";
    let providerSessionId = "provider-session-1";
    const finalizedAt: Date[] = [];
    const order: string[] = [];
    const errors: unknown[] = [];
    const originalError = console.error;
    console.error = (...args) => errors.push(args);
    try {
      const handler = createSandboxRestartHandler({
        loadOwnedSandboxRouteRecord: (async () =>
          buildLoadedSandboxRestartRecord()) as never,
        resolveLoadedSandboxRouteContext: async (loaded) =>
          buildResolvedSandboxRouteContext(loaded) as never,
        prepareSandboxBillingClose: async () => {
          order.push("prepare");
          ledger = "closing";
          return attempt;
        },
        reopenSandboxBillingClose: async () => {
          order.push("reopen");
          ledger = "open";
          return true;
        },
        finalizeSandboxBillingClose: async (_attempt, time) => {
          order.push("finalize");
          ledger = "closed";
          finalizedAt.push(time);
          return { finalized: true, metered: true };
        },
        getSandbox: async () => {
          providerReads++;
          if (
            providerReads > 1 &&
            (scenario === "missing after failure" ||
              scenario === "missing end watermark")
          )
            throw Object.assign(new Error("Provider gone"), { status: 404 });
          if (providerReads > 1 && scenario === "unknown after failure")
            throw Object.assign(new Error("Provider unavailable"), {
              status: 503,
            });
          return {
            currentSession: () => ({
              sessionId: providerSessionId,
              status: providerStatus,
              createdAt: new Date("2026-01-01T00:00:00Z"),
              startedAt:
                providerSessionId === "provider-session-1"
                  ? attempt.meteredThroughAt
                  : endedAt,
              stoppedAt: providerStatus === "stopped" ? endedAt : null,
              updatedAt: endedAt,
            }),
            snapshot: async () => {
              order.push("snapshot");
              if (
                [
                  "successful snapshot",
                  "metadata failure",
                  "stopped failure",
                ].includes(scenario)
              )
                providerStatus = "stopped";
              if (scenario === "rotated failure")
                providerSessionId = "provider-session-2";
              if (
                scenario !== "successful snapshot" &&
                scenario !== "metadata failure"
              )
                throw new Error("Snapshot failed");
              return { snapshotId: "saved-snapshot" };
            },
            stop: async () => {
              providerStops++;
            },
          } as never;
        },
        updateSandboxRecord: async () =>
          (scenario === "metadata failure"
            ? null
            : { id: "sandbox-1" }) as never,
        stopSandboxRecord: async () => {
          order.push("retire");
          return { id: "sandbox-1" } as never;
        },
        fetchImpl: async () => {
          order.push("launch");
          launches++;
          return Response.json({});
        },
      });
      const response = await handler(
        new Request("https://browser.example/api/sandbox", { method: "POST" }),
        buildSandboxRouteParams()
      );
      assert.equal(
        response.status,
        scenario === "successful snapshot"
          ? 200
          : scenario === "metadata failure" ||
              scenario === "unknown after failure" ||
              scenario === "missing end watermark"
            ? 503
            : 409
      );
      assert.equal(
        ledger,
        scenario === "running failure"
          ? "open"
          : scenario === "unknown after failure" ||
              scenario === "missing end watermark"
            ? "closing"
            : "closed"
      );
      assert.equal(providerStops, 0);
      assert.equal(launches, scenario === "successful snapshot" ? 1 : 0);
      if (scenario === "running failure" || scenario === "rotated failure") {
        const body = await response.text();
        assert.match(body, /Try again/);
        assert.doesNotMatch(body, /support|recovery/);
      }
      assert.equal(
        providerReads,
        2,
        "read provider state once after the ambiguous operation"
      );
      assert.ok(order.indexOf("prepare") < order.indexOf("snapshot"));
      if (scenario === "successful snapshot")
        assert.ok(order.indexOf("finalize") < order.indexOf("launch"));
      if (scenario === "stopped failure" || scenario === "rotated failure")
        assert.deepEqual(finalizedAt, [endedAt]);
      if (scenario === "missing after failure")
        assert.deepEqual(finalizedAt, [attempt.meteredThroughAt]);
      if (scenario.includes("failure")) assert.ok(errors.length > 0);
    } finally {
      console.error = originalError;
    }
  });
}
