import { PGlite } from "@electric-sql/pglite";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const REPO_ID = "11111111-1111-4111-8111-111111111111";
export const AGENT_ID = "22222222-2222-4222-8222-222222222222";

export async function createAutomationDb() {
  const pg = await PGlite.create();
  await pg.exec(`
    create table github_installations(id text primary key, user_id text, installation_id bigint);
    create table repos(id uuid primary key, user_id text, full_name text, default_branch text, github_installation_id bigint);
    create table agents(id uuid primary key default gen_random_uuid(), user_id text, name text, slug text,
      model text, system_prompt text, source_template text, created_at timestamptz default now());
    create table profiles(id text primary key, email text, default_model text, surface_models jsonb,
      auto_enable_new_models boolean default true, models_seen_at timestamptz,
      allow_platform_ai boolean default false, allow_platform_sandbox boolean default false);
    create table ai_models(id text primary key, provider text, name text, is_available boolean,
      is_hidden boolean default false, created_at timestamptz default now());
    create table user_model_preferences(user_id text, model_id text, is_enabled boolean);
    create table provider_keys(id uuid primary key, user_id text, provider text, key_name text, created_at timestamptz, updated_at timestamptz);
    create table flows(id uuid primary key default gen_random_uuid(), user_id text, installation_id bigint,
      name text, description text, notes text, source_kind text default 'github', status text default 'inactive',
      draft_graph jsonb, published_version_id uuid, trigger_schedule_id text, vault_webhook_secret_id text,
      created_at timestamptz default now(), updated_at timestamptz default now());
    create table flow_versions(id uuid primary key default gen_random_uuid(), flow_id uuid references flows(id),
      version_number integer, graph jsonb, created_at timestamptz default now());
    create table assignments(id uuid primary key, agent_id uuid references agents(id), repo_id uuid references repos(id));
    create table job_runs(id uuid primary key default gen_random_uuid(), assignment_id uuid references assignments(id),
      flow_id uuid references flows(id), flow_version_id uuid references flow_versions(id), trigger_id uuid,
      metadata jsonb, status text default 'pending', runtime_provider text, runtime_run_id text, workflow_run_id text);
    create table flow_node_runs(id uuid primary key default gen_random_uuid(), user_id text, job_run_id uuid,
      flow_id uuid, flow_version_id uuid, node_id text, node_type text, node_label text, status text,
      started_at timestamptz, completed_at timestamptz, duration_ms integer, output jsonb, error text);
    insert into github_installations values ('installation', 'owner', 123), ('foreign', 'other', 456);
    insert into repos values ('${REPO_ID}', 'owner', 'acme/widgets', 'main', 123);
    insert into agents(id,user_id,name,slug,model) values ('${AGENT_ID}', 'owner', 'Maintenance', 'maintenance', 'openai/test-model');
    insert into profiles(id,email,allow_platform_ai,allow_platform_sandbox) values ('owner','owner@example.test',true,true);
    insert into ai_models(id,provider,name,is_available) values ('openai/test-model','openai','Test model',true);
    insert into provider_keys(id,user_id,provider) values (gen_random_uuid(),'owner','openai');
  `);
  const previousFrom = Object.getOwnPropertyDescriptor(supabaseAdmin, "from");
  const statements: string[] = [];
  const db = createPostgrestShim({
    query: async (sql, values) => {
      statements.push(sql);
      const result = await pg.query(sql, values);
      return { rows: result.rows as Record<string, unknown>[] };
    },
  });
  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    value: db.from.bind(db),
  });
  return {
    pg,
    statements,
    async close() {
      if (previousFrom)
        Object.defineProperty(supabaseAdmin, "from", previousFrom);
      else Reflect.deleteProperty(supabaseAdmin, "from");
      await pg.close();
    },
  };
}
