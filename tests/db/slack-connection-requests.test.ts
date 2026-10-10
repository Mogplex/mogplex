import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import {
  saveConnectionRecoveryRequest,
  loadConnectionRecoveryRequest,
  markConnectionRecoveryDispatched,
} from "@/lib/slack/connection-recovery/store";
import {
  findRecoveryRepository,
  restoreRecoveryRepository,
} from "@/lib/slack/connection-recovery/repository";
import { recoveryRequest } from "@/lib/slack/connection-recovery/test-fixtures";
import type { supabaseAdmin } from "@/lib/supabase/admin";

let db: PGlite;
let client: Pick<typeof supabaseAdmin, "from">;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table profiles(id uuid primary key);
    create table slack_installations(id uuid primary key);
    create table teams(id uuid primary key);
    create table repos(id uuid primary key, user_id uuid not null, owner_type text not null,
      owner_user_id uuid, product_team_id uuid, full_name text, root_directory text, github_installation_id bigint, is_hidden boolean);
  `);
  client = createPostgrestShim({
    query: async (text, values) => {
      const result = await db.query(text, values);
      return { rows: result.rows as Record<string, unknown>[] };
    },
  }) as unknown as Pick<typeof supabaseAdmin, "from">;
  await db.exec(
    await readFile(
      "neon/migrations/20261010193000_slack_connection_requests.sql",
      "utf8"
    )
  );
  await db.exec(`
    insert into profiles values ('00000000-0000-4000-8000-000000000001');
    insert into slack_installations values ('00000000-0000-4000-8000-000000000002');
    insert into slack_connection_requests(request_key, user_id, slack_installation_id, target, payload, resume_text)
    values ('request-1', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '{"provider":"github"}', '{"threadTs":"1.2"}', 'Fix acme/widgets');
  `);
});
afterAll(async () => db?.close());

describe("Slack connection request storage", () => {
  it("deduplicates retries, separates new tasks, and refuses other users' requests", async () => {
    const original = recoveryRequest();
    const {
      id: _id,
      request_key: _key,
      dispatched_at: _dispatched,
      ...input
    } = original;
    const saved = await saveConnectionRecoveryRequest(input, client);
    expect((await saveConnectionRecoveryRequest(input, client)).id).toBe(
      saved.id
    );
    expect(
      (
        await saveConnectionRecoveryRequest(
          { ...input, resume_text: "Another task" },
          client
        )
      ).id
    ).not.toBe(saved.id);
    expect(
      await loadConnectionRecoveryRequest(saved.id, original.user_id, client)
    ).toMatchObject({
      payload: original.payload,
      resume_text: original.resume_text,
    });
    const stranger = "00000000-0000-4000-8000-000000000099";
    expect(
      await loadConnectionRecoveryRequest(saved.id, stranger, client)
    ).toBeNull();
    await markConnectionRecoveryDispatched(saved.id, stranger, client);
    expect(
      (await loadConnectionRecoveryRequest(saved.id, original.user_id, client))
        ?.dispatched_at
    ).toBeNull();
    await markConnectionRecoveryDispatched(saved.id, original.user_id, client);
    const dispatched = (
      await loadConnectionRecoveryRequest(saved.id, original.user_id, client)
    )?.dispatched_at;
    expect(dispatched).toBeTruthy();
    await markConnectionRecoveryDispatched(saved.id, original.user_id, client);
    expect(
      (await loadConnectionRecoveryRequest(saved.id, original.user_id, client))
        ?.dispatched_at
    ).toEqual(dispatched);
  });
  it("restores only the requester's repository in the saved product scope", async () => {
    const request = recoveryRequest();
    const repoId = "00000000-0000-4000-8000-000000000010";
    await db.query(
      "insert into repos(id,user_id,owner_type,owner_user_id,full_name,is_hidden) values ($1,$2,'user',$2,'acme/widgets',true)",
      [repoId, request.user_id]
    );
    expect(await findRecoveryRepository(request, client)).toMatchObject({
      id: repoId,
      is_hidden: true,
    });
    await restoreRecoveryRepository(request, client);
    expect(await findRecoveryRepository(request, client)).toMatchObject({
      id: repoId,
      is_hidden: false,
    });
    const stranger = {
      ...request,
      user_id: "00000000-0000-4000-8000-000000000099",
    };
    expect(await findRecoveryRepository(stranger, client)).toBeNull();
    await expect(restoreRecoveryRepository(stranger, client)).rejects.toThrow(
      "no longer available"
    );
    expect(
      await findRecoveryRepository(
        { ...request, product_team_id: "00000000-0000-4000-8000-000000000019" },
        client
      )
    ).toBeNull();
    expect(
      await findRecoveryRepository(
        { ...request, repo_id: "00000000-0000-4000-8000-000000000099" },
        client
      )
    ).toBeNull();
    expect(
      await findRecoveryRepository(
        { ...request, target: { provider: "vercel" } },
        client
      )
    ).toBeNull();
  });
  it("preserves the pending request and atomically records continuation", async () => {
    const before = await db.query<{
      dispatched_at: string | null;
      resume_text: string;
    }>(
      "select dispatched_at, resume_text from slack_connection_requests where request_key='request-1'"
    );
    expect(before.rows[0]).toEqual({
      dispatched_at: null,
      resume_text: "Fix acme/widgets",
    });
    const first = await db.query(
      "update slack_connection_requests set dispatched_at=now() where request_key='request-1' and dispatched_at is null returning id"
    );
    const second = await db.query(
      "update slack_connection_requests set dispatched_at=now() where request_key='request-1' and dispatched_at is null returning id"
    );
    expect(first.rows).toHaveLength(1);
    expect(second.rows).toHaveLength(0);
  });
  it("rejects duplicate deliveries and unknown connector types", async () => {
    await expect(
      db.exec(
        "insert into slack_connection_requests select * from slack_connection_requests"
      )
    ).rejects.toThrow(/unique|duplicate/i);
    await expect(
      db.exec(
        'update slack_connection_requests set target=\'{"provider":"untrusted"}\''
      )
    ).rejects.toThrow(/check/i);
  });
  it("allows only the service role to access saved Slack requests", async () => {
    const { rows } = await db.query<{
      rls: boolean;
      anon_read: boolean;
      user_read: boolean;
      service_read: boolean;
    }>(`
      select relrowsecurity as rls,
      has_table_privilege('anon', oid, 'select') as anon_read,
      has_table_privilege('authenticated', oid, 'select') as user_read,
      has_table_privilege('service_role', oid, 'select') as service_read
      from pg_class where oid='slack_connection_requests'::regclass
    `);
    expect(rows[0]).toEqual({
      rls: true,
      anon_read: false,
      user_read: false,
      service_read: true,
    });
  });
});
