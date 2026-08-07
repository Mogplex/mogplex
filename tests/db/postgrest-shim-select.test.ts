import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PostgrestShim } from "@/lib/db/postgrest-shim";
import {
  createPostgrestTestDb,
  type TestIds,
  USER_A,
} from "./helpers/postgrest-shim-fixtures";

let pglite: PGlite;
let db: PostgrestShim;
let ids: TestIds;

beforeAll(async () => {
  const setup = await createPostgrestTestDb();
  pglite = setup.pglite;
  db = setup.db;
  ids = setup.ids;
});

afterAll(async () => {
  await pglite.close();
});

describe("select + filters", () => {
  it("selects columns with eq", async () => {
    const { data, error } = await db
      .from("repos")
      .select("name, stars")
      .eq("user_id", USER_A)
      .order("name", { ascending: true });
    expect(error).toBeNull();
    expect(data).toEqual([
      { name: "alpha", stars: 5 },
      { name: "beta", stars: 11 },
    ]);
  });

  it("returns numeric and bigint columns as numbers (PostgREST parity)", async () => {
    const { data, error } = await db
      .from("repos")
      .select("name, cost_usd, total_bytes")
      .eq("name", "alpha")
      .single();
    expect(error).toBeNull();
    expect(data).toEqual({
      name: "alpha",
      cost_usd: 12.75,
      total_bytes: 123_456_789,
    });
  });

  it("returns timestamptz columns as ISO-8601 strings (PostgREST parity)", async () => {
    const { data, error } = await db
      .from("repos")
      .select("name, last_active_at")
      .eq("name", "alpha")
      .single();
    expect(error).toBeNull();
    const lastActiveAt = (data as { last_active_at: unknown }).last_active_at;
    expect(typeof lastActiveAt).toBe("string");
    expect(lastActiveAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?[+-]\d{2}:\d{2}$/
    );
  });

  it("supports neq, gt, lte, in, ilike", async () => {
    const neq = await db
      .from("repos")
      .select("name")
      .neq("name", "alpha")
      .eq("user_id", USER_A);
    expect(neq.data).toEqual([{ name: "beta" }]);

    const gt = await db.from("repos").select("name").gt("stars", 10);
    expect(gt.data).toEqual([{ name: "beta" }]);

    const lte = await db.from("repos").select("name").lte("stars", 0);
    expect(lte.data).toEqual([{ name: "gamma" }]);

    const inList = await db
      .from("repos")
      .select("name")
      .in("id", [ids.repoAlpha, ids.repoHidden])
      .order("name");
    expect(inList.data).toEqual([{ name: "alpha" }, { name: "gamma" }]);

    const ilike = await db.from("repos").select("name").ilike("name", "ALP%");
    expect(ilike.data).toEqual([{ name: "alpha" }]);
  });

  it("supports is null / is boolean and negation via not()", async () => {
    const isNull = await db
      .from("repos")
      .select("name")
      .is("metadata", null)
      .order("name");
    expect(isNull.data).toEqual([{ name: "beta" }, { name: "gamma" }]);

    const isTrue = await db.from("repos").select("name").is("is_hidden", true);
    expect(isTrue.data).toEqual([{ name: "gamma" }]);

    const notNull = await db
      .from("repos")
      .select("name")
      .not("metadata", "is", null);
    expect(notNull.data).toEqual([{ name: "alpha" }]);
  });

  it("supports isDistinct, treating NULL as distinct (unlike neq)", async () => {
    const distinct = await db
      .from("repos")
      .select("name")
      .isDistinct("health_status", "stopped")
      .order("name");
    expect(distinct.data).toEqual([{ name: "alpha" }, { name: "beta" }]);

    const distinctFromNull = await db
      .from("repos")
      .select("name")
      .isDistinct("metadata", null);
    expect(distinctFromNull.data).toEqual([{ name: "alpha" }]);

    const viaOr = await db
      .from("repos")
      .select("name")
      .eq("user_id", USER_A)
      .or("health_status.isdistinct.healthy,metadata.isdistinct.null")
      .order("name");
    expect(viaOr.data).toEqual([{ name: "alpha" }, { name: "beta" }]);
  });

  it("filters through JSON arrow paths via eq, is, and filter()", async () => {
    const arrowEq = await db
      .from("repos")
      .select("name")
      .eq("metadata->>tier", "gold");
    expect(arrowEq.data).toEqual([{ name: "alpha" }]);

    const viaFilter = await db
      .from("repos")
      .select("name")
      .filter("metadata->>agent_id", "eq", "ag-1");
    expect(viaFilter.data).toEqual([{ name: "alpha" }]);
  });

  it("supports contains on jsonb and match()", async () => {
    const contains = await db
      .from("repos")
      .select("name")
      .contains("metadata", { tier: "gold" });
    expect(contains.data).toEqual([{ name: "alpha" }]);

    const match = await db
      .from("repos")
      .select("name")
      .match({ user_id: USER_A, name: "beta" });
    expect(match.data).toEqual([{ name: "beta" }]);
  });

  it("parses or() strings the way the app writes them", async () => {
    const orNullOrNeq = await db
      .from("repos")
      .select("name")
      .or("health_status.is.null,health_status.neq.stopped")
      .order("name");
    expect(orNullOrNeq.data).toEqual([{ name: "alpha" }, { name: "beta" }]);

    const cutoff = new Date(Date.now() + 60_000).toISOString();
    const orTemplate = await db
      .from("repos")
      .select("name")
      .eq("user_id", USER_A)
      .or(`last_active_at.is.null,last_active_at.lt.${cutoff}`)
      .order("name");
    expect(orTemplate.data).toEqual([{ name: "alpha" }, { name: "beta" }]);
  });

  it("orders with nulls handling, limits, and ranges", async () => {
    const ordered = await db
      .from("repos")
      .select("name")
      .order("health_status", { ascending: true, nullsFirst: false })
      .order("name");
    expect(ordered.data).toEqual([
      { name: "alpha" },
      { name: "gamma" },
      { name: "beta" },
    ]);

    const limited = await db
      .from("repos")
      .select("name")
      .order("name")
      .limit(2);
    expect(limited.data).toEqual([{ name: "alpha" }, { name: "beta" }]);

    const ranged = await db
      .from("repos")
      .select("name")
      .order("name")
      .range(1, 2);
    expect(ranged.data).toEqual([{ name: "beta" }, { name: "gamma" }]);
  });

  it("returns count with head:true without data", async () => {
    const { data, count, error } = await db
      .from("repos")
      .select("*", { count: "exact", head: true })
      .eq("user_id", USER_A);
    expect(error).toBeNull();
    expect(data).toBeNull();
    expect(count).toBe(2);
  });

  it("returns count alongside data with count:'exact'", async () => {
    const { data, count } = await db
      .from("repos")
      .select("name", { count: "exact" })
      .order("name")
      .limit(1);
    expect(count).toBe(3);
    expect(data).toEqual([{ name: "alpha" }]);
  });
});
