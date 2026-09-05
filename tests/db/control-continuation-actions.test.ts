import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { controlContinuationDatabase } from "../support/control-continuation-database";
import { actOnControlContinuation } from "@/lib/control/continuation-actions";
import {
  claimControlContinuation,
  loadControlContinuation,
} from "@/lib/control/continuation-store";

it("cancels only the owned follow-up and never replays cancelled execution", async () => {
  const f = await controlContinuationDatabase("neon");
  const client = f.client as unknown as Parameters<
    typeof loadControlContinuation
  >[2];
  try {
    const { continuation } = await f.rpc<{ continuation: { id: string } }>(
      "control_register_continuation",
      f.registerArgs
    );
    expect(
      await actOnControlContinuation(randomUUID(), continuation.id, "cancel", {
        client,
      })
    ).toMatchObject({ status: 404 });
    expect(
      await actOnControlContinuation(
        f.owner,
        continuation.id,
        "retry_delivery",
        { client }
      )
    ).toMatchObject({ status: 409 });
    expect(
      await actOnControlContinuation(f.owner, continuation.id, "cancel", {
        client,
      })
    ).toEqual({ status: 200 });
    expect(
      await actOnControlContinuation(f.owner, continuation.id, "cancel", {
        client,
      })
    ).toEqual({ status: 200 });
    expect(
      await claimControlContinuation(
        f.owner,
        continuation.id,
        "late-runtime",
        client
      )
    ).toBeNull();
    expect(
      await actOnControlContinuation(
        f.owner,
        continuation.id,
        "retry_delivery",
        { client }
      )
    ).toMatchObject({ status: 409 });
    expect(
      (await f.db.query("select distinct status from external_agent_runs")).rows
    ).toEqual([{ status: "streaming" }]);
  } finally {
    await f.db.close();
  }
});
