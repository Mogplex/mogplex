import assert from "node:assert/strict";
import test from "node:test";

import { teamIconUrlFromPath } from "../../lib/team-icons";

const PUBLIC_URL = "https://example.supabase.co";
const SERVER_URL = "https://server.supabase.co";

function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => void
): void {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    previous[key] = process.env[key];
    if (vars[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = vars[key];
    }
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
}

test("teamIconUrlFromPath returns null for null path", () => {
  withEnv(
    { NEXT_PUBLIC_SUPABASE_URL: PUBLIC_URL, SUPABASE_URL: undefined },
    () => {
      assert.equal(teamIconUrlFromPath(null), null);
    }
  );
});

test("teamIconUrlFromPath builds a public Supabase Storage URL", () => {
  withEnv(
    { NEXT_PUBLIC_SUPABASE_URL: PUBLIC_URL, SUPABASE_URL: undefined },
    () => {
      assert.equal(
        teamIconUrlFromPath("team-123/1700000000-abc.png"),
        "https://example.supabase.co/storage/v1/object/public/team-icons/team-123/1700000000-abc.png"
      );
    }
  );
});

test("teamIconUrlFromPath prefers NEXT_PUBLIC_SUPABASE_URL when both are set (browser-reachable)", () => {
  withEnv(
    { NEXT_PUBLIC_SUPABASE_URL: PUBLIC_URL, SUPABASE_URL: SERVER_URL },
    () => {
      assert.equal(
        teamIconUrlFromPath("team-123/1700000000-abc.png"),
        "https://example.supabase.co/storage/v1/object/public/team-icons/team-123/1700000000-abc.png"
      );
    }
  );
});

test("teamIconUrlFromPath falls back to SUPABASE_URL when the public var is unset", () => {
  withEnv(
    { NEXT_PUBLIC_SUPABASE_URL: undefined, SUPABASE_URL: SERVER_URL },
    () => {
      assert.equal(
        teamIconUrlFromPath("team-123/1700000000-abc.png"),
        "https://server.supabase.co/storage/v1/object/public/team-icons/team-123/1700000000-abc.png"
      );
    }
  );
});

test("teamIconUrlFromPath returns null when neither env var is set", () => {
  withEnv(
    { NEXT_PUBLIC_SUPABASE_URL: undefined, SUPABASE_URL: undefined },
    () => {
      assert.equal(teamIconUrlFromPath("team-123/1700000000-abc.png"), null);
    }
  );
});

test("teamIconUrlFromPath trims a trailing slash on the base URL", () => {
  withEnv(
    { NEXT_PUBLIC_SUPABASE_URL: `${PUBLIC_URL}/`, SUPABASE_URL: undefined },
    () => {
      assert.equal(
        teamIconUrlFromPath("team-123/1700000000-abc.png"),
        "https://example.supabase.co/storage/v1/object/public/team-icons/team-123/1700000000-abc.png"
      );
    }
  );
});

test("teamIconUrlFromPath rejects paths with traversal or query characters", () => {
  withEnv(
    { NEXT_PUBLIC_SUPABASE_URL: PUBLIC_URL, SUPABASE_URL: undefined },
    () => {
      assert.equal(teamIconUrlFromPath("../escape.png"), null);
      assert.equal(teamIconUrlFromPath("team-123/../escape.png"), null);
      assert.equal(teamIconUrlFromPath("team-123/.."), null);
      assert.equal(teamIconUrlFromPath("team-123/."), null);
      assert.equal(teamIconUrlFromPath("team-123/...png"), null);
      assert.equal(teamIconUrlFromPath("team-123/file?x=1.png"), null);
      assert.equal(teamIconUrlFromPath("team-123/file with space.png"), null);
      assert.equal(teamIconUrlFromPath("no-slash.png"), null);
      assert.equal(teamIconUrlFromPath("team-123/sub/dir/file.png"), null);
    }
  );
});
