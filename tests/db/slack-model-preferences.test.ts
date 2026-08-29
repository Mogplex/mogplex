import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const MIGRATION =
  "supabase/migrations/20260829150000_slack_model_preferences.sql";

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.slack_installations (id uuid primary key);
    create table public.ai_models (id text primary key);
  `);
  await db.exec(await readFile(path.join(REPO_ROOT, MIGRATION), "utf8"));
});

afterAll(async () => {
  await db.close();
});

describe("Slack model preference scope", () => {
  it("stores one model per installation, channel, and Slack user", async () => {
    await db.exec(`
      insert into public.slack_installations values
        ('00000000-0000-4000-8000-000000000001');
      insert into public.ai_models values ('openai/gpt-5.4'), ('anthropic/claude-4');
      insert into public.slack_model_preferences
        (slack_installation_id, channel_id, slack_user_id, model_id)
      values
        ('00000000-0000-4000-8000-000000000001', 'C1', 'U1', 'openai/gpt-5.4'),
        ('00000000-0000-4000-8000-000000000001', 'C1', 'U2', 'anthropic/claude-4');
    `);

    await expect(
      db.exec(`
        insert into public.slack_model_preferences
          (slack_installation_id, channel_id, slack_user_id, model_id)
        values
          ('00000000-0000-4000-8000-000000000001', 'C1', 'U1', 'anthropic/claude-4');
      `)
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it("keeps the table service-role only behind RLS", async () => {
    const { rows } = await db.query<{
      rls: boolean;
      anonSelect: boolean;
      serviceSelect: boolean;
    }>(`
      select
        c.relrowsecurity as rls,
        has_table_privilege('anon', 'public.slack_model_preferences', 'select') as "anonSelect",
        has_table_privilege('service_role', 'public.slack_model_preferences', 'select') as "serviceSelect"
      from pg_class c
      where c.oid = 'public.slack_model_preferences'::regclass;
    `);
    expect(rows[0]).toEqual({
      rls: true,
      anonSelect: false,
      serviceSelect: true,
    });
  });
});
