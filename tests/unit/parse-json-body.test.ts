import assert from "node:assert/strict";
import test from "node:test";
import { parseJsonBody } from "../../lib/api/parse-json-body";

test("parseJsonBody preserves valid JSON without schema validation", async () => {
  for (const body of [{ name: "rule" }, null, [], "text", 7, false]) {
    const result = await parseJsonBody<unknown>(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify(body),
      })
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.body, body);
  }
});

test("parseJsonBody rejects malformed and empty bodies with a safe 400", async () => {
  for (const body of ['{"name":', "", "   "]) {
    const result = await parseJsonBody<unknown>(
      new Request("http://localhost", { method: "POST", body })
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.response.status, 400);
      assert.deepEqual(await result.response.json(), {
        error: "Invalid JSON body.",
      });
    }
  }
});
