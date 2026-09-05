import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { UIMessage } from "ai";
import { createPostgrestShim } from "../../lib/db/postgrest-shim";
import { saveControlTranscript } from "../../lib/control/transcript-store";

/** Isolated real Postgres boundary, never uses hosted-service credentials. */
export async function controlTranscriptDatabase() {
  const db = new PGlite();
  const owner = "00000000-0000-4000-8000-000000000001";
  await db.exec(
    "create role anon; create role authenticated; create role service_role;"
  );
  for (const filename of [
    "20260810180000_control_sessions.sql",
    "20260905184000_control_save_messages.sql",
  ]) {
    await db.exec(
      await readFile(
        join(process.cwd(), "neon", "migrations", filename),
        "utf8"
      )
    );
  }
  const sessionId = (
    await db.query<{ id: string }>(
      "insert into control_sessions(user_id, title) values ($1, 'Transcript recovery') returning id",
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
  return {
    db,
    owner,
    client,
    sessionId,
    save: (messages: UIMessage[], expectedMessages?: UIMessage[]) =>
      saveControlTranscript(
        { userId: owner, sessionId, messages, expectedMessages },
        client
      ),
  };
}
