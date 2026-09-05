import assert from "node:assert/strict";
import test from "node:test";
import { controlRuntimeNetwork } from "../support/control-runtime-network";

for (const outcome of [
  "success",
  "provider-401",
  "checkpoint-failure",
  "cancelled",
  "wrong-owner",
] as const) {
  test(`background coordinator: ${outcome} through the real Control pipeline without replay`, async () => {
    const f = controlRuntimeNetwork();
    const previousFetch = globalThis.fetch;
    const values = {
      MOGPLEX_DATA_BACKEND: "supabase",
      SUPABASE_URL: "https://control-db.example.test",
      SUPABASE_SERVICE_ROLE_KEY: "fixture",
      INTERNAL_API_SECRET: "fixture-internal",
    };
    const previous = Object.fromEntries(
      Object.keys(values).map((key) => [key, process.env[key]])
    );
    Object.assign(process.env, values);
    globalThis.fetch = f.fetchBoundary;
    try {
      const { executeControlContinuation } =
        await import("../../lib/control/continuation-runtime");
      if (outcome === "provider-401") f.failProvider();
      if (outcome === "checkpoint-failure")
        f.onProvider(async () => f.failCheckpoint());
      if (outcome === "cancelled")
        f.onProvider(async () => {
          f.cancel();
          // Wait for the notification's guard query rather than a timer.
          await Promise.resolve();
        });
      const payload = {
        userId:
          outcome === "wrong-owner"
            ? "00000000-0000-4000-8000-000000000001"
            : f.userId,
        continuationId: f.ticket.id,
      };
      if (outcome === "provider-401" || outcome === "checkpoint-failure") {
        await assert.rejects(
          executeControlContinuation(
            payload,
            "fixture-runtime",
            new AbortController().signal,
            f.createListener
          )
        );
        assert.equal(f.ticket.status, "failed");
        assert.match(f.ticket.error ?? "", /not replayed/);
        assert.equal(f.providerRequests.length, 1);
        assert.equal(f.closed, true);
        assert.equal(
          (
            await executeControlContinuation(
              payload,
              "duplicate",
              new AbortController().signal,
              f.createListener
            )
          ).status,
          "not_claimed"
        );
        assert.equal(f.providerRequests.length, 1);
        return;
      }
      const result = await executeControlContinuation(
        payload,
        "fixture-runtime",
        new AbortController().signal,
        f.createListener
      );
      if (outcome === "wrong-owner") {
        assert.equal(result.status, "not_claimed");
        assert.equal(f.calls.length, 0);
        assert.equal(f.providerRequests.length, 0);
        return;
      }
      if (outcome === "cancelled") {
        assert.equal(result.status, "cancelled");
        assert.equal(f.ticket.status, "cancelled");
        assert.ok(
          f.savedEvents.some((event) => event.event_type === "cancelled"),
          "must await the final cancellation audit write before returning"
        );
        assert.equal(f.closed, true);
        return;
      }
      assert.equal(result.status, "finished");
      assert.equal(f.ticket.status, "finished");
      assert.equal(f.calls[0]?.status, "success");
      assert.equal(f.providerRequests.length, 1);
      assert.match(
        JSON.stringify(f.session.messages),
        /The worker results are saved/
      );
      assert.equal(
        f.session.messages.filter((message) => message.role === "user").length,
        1
      );
      assert.equal(f.closed, true);
      assert.equal(
        (
          await executeControlContinuation(
            payload,
            "duplicate",
            new AbortController().signal,
            f.createListener
          )
        ).status,
        "not_claimed"
      );
      assert.equal(f.providerRequests.length, 1);
    } finally {
      globalThis.fetch = previousFetch;
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
}
