import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PostgrestShim } from "@/lib/db/postgrest-shim";
import {
  createPostgrestTestDb,
  type TestIds,
  USER_A,
  USER_B,
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

describe("writes", () => {
  it("insert returns nothing without select and the row with select().single()", async () => {
    const minimal = await db
      .from("agents")
      .insert({ name: "Quiet", slug: "quiet", model: null });
    expect(minimal.error).toBeNull();
    expect(minimal.data).toBeNull();
    expect(minimal.status).toBe(201);

    const returned = await db
      .from("agents")
      .insert({ name: "Loud", slug: "loud", model: "gpt" })
      .select("name, model")
      .single();
    expect(returned.error).toBeNull();
    expect(returned.data).toEqual({ name: "Loud", model: "gpt" });
  });

  it("insert serializes jsonb columns from JS objects", async () => {
    const { data, error } = await db
      .from("repos")
      .insert({
        user_id: USER_B,
        name: "delta",
        metadata: { nested: { deep: true }, list: [1, 2] },
      })
      .select("name, metadata")
      .single();
    expect(error).toBeNull();
    expect(data).toEqual({
      name: "delta",
      metadata: { nested: { deep: true }, list: [1, 2] },
    });
  });

  it("surfaces unique violations as error.code 23505", async () => {
    const { error } = await db
      .from("repos")
      .insert({ user_id: USER_A, name: "alpha" });
    expect(error?.code).toBe("23505");
  });

  it("update with filters + select returns updated rows; unfiltered update refuses", async () => {
    const updated = await db
      .from("repos")
      .update({ stars: 6 })
      .eq("id", ids.repoAlpha)
      .select("name, stars")
      .single();
    expect(updated.error).toBeNull();
    expect(updated.data).toEqual({ name: "alpha", stars: 6 });

    const refused = await db.from("repos").update({ stars: 0 });
    expect(refused.error?.message).toContain("refusing unfiltered update");
  });

  it("upsert updates on conflict and can ignore duplicates", async () => {
    const first = await db
      .from("storage_objects")
      .upsert(
        {
          bucket: "b",
          name: "x.png",
          content_type: "image/png",
          data: Buffer.from("v1"),
        },
        { onConflict: "bucket,name" }
      )
      .select("name, content_type")
      .single();
    expect(first.error).toBeNull();

    const overwritten = await db
      .from("storage_objects")
      .upsert(
        {
          bucket: "b",
          name: "x.png",
          content_type: "image/webp",
          data: Buffer.from("v2"),
        },
        { onConflict: "bucket,name" }
      )
      .select("content_type")
      .single();
    expect(overwritten.data).toEqual({ content_type: "image/webp" });

    const ignored = await db.from("storage_objects").upsert(
      {
        bucket: "b",
        name: "x.png",
        content_type: "image/gif",
        data: Buffer.from("v3"),
      },
      { onConflict: "bucket,name", ignoreDuplicates: true }
    );
    expect(ignored.error).toBeNull();
    const still = await db
      .from("storage_objects")
      .select("content_type")
      .eq("bucket", "b")
      .eq("name", "x.png")
      .single();
    expect(still.data).toEqual({ content_type: "image/webp" });
  });

  it("delete removes rows and returns them with select; unfiltered delete refuses", async () => {
    await db.from("agents").insert({ name: "Doomed", slug: "doomed" });
    const removed = await db
      .from("agents")
      .delete()
      .eq("slug", "doomed")
      .select("name");
    expect(removed.data).toEqual([{ name: "Doomed" }]);

    const refused = await db.from("agents").delete();
    expect(refused.error?.message).toContain("refusing unfiltered delete");
  });
});
