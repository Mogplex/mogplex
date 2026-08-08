import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const MEMORIES_MIGRATION =
  "supabase/migrations/20260417203014_memories_table.sql";

// The Neon database was bootstrapped as a 1:1 structural mirror of the
// Supabase migration chain, so the memories migration below is exactly the
// SQL the live DB carries. This battery proves that SQL — pgvector column,
// HNSW index, and the match_memories RPC — works on a fresh Postgres, which
// is the regression that would otherwise only surface as a runtime failure
// in lib/memories-client.ts searchMemories.
const BOOTSTRAP_STUBS = /* sql */ `
  create schema if not exists public;
  create table public.profiles (id uuid primary key);
  create function public.current_profile_id() returns uuid
    language sql stable as $$ select null::uuid $$;
`;

const USER_A = "00000000-0000-4000-8000-00000000000a";
const USER_B = "00000000-0000-4000-8000-00000000000b";

/** 1536-dim unit vector with a 1 at `axis`, as a pgvector literal. */
function unitVector(axis: number): string {
  const values = Array.from({ length: 1536 }).fill(0);
  values[axis] = 1;
  return `[${values.join(",")}]`;
}

/** Vector between axes 0 and 1: cosine similarity ~0.707 against axis 0. */
function diagonalVector(): string {
  const values = Array.from({ length: 1536 }).fill(0);
  values[0] = 1;
  values[1] = 1;
  return `[${values.join(",")}]`;
}

type MatchRow = {
  content: string;
  lane: string;
  similarity: number;
};

let db: PGlite;

async function insertMemory(input: {
  userId: string;
  lane: string;
  content: string;
  embedding: string | null;
}): Promise<void> {
  await db.query(
    `insert into public.memories (user_id, lane, content, embedding)
     values ($1, $2, $3, $4)`,
    [input.userId, input.lane, input.content, input.embedding]
  );
}

beforeAll(async () => {
  db = await PGlite.create({ extensions: { vector } });
  await db.exec(BOOTSTRAP_STUBS);
  const sql = await readFile(path.join(REPO_ROOT, MEMORIES_MIGRATION), "utf8");
  await db.exec(sql);

  await db.query(`insert into public.profiles (id) values ($1), ($2)`, [
    USER_A,
    USER_B,
  ]);
  await insertMemory({
    userId: USER_A,
    lane: "semantic",
    content: "exact match",
    embedding: unitVector(0),
  });
  await insertMemory({
    userId: USER_A,
    lane: "semantic",
    content: "diagonal match",
    embedding: diagonalVector(),
  });
  await insertMemory({
    userId: USER_A,
    lane: "procedural",
    content: "other lane",
    embedding: unitVector(0),
  });
  await insertMemory({
    userId: USER_A,
    lane: "semantic",
    content: "not embedded",
    embedding: null,
  });
  await insertMemory({
    userId: USER_B,
    lane: "semantic",
    content: "other user",
    embedding: unitVector(0),
  });
});

afterAll(async () => {
  await db.close();
});

async function matchMemories(input: {
  lane?: string | null;
  userId?: string;
  count?: number;
}): Promise<MatchRow[]> {
  const { rows } = await db.query<MatchRow>(
    `select content, lane, similarity
     from public.match_memories($1::vector(1536), $2::uuid, $3, $4)`,
    [
      unitVector(0),
      input.userId ?? USER_A,
      input.lane ?? null,
      input.count ?? 20,
    ]
  );
  return rows;
}

describe("match_memories RPC (memories migration on fresh Postgres + pgvector)", () => {
  it("should rank results by cosine similarity, best first", async () => {
    const rows = await matchMemories({ lane: "semantic" });
    expect(rows.map((row) => row.content)).toEqual([
      "exact match",
      "diagonal match",
    ]);
    expect(rows[0].similarity).toBeCloseTo(1, 5);
    expect(rows[1].similarity).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it("should search across lanes when no lane is given", async () => {
    const rows = await matchMemories({});
    expect(rows.map((row) => row.content)).toContain("other lane");
    expect(rows).toHaveLength(3);
  });

  it("should never return rows for another user", async () => {
    const rows = await matchMemories({});
    expect(rows.map((row) => row.content)).not.toContain("other user");
  });

  it("should exclude rows that have no embedding", async () => {
    const rows = await matchMemories({});
    expect(rows.map((row) => row.content)).not.toContain("not embedded");
  });

  it("should respect match_count", async () => {
    const rows = await matchMemories({ count: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe("exact match");
  });
});
