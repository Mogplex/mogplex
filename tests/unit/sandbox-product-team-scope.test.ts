import assert from "node:assert/strict";
import test from "node:test";
import { applyProductTeamScope } from "@/lib/sandbox/product-team-scope";

test("applyProductTeamScope treats only nullish team ids as personal scope", () => {
  const calls: Array<["eq" | "is", string, string | null]> = [];
  const query = {
    eq(column: "product_team_id", value: string) {
      calls.push(["eq", column, value]);
      return this;
    },
    is(column: "product_team_id", value: null) {
      calls.push(["is", column, value]);
      return this;
    },
  };

  assert.equal(applyProductTeamScope(query, "team-123"), query);
  assert.deepEqual(calls, [["eq", "product_team_id", "team-123"]]);

  calls.length = 0;
  assert.equal(applyProductTeamScope(query, null), query);
  assert.equal(applyProductTeamScope(query, undefined), query);
  assert.deepEqual(calls, [
    ["is", "product_team_id", null],
    ["is", "product_team_id", null],
  ]);
});

test("applyProductTeamScope rejects empty string team ids", () => {
  assert.throws(
    () =>
      applyProductTeamScope(
        {
          eq: () => {
            throw new Error("eq should not be called");
          },
          is: () => {
            throw new Error("is should not be called");
          },
        },
        ""
      ),
    /empty string is not a valid team id/
  );
});
