import { describe, expect, it } from "vitest";
import type { Queryable } from "../sql";
import { executeRpc } from "./rpc";

describe("executeRpc", () => {
  it("serializes jsonb arrays while preserving native Postgres arrays", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const db: Queryable = {
      async query(text, values = []) {
        calls.push({ text, values });
        if (text.includes("from pg_proc")) {
          return {
            rows: [
              {
                returns_set: false,
                type_name: "jsonb",
                type_type: "b",
                argument_names: ["p_constraints", "p_tasks"],
                argument_types: ["text[]", "jsonb"],
              },
            ],
          };
        }
        return { rows: [{ value: [] }] };
      },
    };
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
});
