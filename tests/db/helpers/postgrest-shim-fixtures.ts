import { PGlite } from "@electric-sql/pglite";
import { SHIM_TYPE_PARSERS } from "@/lib/db/pool";
import {
  createPostgrestShim,
  type PostgrestShim,
  type Queryable,
} from "@/lib/db/postgrest-shim";

export const SCHEMA = /* sql */ `
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

  -- FK cycle mirroring flows/flow_versions: two constraints link the tables,
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

export const USER_A = "00000000-0000-4000-8000-00000000000a";
export const USER_B = "00000000-0000-4000-8000-00000000000b";

export type TestIds = {
  repoAlpha: string;
  repoBeta: string;
  repoHidden: string;
  agentScout: string;
  teamCore: string;
  profileAda: string;
};

export async function seed(queryable: Queryable): Promise<TestIds> {
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

  return {
    repoAlpha: String(alpha.id),
    repoBeta: String(beta.id),
    repoHidden: String(hidden.id),
    agentScout: String(scout.id),
    teamCore: String(team.id),
    profileAda: String(ada.id),
  };
}

export async function createPostgrestTestDb(): Promise<{
  pglite: PGlite;
  db: PostgrestShim;
  ids: TestIds;
}> {
  const pglite = new PGlite({
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
  const ids = await seed(queryable);
  const db = createPostgrestShim(queryable);
  return { pglite, db, ids };
}
