import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createModelTargetsGetHandler } from "@/app/api/settings/model-targets/route";
import { createSettingsPatchHandler } from "@/app/api/settings/route";
import { applyNeonMigrations } from "@/lib/db/neon-migrations";
import { SHIM_TYPE_PARSERS } from "@/lib/db/pool";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import { loadModelSettingsTargets } from "@/lib/models/settings-defaults";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createModelFallbackHandlers } from "@/app/api/settings/model-fallbacks/route";
import { loadUsableFallbackModelIds } from "@/lib/models/fallback-preferences";
import { resolveAutomationModel } from "@/lib/workflows/automation-job-model-resolution";
import { createModelChainHandlers } from "@/app/api/settings/model-chain/route";

const owner = "00000000-0000-4000-8000-000000000011";
const other = "00000000-0000-4000-8000-000000000012";
const chosen = "00000000-0000-4000-8000-000000000013";
const untouched = "00000000-0000-4000-8000-000000000014";
const foreign = "00000000-0000-4000-8000-000000000015";
const graph = {
  nodes: [
    {
      id: "agent",
      type: "agent",
      data: { modelOverride: "openai/old", fallbackModelOverride: "fallback" },
    },
  ],
  edges: [],
};
let db: PGlite;
const previous = new Map<string, PropertyDescriptor | undefined>();

beforeAll(async () => {
  db = await PGlite.create({
    extensions: { vector, pg_trgm, pgcrypto, uuid_ossp },
    parsers: SHIM_TYPE_PARSERS,
  });
  // Use the actual baseline and every migration: hand-written table stubs
  // hid the nonexistent flows.team_id projection in the original tests.
  expect(
    (await applyNeonMigrations(db, { log: () => {}, warn: () => {} })).ok
  ).toBe(true);
  await db.query(
    "insert into profiles(id,default_model) values ($1,'openai/old'),($2,'openai/old')",
    [owner, other]
  );
  await db.exec(
    "insert into ai_models(id,provider,name) values ('openai/old','openai','Old'),('openai/new','openai','New')"
  );
  await db.query(
    "insert into provider_keys(user_id,provider,vault_secret_id) values ($1,'openai',gen_random_uuid())",
    [owner]
  );
  await db.query(
    "insert into flows(id,user_id,installation_id,name,draft_graph) values ($1,$4,123,'Selected',$6),($2,$4,123,'Untouched',$6),($3,$5,456,'Foreign',$6)",
    [chosen, untouched, foreign, owner, other, graph]
  );
  const client = createPostgrestShim({
    query: async (sql, values) => ({
      rows: (await db.query<Record<string, unknown>>(sql, values ?? [])).rows,
    }),
  });
  // Only replace the database connection; handlers, queries, and RPCs run for real.
  for (const key of ["from", "rpc"] as const) {
    previous.set(key, Object.getOwnPropertyDescriptor(supabaseAdmin, key));
    Object.defineProperty(supabaseAdmin, key, {
      configurable: true,
      value: client[key].bind(client),
    });
  }
}, 60_000);

afterAll(async () => {
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(supabaseAdmin, key, descriptor);
    else Reflect.deleteProperty(supabaseAdmin, key);
  }
  await db?.close();
});

test("automations survive invalid account fallbacks and preserve default, disabled and explicit policies", async () => {
  const previousKey = process.env.AI_GATEWAY_API_KEY;
  const previousPool = process.env.AUTOMATION_GATEWAY_FALLBACK_MODELS;
  process.env.AI_GATEWAY_API_KEY = "test-gateway-key";
  process.env.AUTOMATION_GATEWAY_FALLBACK_MODELS = "openai/new";
  try {
    await db.query(
      "update profiles set allow_platform_ai=true, allow_platform_sandbox=true where id=$1",
      [owner]
    );
    // Valid SQL value, invalid application value: older/bad saved data must
    // not prevent an otherwise authorized primary invocation.
    await db.query(
      "update profiles set fallback_model_ids=array['bad'] where id=$1",
      [owner]
    );
    expect(
      (await resolveAutomationModel(owner, "openai/old")).providerOptions
        ?.gateway.models
    ).toEqual(["openai/new"]);
    expect(
      (
        await resolveAutomationModel(
          owner,
          "openai/old",
          null,
          undefined,
          null,
          "openai/explicit"
        )
      ).providerOptions?.gateway.models
    ).toEqual(["openai/explicit", "openai/new"]);
    await db.query(
      "update profiles set fallback_model_ids=array[]::text[] where id=$1",
      [owner]
    );
    expect(
      (await resolveAutomationModel(owner, "openai/old")).providerOptions
        ?.gateway.models
    ).toBeUndefined();
  } finally {
    for (const [key, value] of Object.entries({
      AI_GATEWAY_API_KEY: previousKey,
      AUTOMATION_GATEWAY_FALLBACK_MODELS: previousPool,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await db.query(
      "update profiles set fallback_model_ids=null, allow_platform_ai=false, allow_platform_sandbox=false where id=$1",
      [owner]
    );
  }
});

test("fallback settings persist order, isolate owners, reject unusable choices and honor disabling", async () => {
  const { GET, PATCH } = createModelFallbackHandlers({
    requireUserId: async () => owner,
  });
  const patch = (ids: unknown) =>
    PATCH(
      new Request("http://localhost/api/settings/model-fallbacks", {
        method: "PATCH",
        body: JSON.stringify({ fallback_model_ids: ids }),
      })
    );
  expect(await (await GET()).json()).toEqual({ fallback_model_ids: null });
  const ids = ["openai/new", "openai/old"];
  expect((await patch(ids)).status).toBe(200);
  expect(await (await GET()).json()).toEqual({ fallback_model_ids: ids });
  const otherGet = createModelFallbackHandlers({
    requireUserId: async () => other,
  }).GET;
  expect(await (await otherGet()).json()).toEqual({ fallback_model_ids: null });
  for (const invalid of [
    ["openai/missing"],
    ["openai/new", "openai/new"],
    ["openrouter/model"],
    [" openai/new"],
    ["a/1", "a/2", "a/3", "a/4"],
    null,
  ]) {
    expect((await patch(invalid)).status).toBe(400);
    expect(await (await GET()).json()).toEqual({ fallback_model_ids: ids });
  }
  await db.query(
    "insert into user_model_preferences(user_id,model_id,is_enabled) values ($1,'openai/old',false)",
    [owner]
  );
  expect(await loadUsableFallbackModelIds(owner)).toEqual(["openai/new"]);
  expect((await patch(ids)).status).toBe(400);
  expect((await patch([])).status).toBe(200);
  expect(await loadUsableFallbackModelIds(owner)).toEqual([]);
  await db.query("delete from user_model_preferences where user_id=$1", [
    owner,
  ]);
  await db.exec(
    "insert into ai_models(id,provider,name) values ('openai/third','openai','Third'),('openai/fourth','openai','Fourth')"
  );
  const ordered = [...ids, "openai/third", "openai/fourth"];
  expect((await patch(ordered)).status).toBe(200);
  expect(await loadUsableFallbackModelIds(owner)).toEqual(ordered);
  await expect(
    db.query("update profiles set fallback_model_ids=array[''] where id=$1", [
      owner,
    ])
  ).rejects.toThrow();
  await expect(
    db.query(
      "update profiles set fallback_model_ids=array[null]::text[] where id=$1",
      [owner]
    )
  ).rejects.toThrow();
});

test("destinations API lists only owned automations against the deployed schema", async () => {
  const handler = createModelTargetsGetHandler({
    requireUserId: async () => owner,
    loadModelSettingsTargets,
  });
  const response = await handler();
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.automations).toEqual([
    { id: chosen, name: "Selected" },
    { id: untouched, name: "Untouched" },
  ]);
  expect(body.surfaces).toHaveLength(5);
  expect(
    body.surfaces.every(
      (surface: { model: string }) => surface.model === "openai/old"
    )
  ).toBe(true);
});

test("settings API saves the selected automation and surfaces through real SQL", async () => {
  const handler = createSettingsPatchHandler({
    requireUserId: async () => owner,
  });
  const request = (model: string, ids: string[]) =>
    new Request("https://mogplex.test/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        default_model: model,
        apply_to_surfaces: ["slack", "cli"],
        automation_ids: ids,
      }),
    });
  const response = await handler(request("openai/new", [chosen]));
  expect(response.status, await response.text()).toBe(200);
  const profile = (
    await db.query<{
      default_model: string;
      surface_models: Record<string, string>;
    }>("select default_model,surface_models from profiles where id=$1", [owner])
  ).rows[0];
  expect(profile.default_model).toBe("openai/new");
  expect(profile.surface_models).toEqual({
    chat: "openai/old",
    control: "openai/old",
    agents: "openai/old",
    slack: "openai/new",
    cli: "openai/new",
  });
  const rows = (
    await db.query<{ id: string; draft_graph: typeof graph }>(
      "select id,draft_graph from flows order by id"
    )
  ).rows;
  expect(
    rows.find((row) => row.id === chosen)?.draft_graph.nodes[0].data
  ).toEqual({ modelOverride: "openai/new", fallbackModelOverride: "fallback" });
  expect(
    rows
      .filter((row) => row.id !== chosen)
      .every(
        (row) => row.draft_graph.nodes[0].data.modelOverride === "openai/old"
      )
  ).toBe(true);
  expect((await handler(request("openai/old", [foreign]))).status).toBe(400);
  expect((await handler(request("openai/missing", [chosen]))).status).toBe(400);
  expect(
    (
      await db.query<{ default_model: string }>(
        "select default_model from profiles where id=$1",
        [owner]
      )
    ).rows[0].default_model
  ).toBe("openai/new");
});

test("model chains commit together, preserve destinations and roll back on database failure", async () => {
  await db.query(
    "update profiles set default_model='openai/old',fallback_model_ids=null,surface_models='{}' where id=$1",
    [owner]
  );
  await db.query("update flows set draft_graph=$2 where id=$1", [
    chosen,
    graph,
  ]);
  const { GET, PATCH } = createModelChainHandlers({
    requireUserId: async () => owner,
  });
  const patch = (primary: string, fallbacks: string[]) =>
    PATCH(
      new Request("http://localhost/api/settings/model-chain", {
        method: "PATCH",
        body: JSON.stringify({ primary, fallbacks }),
      })
    );
  expect((await patch("openai/new", ["openai/old"])).status).toBe(200);
  expect(await (await GET()).json()).toEqual({
    primary: "openai/new",
    fallbacks: ["openai/old"],
  });
  const profile = (
    await db.query<{ surface_models: Record<string, string> }>(
      "select surface_models from profiles where id=$1",
      [owner]
    )
  ).rows[0];
  expect(Object.values(profile.surface_models)).toEqual(
    Array.from({ length: 5 }).fill("openai/old")
  );
  expect(
    (
      await db.query<{ draft_graph: typeof graph }>(
        "select draft_graph from flows where id=$1",
        [chosen]
      )
    ).rows[0].draft_graph
  ).toEqual(graph);
  expect(
    await (
      await createModelChainHandlers({ requireUserId: async () => other }).GET()
    ).json()
  ).toEqual({ primary: "openai/old", fallbacks: [] });
  for (const [primary, fallbacks] of [
    ["openai/old", ["openai/missing"]],
    ["openai/new", ["openai/new"]],
    ["openai/missing", []],
  ] as const) {
    expect((await patch(primary, [...fallbacks])).status).toBe(400);
    expect(await (await GET()).json()).toEqual({
      primary: "openai/new",
      fallbacks: ["openai/old"],
    });
  }
  await db.exec(
    "create function reject_chain_test() returns trigger language plpgsql as $$ begin raise exception 'test storage failure'; end $$; create trigger reject_chain_test before update of fallback_model_ids on profiles for each row execute function reject_chain_test()"
  );
  try {
    expect((await patch("openai/old", [])).status).toBe(500);
    expect(await (await GET()).json()).toEqual({
      primary: "openai/new",
      fallbacks: ["openai/old"],
    });
  } finally {
    await db.exec(
      "drop trigger reject_chain_test on profiles; drop function reject_chain_test()"
    );
  }
  await db.query(
    "insert into user_model_preferences(user_id,model_id,is_enabled) values ($1,'openai/new',false)",
    [owner]
  );
  expect((await patch("openai/new", [])).status).toBe(400);
  // GET preserves a disabled saved primary so the editor can warn about it.
  expect((await (await GET()).json()).primary).toBe("openai/new");
  await db.query("delete from user_model_preferences where user_id=$1", [
    owner,
  ]);
  await db.query(
    "update profiles set default_model='openai/old',fallback_model_ids=null,surface_models='{}' where id=$1",
    [owner]
  );
});
