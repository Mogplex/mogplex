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
  "signing cleanup failure",
  "unmetered running failure",
  "stopped failure",
  "successful snapshot",
  "successful snapshot unknown outcome",
  "successful snapshot rotated outcome",
  "successful snapshot still running",
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
    let signingKeyPresent = true;
    let providerReads = 0;
    let providerStops = 0;
    let launches = 0;
    let storedSnapshotId: string | null = null;
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
          if (scenario === "unmetered running failure") return null;
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
        setupSandboxCommitSigning: async ({ userId }) => {
          assert.equal(userId, "user-1");
          order.push("restore-signing");
          signingKeyPresent = true;
          return { status: "configured" };
        },
        getSandbox: async () => {
          providerReads++;
          if (
            providerReads > 1 &&
            (scenario === "missing after failure" ||
              scenario === "missing end watermark")
          )
            throw Object.assign(new Error("Provider gone"), { status: 404 });
          if (
            providerReads > 1 &&
            (scenario === "unknown after failure" ||
              scenario === "successful snapshot unknown outcome")
          )
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
            runCommand: async (command: { args?: string[] }) => {
              assert.match(command.args?.[1] ?? "", /MOGPLEX_SIGNING_SCRUBBED/);
              signingKeyPresent = false;
              order.push("scrub");
              return {
                exitCode: scenario === "signing cleanup failure" ? 1 : 0,
              };
            },
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
              if (scenario === "successful snapshot unknown outcome")
                providerStatus = "stopped";
              if (
                scenario === "rotated failure" ||
                scenario === "successful snapshot rotated outcome"
              )
                providerSessionId = "provider-session-2";
              if (
                !scenario.startsWith("successful snapshot") &&
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
        updateSandboxRecord: async (_id, updates) => {
          order.push("persist");
          if (scenario === "metadata failure") return null as never;
          storedSnapshotId =
            typeof updates.snapshot_id === "string"
              ? updates.snapshot_id
              : null;
          return { id: "sandbox-1" } as never;
        },
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
              scenario === "successful snapshot unknown outcome" ||
              scenario === "missing end watermark"
            ? 503
            : 409
      );
      assert.equal(
        ledger,
        scenario === "running failure" ||
          scenario === "signing cleanup failure" ||
          scenario === "unmetered running failure" ||
          scenario === "successful snapshot still running"
          ? "open"
          : scenario === "unknown after failure" ||
              scenario === "successful snapshot unknown outcome" ||
              scenario === "missing end watermark"
            ? "closing"
            : "closed"
      );
      if (
        [
          "running failure",
          "unmetered running failure",
          "signing cleanup failure",
          "rotated failure",
          "successful snapshot rotated outcome",
          "successful snapshot still running",
        ].includes(scenario)
      ) {
        assert.equal(
          signingKeyPresent,
          true,
          "a running workspace keeps its signing key after failed restart"
        );
        assert.ok(order.includes("restore-signing"));
      } else {
        assert.ok(
          !order.includes("restore-signing"),
          "never wake an unavailable or stopped sandbox to restore a key"
        );
      }
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
      assert.ok(order.indexOf("prepare") < order.indexOf("scrub"));
      if (scenario === "signing cleanup failure") {
        assert.ok(
          !order.includes("snapshot"),
          "never capture an unscrubbed signing key"
        );
        assert.ok(
          order.includes("reopen"),
          "keep the live workspace billing session open"
        );
      } else {
        assert.ok(order.indexOf("scrub") < order.indexOf("snapshot"));
      }
      if (scenario.startsWith("successful snapshot")) {
        assert.equal(
          storedSnapshotId,
          "saved-snapshot",
          "retain the captured snapshot even when billing settlement prevents restart"
        );
        assert.ok(
          order.indexOf("persist") < order.indexOf("finalize") ||
            !order.includes("finalize")
        );
      }
      if (scenario !== "successful snapshot")
        assert.ok(!order.includes("retire"));
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
