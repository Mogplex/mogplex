import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  createPostgrestShim,
  type Queryable,
  type PostgrestShim,
} from "../../lib/db/postgrest-shim";
import { applyAssignmentOwnerScope } from "../../lib/assignment-owner-scope";

let pglite: PGlite;
let db: PostgrestShim;
const userId = "00000000-0000-4000-8000-000000000001";
const teamId = "00000000-0000-4000-8000-000000000002";
beforeAll(async () => {
  pglite = new PGlite();
  await pglite.exec(`
    create table repos (id text primary key, user_id uuid, owner_type text, owner_user_id uuid, product_team_id uuid);
    create table assignments (id text primary key, repo_id text references repos(id));
    insert into repos values
      ('personal', '${userId}', 'user', '${userId}', null),
      ('team', '00000000-0000-4000-8000-000000000099', 'team', null, '${teamId}'),
      ('foreign', '${userId}', 'team', null, '00000000-0000-4000-8000-000000000003');
    insert into assignments values ('personal-assignment', 'personal'), ('team-assignment', 'team'), ('foreign-assignment', 'foreign');
  `);
  db = createPostgrestShim(pglite as unknown as Queryable);
});
afterAll(async () => pglite.close());
it("restricts actual joined SQL to personal ownership, including the null team boundary", async () => {
  const query = db.from("assignments").select("id, repos!inner(id)");
  const result = await applyAssignmentOwnerScope(query, {
    kind: "personal",
    userId,
    productTeamId: null,
  });
  expect(result.error).toBeNull();
  expect(result.data).toEqual([
    { id: "personal-assignment", repos: { id: "personal" } },
  ]);
});
it("returns another creator's team assignment without admitting other teams", async () => {
  const query = db.from("assignments").select("id, repos!inner(id)");
  const result = await applyAssignmentOwnerScope(query, {
    kind: "team",
    userId,
    productTeamId: teamId,
  });
  expect(result.error).toBeNull();
  expect(result.data).toEqual([
    { id: "team-assignment", repos: { id: "team" } },
  ]);
});
