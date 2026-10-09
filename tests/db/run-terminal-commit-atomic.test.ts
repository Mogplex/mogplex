import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { expect, test } from "vitest";
import { applyNeonMigrations } from "@/lib/db/neon-migrations";

const userId = "00000000-0000-4000-8000-000000000001";
const repoId = "00000000-0000-4000-8000-000000000002";
const runId = "00000000-0000-4000-8000-000000000003";
const aiCallId = "00000000-0000-4000-8000-000000000004";
const workspaceId = "00000000-0000-4000-8000-000000000005";

test("atomic metadata update merges without clobbering concurrent keys", async () => {
  const db = await PGlite.create({
    extensions: { vector, pg_trgm, pgcrypto, uuid_ossp },
  });
  try {
    expect(
      (await applyNeonMigrations(db, { log: () => {}, warn: () => {} })).ok
    ).toBe(true);

    // Setup: create profile, workspace, repo, ai_call, and run with existing metadata
    await db.query("insert into profiles(id) values ($1)", [userId]);
    await db.query(
      `insert into workspaces(id, user_id, name, owner_type, owner_user_id) values ($1, $2, 'test-workspace', 'user', $2)`,
      [workspaceId, userId]
    );
    await db.query(
      `insert into repos(id, user_id, full_name, name, github_installation_id, workspace_id, owner_type, owner_user_id)
       values ($1, $2, 'test/repo', 'repo', 123, $3, 'user', $2)`,
      [repoId, userId, workspaceId]
    );
    await db.query(
      `insert into ai_calls(id, user_id, type, model, status)
       values ($1, $2, 'agent', 'test', 'success')`,
      [aiCallId, userId]
    );
    await db.query(
      `insert into external_agent_runs(
        id, user_id, repo_id, ai_call_id, idempotency_key, request_hash,
        harness, status, prompt, base_branch, working_branch, create_branch,
        metadata
      ) values (
        $1, $2, $3, $4, 'key-1', 'hash-1',
        'mogplex', 'success', 'test', 'main', 'feature/test', true,
        '{"existing_key": "existing_value", "another_key": 42}'::jsonb
      )`,
      [runId, userId, repoId, aiCallId]
    );

    // Verify initial metadata
    const before = await db.query<{ metadata: Record<string, unknown> }>(
      "select metadata from external_agent_runs where id = $1",
      [runId]
    );
    expect(before.rows[0].metadata).toEqual({
      existing_key: "existing_value",
      another_key: 42,
    });

    // Execute the atomic merge (same SQL as updateRunMetadataAtomic)
    const sha = "abc123def456abc123def456abc123def456abc1";
    const result = await db.query(
      `UPDATE external_agent_runs
       SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object($1::text, $2::text),
           updated_at = now()
       WHERE id = $3 AND user_id = $4`,
      ["terminal_commit_sha", sha, runId, userId]
    );
    expect(result.affectedRows).toBe(1);

    // Verify: new key added without clobbering existing keys
    const after = await db.query<{ metadata: Record<string, unknown> }>(
      "select metadata from external_agent_runs where id = $1",
      [runId]
    );
    expect(after.rows[0].metadata).toEqual({
      existing_key: "existing_value",
      another_key: 42,
      terminal_commit_sha: sha,
    });
  } finally {
    await db.close();
  }
});

test("atomic metadata update handles empty metadata gracefully", async () => {
  const db = await PGlite.create({
    extensions: { vector, pg_trgm, pgcrypto, uuid_ossp },
  });
  try {
    expect(
      (await applyNeonMigrations(db, { log: () => {}, warn: () => {} })).ok
    ).toBe(true);

    await db.query("insert into profiles(id) values ($1)", [userId]);
    await db.query(
      `insert into workspaces(id, user_id, name, owner_type, owner_user_id) values ($1, $2, 'test-workspace', 'user', $2)`,
      [workspaceId, userId]
    );
    await db.query(
      `insert into repos(id, user_id, full_name, name, github_installation_id, workspace_id, owner_type, owner_user_id)
       values ($1, $2, 'test/repo', 'repo', 123, $3, 'user', $2)`,
      [repoId, userId, workspaceId]
    );
    await db.query(
      `insert into ai_calls(id, user_id, type, model, status)
       values ($1, $2, 'agent', 'test', 'success')`,
      [aiCallId, userId]
    );
    // Insert run with empty metadata (the default, representing a run without custom metadata yet)
    await db.query(
      `insert into external_agent_runs(
        id, user_id, repo_id, ai_call_id, idempotency_key, request_hash,
        harness, status, prompt, base_branch, working_branch, create_branch,
        metadata
      ) values (
        $1, $2, $3, $4, 'key-2', 'hash-2',
        'mogplex', 'success', 'test', 'main', 'feature/empty', true,
        '{}'::jsonb
      )`,
      [runId, userId, repoId, aiCallId]
    );

    // Execute the atomic merge on empty metadata
    const sha = "def456abc123def456abc123def456abc123def4";
    const result = await db.query(
      `UPDATE external_agent_runs
       SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object($1::text, $2::text),
           updated_at = now()
       WHERE id = $3 AND user_id = $4`,
      ["terminal_commit_sha", sha, runId, userId]
    );
    expect(result.affectedRows).toBe(1);

    // Verify: metadata populated with just the new key
    const after = await db.query<{ metadata: Record<string, unknown> }>(
      "select metadata from external_agent_runs where id = $1",
      [runId]
    );
    expect(after.rows[0].metadata).toEqual({
      terminal_commit_sha: sha,
    });
  } finally {
    await db.close();
  }
});

test("atomic metadata update is idempotent on repeated calls", async () => {
  const db = await PGlite.create({
    extensions: { vector, pg_trgm, pgcrypto, uuid_ossp },
  });
  try {
    expect(
      (await applyNeonMigrations(db, { log: () => {}, warn: () => {} })).ok
    ).toBe(true);

    await db.query("insert into profiles(id) values ($1)", [userId]);
    await db.query(
      `insert into workspaces(id, user_id, name, owner_type, owner_user_id) values ($1, $2, 'test-workspace', 'user', $2)`,
      [workspaceId, userId]
    );
    await db.query(
      `insert into repos(id, user_id, full_name, name, github_installation_id, workspace_id, owner_type, owner_user_id)
       values ($1, $2, 'test/repo', 'repo', 123, $3, 'user', $2)`,
      [repoId, userId, workspaceId]
    );
    await db.query(
      `insert into ai_calls(id, user_id, type, model, status)
       values ($1, $2, 'agent', 'test', 'success')`,
      [aiCallId, userId]
    );
    await db.query(
      `insert into external_agent_runs(
        id, user_id, repo_id, ai_call_id, idempotency_key, request_hash,
        harness, status, prompt, base_branch, working_branch, create_branch,
        metadata
      ) values (
        $1, $2, $3, $4, 'key-3', 'hash-3',
        'mogplex', 'success', 'test', 'main', 'feature/idempotent', true,
        '{}'::jsonb
      )`,
      [runId, userId, repoId, aiCallId]
    );

    const sha = "abc123abc123abc123abc123abc123abc123abc1";

    // First call
    await db.query(
      `UPDATE external_agent_runs
       SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object($1::text, $2::text),
           updated_at = now()
       WHERE id = $3 AND user_id = $4`,
      ["terminal_commit_sha", sha, runId, userId]
    );

    // Second call with same value (idempotent)
    await db.query(
      `UPDATE external_agent_runs
       SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object($1::text, $2::text),
           updated_at = now()
       WHERE id = $3 AND user_id = $4`,
      ["terminal_commit_sha", sha, runId, userId]
    );

    // Verify: still has the same value, not duplicated or corrupted
    const after = await db.query<{ metadata: Record<string, unknown> }>(
      "select metadata from external_agent_runs where id = $1",
      [runId]
    );
    expect(after.rows[0].metadata).toEqual({
      terminal_commit_sha: sha,
    });
  } finally {
    await db.close();
  }
});
