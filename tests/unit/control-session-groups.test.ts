import assert from "node:assert/strict";
import test from "node:test";
import {
  GENERAL_GROUP_NAME,
  groupSessionsByProject,
  projectColorClass,
} from "../../lib/control/session-groups";

const SESSION = (id: string, project: string | null, updatedAt: string) => ({
  id,
  project,
  updated_at: updatedAt,
});

test("groupSessionsByProject clusters sessions under their project", () => {
  const groups = groupSessionsByProject([
    SESSION("a", "t3chat", "2026-08-10T10:00:00Z"),
    SESSION("b", "t3chat", "2026-08-10T12:00:00Z"),
    SESSION("c", "lawn", "2026-08-10T11:00:00Z"),
    SESSION("d", null, "2026-08-10T09:00:00Z"),
  ]);

  assert.deepEqual(
    groups.map((g) => [g.name, g.sessions.map((s) => s.id)]),
    [
      ["t3chat", ["b", "a"]],
      ["lawn", ["c"]],
      [GENERAL_GROUP_NAME, ["d"]],
    ]
  );
});

test("groupSessionsByProject sorts groups by latest activity, General last", () => {
  const groups = groupSessionsByProject([
    SESSION("old", "alpha", "2026-08-01T00:00:00Z"),
    SESSION("new", null, "2026-08-10T00:00:00Z"),
    SESSION("mid", "beta", "2026-08-05T00:00:00Z"),
  ]);

  // General has the newest session but still sorts last.
  assert.deepEqual(
    groups.map((g) => g.name),
    ["beta", "alpha", GENERAL_GROUP_NAME]
  );
});

test("groupSessionsByProject treats blank projects as General", () => {
  const groups = groupSessionsByProject([
    SESSION("a", "   ", "2026-08-10T00:00:00Z"),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].project, null);
});

test("projectColorClass is deterministic and uses the accent palette", () => {
  assert.equal(projectColorClass("t3chat"), projectColorClass("t3chat"));
  assert.match(projectColorClass("t3chat"), /^bg-(accent-|primary)/);
});
