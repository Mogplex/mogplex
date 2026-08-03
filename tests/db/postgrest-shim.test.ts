// Battery for the pg-backed PostgREST shim against a real (PGlite) Postgres.
// Every operator, embed shape, rpc return kind, and error contract the app's
// supabaseAdmin call sites rely on is pinned here — this suite is the license
// to flip MOGPLEX_DATA_BACKEND=neon without rewriting 150+ call sites.
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SHIM_TYPE_PARSERS } from "@/lib/db/pool";
import {
  createPostgrestShim,
  parseSelect,
  type PostgrestShim,
  type Queryable,
} from "@/lib/db/postgrest-shim";

const SCHEMA = /* sql */ `
  create table teams (
    id uuid primary key default gen_random_uuid(),
    slug text unique not null,
    name text not null,
    icon_path text
  );

  create table profiles (
    id uuid primary key default gen_random_uuid(),
    full_name text,
    email text unique
  );

  create table team_members (
    team_id uuid not null references teams(id),
    user_id uuid not null references profiles(id),
    role text not null default 'member',
    primary key (team_id, user_id)
  );

  create table repos (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    name text not null,
    stars int not null default 0,
    cost_usd numeric,
    total_bytes bigint,
    metadata jsonb,
    health_status text,
    is_hidden boolean,
    last_active_at timestamptz,
    unique (user_id, name)
  );

  create table agents (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    slug text not null,
    model text
  );

  create table assignments (
    id uuid primary key default gen_random_uuid(),
    repo_id uuid not null references repos(id),
    agent_id uuid references agents(id),
    status text not null default 'idle'
  );

  create table storage_objects (
    bucket text not null,
    name text not null,
    content_type text not null default 'application/octet-stream',
    data bytea not null,
    updated_at timestamptz not null default now(),
    primary key (bucket, name)
  );

  create table "user" (
    id uuid primary key,
    email text,
    name text,
    image text
  );

  create function get_answer(question text) returns text
  language sql as $$ select 'answer:' || question $$;

  create function stats_snapshot() returns jsonb
  language sql as $$ select '{"calls": 3}'::jsonb $$;

  create function list_repo_names(p_user uuid) returns setof text
  language sql as $$ select name from repos where user_id = p_user order by name $$;

  create function repo_summaries(p_user uuid) returns table(name text, stars int)
  language sql as $$ select name, stars from repos where user_id = p_user order by name $$;

  create function touch_nothing() returns void
  language sql as $$ select 1 $$;

  create function raise_no_data() returns void
  language plpgsql as $$ begin
    raise exception 'row missing' using errcode = 'P0002';
  end $$;

  create function merge_meta(p_repo uuid, p_meta jsonb) returns jsonb
  language sql as $$
    update repos set metadata = coalesce(metadata, '{}'::jsonb) || p_meta
    where id = p_repo returning metadata
  $$;

  create function echo_claimed_at(p_claimed_at timestamptz) returns timestamptz
  language sql as $$ select p_claimed_at $$;

  -- FK cycle mirroring flows↔flow_versions: two constraints link the tables,
  -- so embeds must use a constraint-name hint to pick the right one.
  create table pipelines (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    published_version_id uuid
  );

  create table pipeline_versions (
    id uuid primary key default gen_random_uuid(),
    pipeline_id uuid not null references pipelines(id),
    label text not null
  );

  alter table pipelines
    add constraint pipelines_published_version_id_fkey
    foreign key (published_version_id) references pipeline_versions(id);
`;

const USER_A = "00000000-0000-4000-8000-00000000000a";
const USER_B = "00000000-0000-4000-8000-00000000000b";

let pglite: PGlite;
let db: PostgrestShim;

// Row ids captured during seeding for use across cases.
const ids = {
  repoAlpha: "",
  repoBeta: "",
  repoHidden: "",
  agentScout: "",
  teamCore: "",
  profileAda: "",
};

async function seed(queryable: Queryable) {
  const insert = async (sql: string, params: unknown[] = []) =>
    (await queryable.query(sql, params)).rows[0];

  const alpha = await insert(
    `insert into repos (user_id, name, stars, cost_usd, total_bytes, metadata, health_status, last_active_at)
     values ($1, 'alpha', 5, 12.75, 123456789, '{"agent_id": "ag-1", "tier": "gold"}', 'healthy', now() - interval '1 hour')
     returning id`,
    [USER_A]
  );
  const beta = await insert(
    `insert into repos (user_id, name, stars, metadata, health_status)
     values ($1, 'beta', 11, null, null) returning id`,
    [USER_A]
  );
  const hidden = await insert(
    `insert into repos (user_id, name, stars, is_hidden, health_status)
     values ($1, 'gamma', 0, true, 'stopped') returning id`,
    [USER_B]
  );
  const scout = await insert(
    `insert into agents (name, slug, model) values ('Scout', 'scout', 'claude') returning id`
  );
  await queryable.query(
    `insert into assignments (repo_id, agent_id, status) values ($1, $2, 'active'), ($1, null, 'idle')`,
    [alpha.id, scout.id]
  );
  const ada = await insert(
    `insert into profiles (full_name, email) values ('Ada', 'ada@example.test') returning id`
  );
  const team = await insert(
    `insert into teams (slug, name, icon_path) values ('core', 'Core', '/icons/core.png') returning id`
  );
  await queryable.query(
    `insert into team_members (team_id, user_id, role) values ($1, $2, 'owner')`,
    [team.id, ada.id]
  );
  await queryable.query(
    `insert into "user" (id, email, name, image) values ($1, 'ada@example.test', 'Ada', null)`,
    [ada.id]
  );

  const pipeline = await insert(
    `insert into pipelines (name) values ('deploy') returning id`
  );
  const publishedVersion = await insert(
    `insert into pipeline_versions (pipeline_id, label) values ($1, 'v2') returning id`,
    [pipeline.id]
  );
  await queryable.query(
    `insert into pipeline_versions (pipeline_id, label) values ($1, 'v1-draft')`,
    [pipeline.id]
  );
  await queryable.query(
    `update pipelines set published_version_id = $1 where id = $2`,
    [publishedVersion.id, pipeline.id]
  );

  ids.repoAlpha = String(alpha.id);
  ids.repoBeta = String(beta.id);
  ids.repoHidden = String(hidden.id);
  ids.agentScout = String(scout.id);
  ids.teamCore = String(team.id);
  ids.profileAda = String(ada.id);
}

beforeAll(async () => {
  // Same numeric/bigint→number parsers production installs on the pg Pool
  // (lib/db/pool.ts) — PostgREST returned JSON numbers for these types, and
  // this battery pins that contract for the shim.
  pglite = new PGlite({
    parsers: Object.fromEntries(
      Object.entries(SHIM_TYPE_PARSERS).map(([oid, parse]) => [
        Number(oid),
        parse,
      ])
    ),
  });
  await pglite.exec(SCHEMA);
  const queryable: Queryable = {
    query: async (text, values) => {
      const result = await pglite.query(text, values ?? []);
      return { rows: result.rows as Record<string, unknown>[] };
    },
  };
  await seed(queryable);
  db = createPostgrestShim(queryable);
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
    // "2026-08-03T15:00:20.638+00:00" — T separator, full zone offset.
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

describe("single / maybeSingle", () => {
  it("single() returns the row and errors with PGRST116 on zero rows", async () => {
    const found = await db
      .from("repos")
      .select("name")
      .eq("id", ids.repoAlpha)
      .single();
    expect(found.error).toBeNull();
    expect(found.data).toEqual({ name: "alpha" });

    const missing = await db
      .from("repos")
      .select("name")
      .eq("name", "does-not-exist")
      .single();
    expect(missing.data).toBeNull();
    expect(missing.error?.code).toBe("PGRST116");
  });

  it("maybeSingle() returns null on zero rows and PGRST116 on many", async () => {
    const none = await db
      .from("repos")
      .select("name")
      .eq("name", "does-not-exist")
      .maybeSingle();
    expect(none.error).toBeNull();
    expect(none.data).toBeNull();

    const many = await db
      .from("repos")
      .select("name")
      .eq("user_id", USER_A)
      .maybeSingle();
    expect(many.error?.code).toBe("PGRST116");
  });
});

describe("embedded resources", () => {
  it("embeds many-to-one as an object", async () => {
    const { data, error } = await db
      .from("assignments")
      .select("status, agents(id, name, slug, model)")
      .eq("repo_id", ids.repoAlpha)
      .order("status");
    expect(error).toBeNull();
    expect(data).toEqual([
      {
        status: "active",
        agents: {
          id: ids.agentScout,
          name: "Scout",
          slug: "scout",
          model: "claude",
        },
      },
      { status: "idle", agents: null },
    ]);
  });

  it("embeds with alias (team:teams)", async () => {
    const { data } = await db
      .from("team_members")
      .select("role, team:teams(id, slug, name, icon_path)")
      .eq("user_id", ids.profileAda)
      .single();
    expect(data).toEqual({
      role: "owner",
      team: {
        id: ids.teamCore,
        slug: "core",
        name: "Core",
        icon_path: "/icons/core.png",
      },
    });
  });

  it("embeds one-to-many as an array (empty stays [])", async () => {
    const withRows = await db
      .from("repos")
      .select("name, assignments(status)")
      .eq("id", ids.repoAlpha)
      .single();
    expect(
      (withRows.data as { assignments: { status: string }[] }).assignments
        .map((a) => a.status)
        .sort()
    ).toEqual(["active", "idle"]);

    const withoutRows = await db
      .from("repos")
      .select("name, assignments(status)")
      .eq("id", ids.repoBeta)
      .single();
    expect(withoutRows.data).toEqual({ name: "beta", assignments: [] });
  });

  it("resolves FK-name-hinted embeds across a constraint cycle", async () => {
    // pipelines↔pipeline_versions has two FKs (mirroring flows↔flow_versions);
    // the hint must select pipelines.published_version_id, not the reverse FK.
    const { data, error } = await db
      .from("pipelines")
      .select(
        "name, published_version:pipeline_versions!pipelines_published_version_id_fkey(label)"
      )
      .eq("name", "deploy")
      .single();
    expect(error).toBeNull();
    expect(data).toEqual({
      name: "deploy",
      published_version: { label: "v2" },
    });

    // The reverse hint picks the child-side FK: all versions as an array.
    const versions = await db
      .from("pipelines")
      .select(
        "name, versions:pipeline_versions!pipeline_versions_pipeline_id_fkey(label)"
      )
      .eq("name", "deploy")
      .single();
    expect(versions.error).toBeNull();
    expect(
      (versions.data as { versions: { label: string }[] }).versions
        .map((v) => v.label)
        .sort()
    ).toEqual(["v1-draft", "v2"]);
  });

  it("errors clearly on an unknown FK hint", async () => {
    const { error } = await db
      .from("pipelines")
      .select("name, pipeline_versions!does_not_exist_fkey(label)")
      .eq("name", "deploy")
      .single();
    expect(error?.message).toContain("no foreign key named");
  });

  it("embeds two levels deep", async () => {
    const { data, error } = await db
      .from("repos")
      .select("name, assignments(status, agents(name))")
      .eq("id", ids.repoAlpha)
      .single();
    expect(error).toBeNull();
    const assignments = (
      data as {
        assignments: { status: string; agents: { name: string } | null }[];
      }
    ).assignments;
    expect(assignments.find((a) => a.status === "active")?.agents).toEqual({
      name: "Scout",
    });
    expect(assignments.find((a) => a.status === "idle")?.agents).toBeNull();
  });

  it("!inner with an embed filter restricts parent rows", async () => {
    const { data, error } = await db
      .from("assignments")
      .select("id, repo_id, repos!inner(user_id)")
      .eq("repos.user_id", USER_A);
    expect(error).toBeNull();
    expect((data as unknown[]).length).toBe(2);

    const otherUser = await db
      .from("assignments")
      .select("id, repos!inner(user_id)")
      .eq("repos.user_id", USER_B);
    expect(otherUser.data).toEqual([]);
  });
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
    expect(summaries.data).toEqual([
      { name: "alpha", stars: 6 },
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
