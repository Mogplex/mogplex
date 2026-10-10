import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { buildStaticTools } from "@/lib/agents/tools";
import { createStartSandbox } from "@/lib/agents/tools/sandbox-start";
import { resolveOrCreateSandbox } from "@/lib/agents/tools/sandbox-resolution";
import { applyNeonMigrations } from "@/lib/db/neon-migrations";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import { supabaseAdmin } from "@/lib/supabase/admin";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(1),
  stranger = id(2),
  repo = id(3),
  otherRepo = id(4);
const first = id(5),
  second = id(6),
  third = id(7),
  foreign = id(8),
  wrongRepo = id(9);
let db: PGlite;
const previousFrom = Object.getOwnPropertyDescriptor(supabaseAdmin, "from");
const requests: string[] = [];

beforeAll(async () => {
  db = await PGlite.create({
    extensions: { vector, pg_trgm, pgcrypto, uuid_ossp },
  });
  expect(
    (await applyNeonMigrations(db, { log: () => {}, warn: () => {} })).ok
  ).toBe(true);
  await db.query("insert into profiles(id) values ($1),($2)", [
    owner,
    stranger,
  ]);
  await db.query(
    "insert into workspaces(id,user_id,owner_user_id,name) values ($1,$2,$2,'Widgets')",
    [repo, owner]
  );
  await db.query(
    "insert into repos(id,user_id,owner_user_id,workspace_id,github_id,full_name,owner,name) values ($1,$2,$2,$1,1,'alex/widget','alex','widget'),($3,$2,$2,$1,2,'alex/other','alex','other')",
    [repo, owner, otherRepo]
  );
  for (const [sandbox, user, repository, branch] of [
    [first, owner, repo, "fix/one"],
    [second, owner, repo, "fix/two"],
    [third, owner, repo, "fix/three"],
    [foreign, stranger, repo, "private"],
    [wrongRepo, owner, otherRepo, "other"],
  ]) {
    await db.query(
      "insert into sandboxes(id,user_id,repo_id,sandbox_id,status,working_branch) values($1::uuid,$2,$3,$1::text,'running',$4)",
      [sandbox, user, repository, branch]
    );
  }
  const shim = createPostgrestShim({
    query: async (text, values) => ({
      rows: (await db.query(text, values)).rows as Record<string, unknown>[],
    }),
  });
  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    value: shim.from.bind(shim),
  });
  vi.stubEnv("INTERNAL_API_SECRET", "test-secret");
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    requests.push(String(input));
    return Response.json({
      exitCode: 0,
      stdout: "selected workspace",
      stderr: "",
    });
  });
}, 120_000);

afterAll(async () => {
  if (previousFrom) Object.defineProperty(supabaseAdmin, "from", previousFrom);
  else Reflect.deleteProperty(supabaseAdmin, "from");
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await db.close();
});

it("offers every eligible sandbox with branch context and executes on the explicit selection", async () => {
  const tools = buildStaticTools(undefined, owner, null, undefined, repo);
  const options = { toolCallId: "test", messages: [], context: undefined };
  const choices = (await tools.bash.execute!({ command: "pwd" }, options)) as {
    reason: string;
    sandboxes: Array<{ id: string; working_branch: string }>;
  };
  expect(choices.reason).toBe("multiple_sandboxes");
  expect(choices.sandboxes.map((s) => s.id).sort()).toEqual([
    first,
    second,
    third,
  ]);
  expect(choices.sandboxes.find((s) => s.id === second)?.working_branch).toBe(
    "fix/two"
  );
  const start = tools.start_sandbox!;
  const schema = start.inputSchema as {
    parse: (value: unknown) => { sandboxId?: string };
  };
  expect(
    await start.execute!(schema.parse({ sandboxId: second }), options)
  ).toMatchObject({ ok: true, sandboxId: second });
  expect(await tools.bash.execute!({ command: "pwd" }, options)).toMatchObject({
    sandboxId: second,
    stdout: "selected workspace",
  });
  expect(requests.at(-1)).toContain(`/sandbox/${second}/exec`);
  expect(
    (
      await db.query(
        "select count(*)::int as count from sandboxes where status='running'"
      )
    ).rows
  ).toEqual([{ count: 5 }]);
});

it("rejects choices owned by another user or belonging to another repository", async () => {
  for (const sandboxId of [foreign, wrongRepo]) {
    expect(await resolveOrCreateSandbox(owner, repo, sandboxId)).toMatchObject({
      reason: "sandbox_unavailable",
    });
  }
});

it("reuses the selected runtime when start_sandbox is called again", async () => {
  const tools = buildStaticTools(first, owner, null, undefined, repo);
  expect(
    await tools.start_sandbox!.execute!(
      {},
      { toolCallId: "again", messages: [], context: undefined }
    )
  ).toMatchObject({ ok: true, sandboxId: first });
});

it("retains the previous sandbox after an invalid selection", async () => {
  const tools = buildStaticTools(first, owner, null, undefined, repo);
  const options = { toolCallId: "invalid", messages: [], context: undefined };
  expect(
    await tools.start_sandbox!.execute!({ sandboxId: foreign }, options)
  ).toMatchObject({ reason: "sandbox_unavailable" });
  expect(await tools.bash.execute!({ command: "pwd" }, options)).toMatchObject({
    sandboxId: first,
  });
});

it("does not provision compute when the inventory query fails", async () => {
  const requestCount = requests.length;
  await db.exec(
    "begin; alter table sandboxes rename to unavailable_sandboxes;"
  );
  try {
    expect(await resolveOrCreateSandbox(owner, repo)).toMatchObject({
      reason: "sandbox_unavailable",
      error: "Could not load running sandboxes. Try again.",
    });
    expect(requests).toHaveLength(requestCount);
  } finally {
    await db.exec("rollback;");
  }
});

it("keeps the server-selected repository when the model supplies an unrelated repo", async () => {
  const start = createStartSandbox(owner, repo);
  const schema = start.inputSchema as {
    parse: (value: unknown) => { sandboxId?: string };
  };
  expect(
    await start.execute!(
      schema.parse({ repoId: otherRepo, sandboxId: wrongRepo }),
      { toolCallId: "scope", messages: [], context: undefined }
    )
  ).toMatchObject({ reason: "sandbox_unavailable" });
});
