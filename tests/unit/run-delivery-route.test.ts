import assert from "node:assert/strict";
import test from "node:test";
import { createRunDeliveryHandler } from "../../app/api/runs/[runId]/delivery/route";
import {
  deliveryRun,
  deliverySnapshot,
} from "../../lib/run-delivery/fixtures.test-support";

const runId = "00000000-0000-4000-8000-000000000901";
const params = { params: Promise.resolve({ runId }) };
const request = new Request("https://example.test/api/runs/delivery");
test("manual delivery refresh is owned, read-only, and does not reveal foreign runs", async () => {
  const run = { ...deliveryRun(), id: runId };
  const calls: boolean[] = [];
  const deps = {
    requireUserId: async () => run.user_id,
    load: async (user: string, id: string) =>
      user === run.user_id && id === runId ? run : null,
    refresh: async (_run: typeof run, repair = false) => {
      calls.push(repair);
      return deliverySnapshot();
    },
  };
  const response = await createRunDeliveryHandler(deps)(request, params);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).delivery.pullRequest.number, 42);
  assert.deepEqual(calls, [false]);
  assert.equal(
    (
      await createRunDeliveryHandler({
        ...deps,
        requireUserId: async () => "foreign",
      })(request, params)
    ).status,
    404
  );
  assert.equal(
    (
      await createRunDeliveryHandler(deps)(request, {
        params: Promise.resolve({ runId: "invalid" }),
      })
    ).status,
    400
  );
  const outage = await createRunDeliveryHandler({
    ...deps,
    refresh: async () => {
      throw new Error("private provider diagnostics");
    },
  })(request, params);
  assert.equal(outage.status, 503);
  assert.doesNotMatch(await outage.text(), /private provider diagnostics/);
});
