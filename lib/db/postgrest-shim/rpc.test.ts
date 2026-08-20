import { describe, expect, it } from "vitest";
import type { Queryable } from "../sql";
import { executeRpc } from "./rpc";

type QueryCall = { text: string; values: unknown[] };

function createDb(functionRow: Record<string, unknown>) {
  const calls: QueryCall[] = [];
  const db: Queryable = {
    async query(text, values = []) {
      calls.push({ text, values });
      if (text.includes("from pg_proc")) return { rows: [functionRow] };
      return { rows: [{ value: null }] };
    },
  };
  return { calls, db };
}

function scalarFunction(
  argumentNames: unknown,
  argumentTypes: unknown
): Record<string, unknown> {
  return {
    returns_set: false,
    type_name: "jsonb",
    type_type: "b",
    argument_names: argumentNames,
    argument_types: argumentTypes,
  };
}

describe("executeRpc", () => {
  it("serializes jsonb arrays while preserving native Postgres arrays", async () => {
    const { calls, db } = createDb(
      scalarFunction(["p_constraints", "p_tasks"], ["text[]", "jsonb"])
    );
    const tasks = [{ slug: "update-default-model" }];

    const result = await executeRpc(db, new Map(), "mixed_arrays", {
      p_constraints: ["keep compatible"],
      p_tasks: tasks,
    });

    expect(result.error).toBeNull();
    expect(calls[1]).toEqual({
      text: expect.stringContaining('"p_tasks" => $2::jsonb'),
      values: [["keep compatible"], JSON.stringify(tasks)],
    });
  });

  it("serializes arrays for json parameters", async () => {
    const { calls, db } = createDb(scalarFunction(["p_payload"], ["json"]));
    const payload = [{ slug: "update-default-model" }];

    const result = await executeRpc(db, new Map(), "accept_json", {
      p_payload: payload,
    });

    expect(result.error).toBeNull();
    expect(calls[1]).toEqual({
      text: expect.stringContaining('"p_payload" => $1::json'),
      values: [JSON.stringify(payload)],
    });
  });

  it("preserves SQL null for jsonb parameters", async () => {
    const { calls, db } = createDb(scalarFunction(["p_payload"], ["jsonb"]));

    const result = await executeRpc(db, new Map(), "accept_jsonb", {
      p_payload: null,
    });

    expect(result.error).toBeNull();
    expect(calls[1]).toEqual({
      text: expect.stringContaining('"p_payload" => $1)'),
      values: [null],
    });
  });

  it("passes Dates as scalar ISO strings", async () => {
    const { calls, db } = createDb(
      scalarFunction(["p_claimed_at"], ["timestamp with time zone"])
    );
    const claimedAt = new Date("2026-08-03T12:34:56.789Z");

    const result = await executeRpc(db, new Map(), "echo_claimed_at", {
      p_claimed_at: claimedAt,
    });

    expect(result.error).toBeNull();
    expect(calls[1]).toEqual({
      text: expect.stringContaining('"p_claimed_at" => $1)'),
      values: [claimedAt.toISOString()],
    });
  });

  it("handles functions whose argument catalog arrays are null", async () => {
    const { calls, db } = createDb(scalarFunction(null, null));

    const result = await executeRpc(db, new Map(), "zero_args");

    expect(result.error).toBeNull();
    expect(calls[1]).toEqual({
      text: 'select "zero_args"() as value',
      values: [],
    });
  });
});
