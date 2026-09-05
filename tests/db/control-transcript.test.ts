import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import type { UIMessage } from "ai";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import { saveControlTranscript } from "@/lib/control/transcript-store";

const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const msg = (id: string, text: string): UIMessage => ({
  id,
  role: "assistant",
  parts: [{ type: "text", text }],
});

it.each(["neon", "supabase"])(
  "%s persists concurrent turns without stale overwrites or cross-owner writes",
  async (root) => {
    const db = new PGlite();
    try {
      await db.exec(
        "create role anon; create role authenticated; create role service_role;"
      );
      await db.exec(
        await readFile(
          new URL(
            "../../neon/migrations/20260810180000_control_sessions.sql",
            import.meta.url
          ),
          "utf8"
        )
      );
      const migration = await readFile(
        new URL(
          `../../${root}/migrations/20260905184000_control_save_messages.sql`,
          import.meta.url
        ),
        "utf8"
      );
      await db.exec(migration);
      await db.exec(migration);
      const sessionId = (
        await db.query<{ id: string }>(
          "insert into control_sessions(user_id) values ($1) returning id",
          [owner]
        )
      ).rows[0]!.id;
      const client = createPostgrestShim({
        query: async (sql, values) => ({
          rows: (await db.query(sql, values ?? [])).rows as Record<
            string,
            unknown
          >[],
        }),
      }) as unknown as Parameters<typeof saveControlTranscript>[1];
      const save = (messages: UIMessage[], expectedMessages?: UIMessage[]) =>
        saveControlTranscript(
          { userId: owner, sessionId, messages, expectedMessages },
          client
        );
      const initial = msg("initial", "Worker started");
      await save([initial]);
      await Promise.all([
        save([msg("worker-result", "Worker finished")]),
        save([msg("user-follow-up", "Check tests")]),
      ]);
      const latest = await save([initial, msg("browser-reply", "Local reply")]);
      expect(latest.messages.map((m) => m.id).sort()).toEqual([
        "browser-reply",
        "initial",
        "user-follow-up",
        "worker-result",
      ]);
      const completed = msg("initial", "Worker finished and verified");
      await save([completed], [initial]);
      expect(
        (await save([initial])).messages.find((m) => m.id === initial.id)
      ).toEqual(completed);
      await expect(
        save(
          [
            msg("initial", "stale update"),
            msg("should-not-exist", "partial write"),
          ],
          [initial]
        )
      ).rejects.toThrow("saved conversation changed");
      const unchanged = await save([]);
      expect(unchanged.messages.some((m) => m.id === "should-not-exist")).toBe(
        false
      );
      expect((await save([])).updated_at).toBe(unchanged.updated_at);
      await expect(
        save(
          [msg("missing", "stale continuation")],
          [msg("missing", "deleted base")]
        )
      ).rejects.toThrow("saved conversation changed");
      for (const invalid of [
        null,
        {},
        [msg("duplicate", "one"), msg("duplicate", "two")],
        [{ id: "bad", role: "tool", parts: [] }],
      ]) {
        await expect(
          db.query("select control_save_messages($1, $2, $3::jsonb)", [
            owner,
            sessionId,
            JSON.stringify(invalid),
          ])
        ).rejects.toThrow("Invalid Control messages");
      }
      await expect(
        saveControlTranscript(
          { userId: other, sessionId, messages: [msg("foreign", "private")] },
          client
        )
      ).rejects.toThrow("no longer available");
      expect((await save([])).messages.some((m) => m.id === "foreign")).toBe(
        false
      );
      const redacted = await save([
        msg("secret", "Authorization: Bearer private-fixture-value"),
      ]);
      expect(JSON.stringify(redacted.messages)).not.toContain(
        "private-fixture-value"
      );
      await db.query(
        "update control_sessions set archived = true where id = $1",
        [sessionId]
      );
      await expect(save([msg("archived", "must not revive")])).rejects.toThrow(
        "no longer available"
      );
      expect(
        (
          await db.query(
            "select role, has_function_privilege(role, 'public.control_save_messages(uuid,uuid,jsonb,jsonb)', 'execute') as allowed from (values ('anon'),('authenticated'),('service_role')) roles(role)"
          )
        ).rows
      ).toEqual([
        { role: "anon", allowed: false },
        { role: "authenticated", allowed: false },
        { role: "service_role", allowed: true },
      ]);
    } finally {
      await db.close();
    }
  }
);
