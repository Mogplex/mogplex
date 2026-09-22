import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import { listSavedHttpMcpServers } from "@/lib/mcp-servers/chat";
import { getSavedMcpServerForTest } from "@/lib/mcp-servers/diagnostics";

it("reads only the caller's enabled HTTP catalog entries and sees disabling and deletion on the next turn", async () => {
  const pg = await PGlite.create();
  try {
    const baseline = await readFile(
      new URL("../../neon/baseline.sql", import.meta.url),
      "utf8"
    );
    const ddl = baseline.match(
      /CREATE TABLE public\.user_mcp_servers \([\s\S]*?\n\);/
    )?.[0];
    expect(ddl).toBeDefined();
    await pg.exec(ddl!);
    const owner = "00000000-0000-4000-8000-000000000001";
    const other = "00000000-0000-4000-8000-000000000002";
    await pg.query(
      `insert into user_mcp_servers(user_id,name,transport,url,command,enabled) values
      ($1,'active','http','https://example.com/mcp',null,true),
      ($1,'disabled','http','https://example.com/mcp',null,false),
      ($1,'local','stdio',null,'npx',true),
      ($2,'other','http','https://example.com/mcp',null,true)`,
      [owner, other]
    );
    const db = createPostgrestShim({
      query: async (sql, values) => ({
        rows: (await pg.query(sql, values)).rows as Record<string, unknown>[],
      }),
    }) as unknown as Parameters<typeof listSavedHttpMcpServers>[1];
    expect(
      (await listSavedHttpMcpServers(owner, db)).map((row) => row.name)
    ).toEqual(["active"]);
    const { rows: diagnosticRows } = await pg.query<{ id: string }>(
      "select id from user_mcp_servers where user_id=$1 and name='disabled'",
      [owner]
    );
    const target = diagnosticRows[0].id;
    expect(
      (await getSavedMcpServerForTest(owner, target, db)).data
    ).toMatchObject({ name: "disabled", enabled: false });
    expect((await getSavedMcpServerForTest(other, target, db)).data).toBeNull();
    expect((await getSavedMcpServerForTest(owner, other, db)).data).toBeNull();
    await pg.query(
      "update user_mcp_servers set enabled=false where user_id=$1 and name='active'",
      [owner]
    );
    expect(await listSavedHttpMcpServers(owner, db)).toEqual([]);
    await pg.query(
      "update user_mcp_servers set enabled=true where user_id=$1 and name='active'",
      [owner]
    );
    await pg.query(
      "delete from user_mcp_servers where user_id=$1 and name='active'",
      [owner]
    );
    expect(await listSavedHttpMcpServers(owner, db)).toEqual([]);
    expect(
      (await listSavedHttpMcpServers(other, db)).map((row) => row.name)
    ).toEqual(["other"]);
  } finally {
    await pg.close();
  }
});
