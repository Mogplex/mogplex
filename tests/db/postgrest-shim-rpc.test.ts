import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  parseSelect,
  type PostgrestShim,
  type Queryable,
} from "@/lib/db/postgrest-shim";
import { getFunctionShape } from "@/lib/db/postgrest-shim/rpc";
import {
  createPostgrestTestDb,
  type TestIds,
  USER_A,
} from "./helpers/postgrest-shim-fixtures";

let pglite: PGlite;
let db: PostgrestShim;
let ids: TestIds;
let queryable: Queryable;

beforeAll(async () => {
  const setup = await createPostgrestTestDb();
  pglite = setup.pglite;
  db = setup.db;
  ids = setup.ids;
  queryable = setup.queryable;
});

afterAll(async () => {
  await pglite.close();
});

describe("rpc", () => {
  it("returns scalar text and jsonb values directly", async () => {
    const scalar = await db.rpc("get_answer", { question: "why" });
    expect(scalar.error).toBeNull();
    expect(scalar.data).toBe("answer:why");

    const snapshot = await db.rpc("stats_snapshot");
    expect(snapshot.data).toEqual({ calls: 3 });
  });

  it("returns setof scalar as a bare array and setof table as rows", async () => {
    const names = await db.rpc("list_repo_names", { p_user: USER_A });
    expect(names.data).toEqual(["alpha", "beta"]);

    const summaries = await db.rpc("repo_summaries", { p_user: USER_A });
    // Seeded values: the pre-split combined file asserted 6 only because the
    // writes battery had already updated alpha before rpc ran.
    expect(summaries.data).toEqual([
      { name: "alpha", stars: 5 },
      { name: "beta", stars: 11 },
    ]);
  });

  it("returns null for void functions and passes jsonb args", async () => {
    const voidResult = await db.rpc("touch_nothing");
    expect(voidResult.error).toBeNull();
    expect(voidResult.data).toBeNull();

    const merged = await db.rpc("merge_meta", {
      p_repo: ids.repoAlpha,
      p_meta: { merged: true },
    });
    expect(merged.error).toBeNull();
    expect(merged.data).toMatchObject({ tier: "gold", merged: true });
  });

  it("maps JSON inputs correctly when OUT parameters precede them", async () => {
    const payload = [{ slug: "update-default-model" }];

    const shape = await getFunctionShape(
      queryable,
      new Map(),
      "echo_jsonb_after_out"
    );
    expect(shape.argumentTypes).toEqual({
      p_prefix: "text",
      p_payload: "jsonb",
    });

    const echoed = await db.rpc("echo_jsonb_after_out", {
      p_prefix: "accepted",
      p_payload: payload,
    });

    expect(echoed.error).toBeNull();
    expect(echoed.data).toEqual({
      p_ignored: "accepted",
      p_value: payload,
    });
  });

  it("serializes arrays for json parameters and jsonb domains", async () => {
    const payload = [{ slug: "update-default-model" }];

    const json = await db.rpc("echo_json", { p_payload: payload });
    expect(json.error).toBeNull();
    expect(json.data).toEqual(payload);

    const domain = await db.rpc("echo_domain_payload", {
      p_payload: payload,
    });
    expect(domain.error).toBeNull();
    expect(domain.data).toEqual(payload);
  });

  it("preserves SQL null for jsonb parameters", async () => {
    const result = await db.rpc("jsonb_is_sql_null", { p_payload: null });

    expect(result.error).toBeNull();
    expect(result.data).toBe(true);
  });

  it("passes Date args as scalars, not jsonb, so timestamptz params resolve", async () => {
    const claimedAt = new Date("2026-08-03T12:34:56.789Z");
    const echoed = await db.rpc("echo_claimed_at", { p_claimed_at: claimedAt });
    expect(echoed.error).toBeNull();
    expect(typeof echoed.data).toBe("string");
    expect(new Date(echoed.data as string).getTime()).toBe(claimedAt.getTime());
  });

  it("surfaces raised errcodes on error.code", async () => {
    const { error } = await db.rpc("raise_no_data");
    expect(error?.code).toBe("P0002");
    expect(error?.message).toContain("row missing");
  });

  it("errors cleanly on unknown functions", async () => {
    const { error } = await db.rpc("does_not_exist");
    expect(error?.message).toContain("unknown function");
  });
});

describe("storage + auth shims", () => {
  it("uploads with upsert, lists with pagination options, and builds public URLs", async () => {
    const bucket = db.storage.from("provider-icons");
    const uploaded = await bucket.upload(
      "openai.png",
      Buffer.from("png-bytes"),
      {
        contentType: "image/png",
        upsert: true,
      }
    );
    expect(uploaded.error).toBeNull();
    expect(uploaded.data).toEqual({ path: "openai.png" });

    const listed = await bucket.list("", {
      limit: 10,
      offset: 0,
      sortBy: { column: "name", order: "asc" },
    });
    expect(listed.error).toBeNull();
    expect(listed.data?.map((f) => f.name)).toContain("openai.png");

    expect(bucket.getPublicUrl("openai.png").data.publicUrl).toBe(
      "/storage/v1/object/public/provider-icons/openai.png"
    );
  });

  it("auth.admin.getUserById reads the better-auth user table", async () => {
    const found = await db.auth.admin.getUserById(ids.profileAda);
    expect(found.error).toBeNull();
    expect(found.data.user).toMatchObject({
      id: ids.profileAda,
      email: "ada@example.test",
      user_metadata: { name: "Ada", avatar_url: null },
    });

    const missing = await db.auth.admin.getUserById(
      "00000000-0000-4000-8000-0000000000ff"
    );
    expect(missing.data.user).toBeNull();
    expect(missing.error?.message).toBe("User not found");
  });
});

describe("select parser", () => {
  it("parses nested embeds with aliases and !inner", () => {
    expect(parseSelect("*, assignments(*, agents(*), repos(*))")).toEqual({
      fields: ["*"],
      embeds: [
        {
          alias: "assignments",
          table: "assignments",
          inner: false,
          fkHint: null,
          select: {
            fields: ["*"],
            embeds: [
              {
                alias: "agents",
                table: "agents",
                inner: false,
                fkHint: null,
                select: { fields: ["*"], embeds: [] },
              },
              {
                alias: "repos",
                table: "repos",
                inner: false,
                fkHint: null,
                select: { fields: ["*"], embeds: [] },
              },
            ],
          },
        },
      ],
    });

    expect(parseSelect("role, team:teams(id, slug)")).toEqual({
      fields: ["role"],
      embeds: [
        {
          alias: "team",
          table: "teams",
          inner: false,
          fkHint: null,
          select: { fields: ["id", "slug"], embeds: [] },
        },
      ],
    });

    expect(
      parseSelect(
        "id, published_version:flow_versions!flows_published_version_id_fkey(id, graph)"
      ).embeds[0]
    ).toMatchObject({
      alias: "published_version",
      table: "flow_versions",
      inner: false,
      fkHint: "flows_published_version_id_fkey",
    });

    expect(parseSelect("id, repos!inner(user_id)").embeds[0]).toMatchObject({
      alias: "repos",
      table: "repos",
      inner: true,
    });
  });
});
