import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, expect, test } from "vitest";
import { createPostgrestShim } from "../../lib/db/postgrest-shim";

let db: PGlite;
const user = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const flow = "00000000-0000-4000-8000-000000000003";
const untouched = "00000000-0000-4000-8000-000000000004";
const graph = {
  nodes: [
    { id: "start", type: "start", data: {} },
    {
      id: "agent",
      type: "agent",
      data: { modelOverride: "custom", fallbackModelOverride: "fallback" },
    },
  ],
  edges: [],
};
const migration = "20260915173000_selective_model_defaults.sql";

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table profiles (id uuid primary key, default_model text, theme text);
    create table flows (id uuid primary key, user_id uuid, draft_graph jsonb, published_version_id uuid);
    create table flow_versions (id uuid primary key default gen_random_uuid(), flow_id uuid,
      version_number int, graph jsonb, unique(flow_id, version_number));
    insert into profiles values ('${user}', 'old', 'dark'), ('${other}', 'other', 'light');
  `);
});
afterAll(async () => {
  await db.close();
});

test("migration preserves unchecked surfaces and updates only selected owned automations atomically", async () => {
  const sql = await readFile(`neon/migrations/${migration}`, "utf8");
  expect(await readFile(`supabase/migrations/${migration}`, "utf8")).toBe(sql);
  await db.exec(sql);
  await db.query("insert into flows values ($1,$2,$3,null),($4,$2,$3,null)", [
    flow,
    user,
    graph,
    untouched,
  ]);
  const published = await db.query<{ id: string }>(
    "insert into flow_versions (flow_id,version_number,graph) values ($1,1,$2) returning id",
    [flow, { ...graph, publishedOnly: true }]
  );
  await db.query("update flows set published_version_id=$1 where id=$2", [
    published.rows[0].id,
    flow,
  ]);
  const client = createPostgrestShim({
    query: async (text, values) => {
      const result = await db.query<Record<string, unknown>>(
        text,
        values ?? []
      );
      return { rows: result.rows };
    },
  });
  const applied = await client.rpc("apply_model_defaults", {
    p_user_id: user,
    p_next_model: "new",
    p_expected_model: "old",
    p_previous_resolved: "old",
    p_surfaces: ["slack", "cli"],
    p_flow_ids: [flow],
    p_theme: null,
  });
  expect(applied.error).toBeNull();
  expect(applied.data).toEqual({ drafts_updated: 1, versions_published: 1 });
  const profile = await db.query<{
    default_model: string;
    surface_models: Record<string, string>;
  }>("select * from profiles where id=$1", [user]);
  expect(profile.rows[0].default_model).toBe("new");
  expect(profile.rows[0].surface_models).toEqual({
    chat: "old",
    control: "old",
    agents: "old",
    slack: "new",
    cli: "new",
  });
  const rows = await db.query<{
    id: string;
    draft_graph: typeof graph;
    graph: typeof graph & { publishedOnly?: boolean };
  }>(
    "select f.id,f.draft_graph,v.graph from flows f left join flow_versions v on v.id=f.published_version_id order by f.id"
  );
  expect(rows.rows[0].draft_graph.nodes[1].data.modelOverride).toBe("new");
  expect(rows.rows[0].graph.nodes[1].data.fallbackModelOverride).toBe(
    "fallback"
  );
  expect(rows.rows[0].graph.publishedOnly).toBe(true);
  expect(rows.rows[1].draft_graph).toEqual(graph);
  expect(
    (
      await db.query<{ graph: typeof graph }>(
        "select graph from flow_versions where id=$1",
        [published.rows[0].id]
      )
    ).rows[0].graph.nodes[1].data.modelOverride
  ).toBe("custom");

  // A second default-only change keeps each surface's own prior model.
  await db.query(
    "select apply_model_defaults($1, 'third', 'new', 'new', array[]::text[], array[]::uuid[], null)",
    [user]
  );
  expect(
    (
      await db.query<{ surface_models: unknown }>(
        "select surface_models from profiles where id=$1",
        [user]
      )
    ).rows[0].surface_models
  ).toEqual(profile.rows[0].surface_models);

  // Foreign automation IDs and stale settings reject the entire write.
  await expect(
    db.query(
      "select apply_model_defaults($1, 'bad', 'other', 'other', array['cli'], $2::uuid[], null)",
      [other, [flow]]
    )
  ).rejects.toThrow(/automation/i);
  await expect(
    db.query(
      "select apply_model_defaults($1, 'bad', 'old', 'old', array['cli'], array[]::uuid[], null)",
      [user]
    )
  ).rejects.toThrow(/changed/i);
  expect(
    (
      await db.query<{ default_model: string }>(
        "select default_model from profiles where id=$1",
        [other]
      )
    ).rows[0].default_model
  ).toBe("other");
  // A failure after the draft write rolls back the default, draft and publication.
  await db.exec(
    "create function fail_model_publish() returns trigger language plpgsql as $$ begin raise exception 'publish failed'; end $$; create trigger fail_publish before insert on flow_versions for each row execute function fail_model_publish();"
  );
  await expect(
    db.query(
      "select apply_model_defaults($1, 'broken', 'third', 'third', array['chat'], $2::uuid[], null)",
      [user, [flow]]
    )
  ).rejects.toThrow(/publish failed/);
  expect(
    (
      await db.query<{ default_model: string }>(
        "select default_model from profiles where id=$1",
        [user]
      )
    ).rows[0].default_model
  ).toBe("third");
  expect(
    (
      await db.query<{ draft_graph: typeof graph }>(
        "select draft_graph from flows where id=$1",
        [flow]
      )
    ).rows[0].draft_graph.nodes[1].data.modelOverride
  ).toBe("new");
  await db.exec("drop trigger fail_publish on flow_versions;");
  // Simulate an automation disappearing after validation but before it is locked.
  await db.exec(`create function remove_selected_flow() returns trigger language plpgsql as $$ begin
    delete from flows where id = '${untouched}'; return new; end $$;
    create trigger remove_flow after update on profiles for each row execute function remove_selected_flow();`);
  await expect(
    db.query(
      "select apply_model_defaults($1, 'raced', 'third', 'third', array['chat'], $2::uuid[], null)",
      [user, [untouched]]
    )
  ).rejects.toThrow(/Automation is unavailable/);
  expect(
    (
      await db.query<{ default_model: string }>(
        "select default_model from profiles where id=$1",
        [user]
      )
    ).rows[0].default_model
  ).toBe("third");
  expect(
    (await db.query("select id from flows where id=$1", [untouched])).rows
  ).toHaveLength(1);
  await db.exec("drop trigger remove_flow on profiles;");
  const privileges = await db.query<{ allowed: boolean }>(
    "select has_function_privilege('authenticated', 'apply_model_defaults(uuid,text,text,text,text[],uuid[],text)', 'execute') as allowed"
  );
  expect(privileges.rows[0].allowed).toBe(false);
});
