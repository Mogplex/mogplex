import assert from "node:assert/strict";
import test from "node:test";
import { pickControlSessionUpdateFields } from "../../lib/control/session-update";

test("pickControlSessionUpdateFields excludes ownership and immutable fields", () => {
  assert.deepEqual(
    pickControlSessionUpdateFields({
      id: "session-1",
      expected_updated_at: "2026-08-12T00:00:00.000Z",
      title: "Updated title",
      project: "Mogplex/mogplex",
      repo_id: "00000000-0000-4000-8000-000000000001",
      messages: [{ role: "user", content: "hello" }],
      pinned: true,
      archived: false,
      user_id: "victim-user-id",
      created_at: "2020-01-01T00:00:00.000Z",
      updated_at: "2020-01-01T00:00:00.000Z",
    }),
    {
      title: "Updated title",
      project: "Mogplex/mogplex",
      repo_id: "00000000-0000-4000-8000-000000000001",
      messages: [{ role: "user", content: "hello" }],
      pinned: true,
      archived: false,
    }
  );
});

test("pickControlSessionUpdateFields preserves omitted optional fields", () => {
  assert.deepEqual(pickControlSessionUpdateFields({ archived: true }), {
    archived: true,
  });
});
