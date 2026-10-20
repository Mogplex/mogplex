import assert from "node:assert/strict";
import test from "node:test";

import { teamIconUrlFromPath } from "../../lib/team-icons";

test("teamIconUrlFromPath returns null for null path", () => {
  assert.equal(teamIconUrlFromPath(null), null);
});

test("teamIconUrlFromPath builds a same-origin storage URL", () => {
  assert.equal(
    teamIconUrlFromPath("team-123/1700000000-abc.png"),
    "/storage/v1/object/public/team-icons/team-123/1700000000-abc.png"
  );
});

test("teamIconUrlFromPath ignores leftover Supabase URLs", () => {
  const previous = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  try {
    assert.equal(
      teamIconUrlFromPath("team-123/icon.png"),
      "/storage/v1/object/public/team-icons/team-123/icon.png"
    );
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previous;
  }
});

test("teamIconUrlFromPath rejects paths with traversal or query characters", () => {
  assert.equal(teamIconUrlFromPath("../escape.png"), null);
  assert.equal(teamIconUrlFromPath("team-123/../escape.png"), null);
  assert.equal(teamIconUrlFromPath("team-123/.."), null);
  assert.equal(teamIconUrlFromPath("team-123/."), null);
  assert.equal(teamIconUrlFromPath("team-123/...png"), null);
  assert.equal(teamIconUrlFromPath("team-123/file?x=1.png"), null);
  assert.equal(teamIconUrlFromPath("team-123/file with space.png"), null);
  assert.equal(teamIconUrlFromPath("no-slash.png"), null);
  assert.equal(teamIconUrlFromPath("team-123/sub/dir/file.png"), null);
});
