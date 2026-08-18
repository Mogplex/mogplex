import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const MIGRATION =
  "supabase/migrations/20260818194500_redact_persisted_agent_secrets.sql";

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create table public.control_sessions (messages jsonb not null);
    create table public.conversations (messages jsonb, local_msgs jsonb);
    create table public.ai_calls (tool_calls jsonb, error text);
    create table public.ai_call_events (payload jsonb, message text);

    insert into public.control_sessions (messages)
    values ('[{"output":"ghs_testInstallationToken https://x-access-token:git-token@github.com"}]');
    insert into public.conversations (messages, local_msgs)
    values ('[{"output":"Bearer bearer-token sk-openAiSecretToken"}]', '[{"output":"github_pat_testToken"}]');
    insert into public.ai_calls (tool_calls, error)
    values ('[{"output":"gho_testOauthToken"}]', 'Bearer ai-call-error-token');
    insert into public.ai_call_events (payload, message)
    values ('{"output":"ghr_testRefreshToken sb_secret_supabaseToken"}', 'github_pat_eventMessageToken');
  `);
  await db.exec(await readFile(path.join(REPO_ROOT, MIGRATION), "utf8"));
});

afterAll(async () => {
  await db.close();
});

describe("persisted agent secret redaction migration", () => {
  it("redacts credentials from every retained transcript payload", async () => {
    const { rows } = await db.query<{
      control: string;
      messages: string;
      local: string;
      calls: string;
      callError: string;
      events: string;
      eventMessage: string;
    }>(`
      select
        (select messages::text from public.control_sessions) as control,
        (select messages::text from public.conversations) as messages,
        (select local_msgs::text from public.conversations) as local,
        (select tool_calls::text from public.ai_calls) as calls,
        (select error from public.ai_calls) as "callError",
        (select payload::text from public.ai_call_events) as events,
        (select message from public.ai_call_events) as "eventMessage"
    `);
    const persisted = Object.values(rows[0] ?? {}).join(" ");

    expect(persisted).not.toMatch(
      /testInstallationToken|git-token|bearer-token|openAiSecretToken|testToken|testOauthToken|testRefreshToken|supabaseToken|ai-call-error-token|eventMessageToken/
    );
    expect(persisted).toContain("[redacted]");
  });
});
