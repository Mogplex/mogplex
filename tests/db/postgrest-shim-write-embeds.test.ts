import { afterAll, beforeAll, expect, it } from "vitest";
import {
  createPostgrestTestDb,
  USER_A,
  USER_B,
} from "./helpers/postgrest-shim-fixtures";

let setup: Awaited<ReturnType<typeof createPostgrestTestDb>>;
beforeAll(async () => {
  setup = await createPostgrestTestDb();
});
afterAll(async () => {
  await setup.pglite.close();
});

it("hides and restores owned repositories while returning related records", async () => {
  const { db, ids } = setup;
  for (const hidden of [true, false]) {
    const result = await db
      .from("repos")
      .update({ is_hidden: hidden })
      .eq("id", ids.repoAlpha)
      .eq("user_id", USER_A)
      .select("*, assignments(status, agent:agents(name))")
      .single();
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({
      id: ids.repoAlpha,
      is_hidden: hidden,
      assignments: expect.arrayContaining([
        { status: "active", agent: { name: "Scout" } },
      ]),
    });
    const stored = await db
      .from("repos")
      .select("is_hidden")
      .eq("id", ids.repoAlpha)
      .single();
    expect(stored.data).toEqual({ is_hidden: hidden });
  }
  const denied = await db
    .from("repos")
    .update({ is_hidden: true })
    .eq("id", ids.repoAlpha)
    .eq("user_id", USER_B)
    .select("id, assignments(status)")
    .maybeSingle();
  expect(denied.error).toBeNull();
  expect(denied.data).toBeNull();
  expect(
    (
      await db
        .from("repos")
        .select("is_hidden")
        .eq("id", ids.repoAlpha)
        .single()
    ).data
  ).toEqual({ is_hidden: false });
});

it("returns parent embeds for inserts, updates, upserts, and deletes", async () => {
  const { db, ids } = setup;
  const selection = "id, status, agent:agents(id, name)";
  const inserted = await db
    .from("assignments")
    .insert({ repo_id: ids.repoBeta, agent_id: ids.agentScout })
    .select(selection)
    .single();
  expect(inserted.error).toBeNull();
  expect(inserted.data).toMatchObject({
    status: "idle",
    agent: { id: ids.agentScout, name: "Scout" },
  });
  const id = (inserted.data as { id: string }).id;
  const updated = await db
    .from("assignments")
    .update({ status: "active", agent_id: null })
    .eq("id", id)
    .select(selection)
    .single();
  expect(updated.error).toBeNull();
  expect(updated.data).toEqual({ id, status: "active", agent: null });
  const upserted = await db
    .from("assignments")
    .upsert({
      id,
      repo_id: ids.repoBeta,
      agent_id: ids.agentScout,
      status: "done",
    })
    .select(selection)
    .single();
  expect(upserted.error).toBeNull();
  expect(upserted.data).toEqual({
    id,
    status: "done",
    agent: { id: ids.agentScout, name: "Scout" },
  });
  const deleted = await db
    .from("assignments")
    .delete()
    .eq("id", id)
    .select(selection)
    .single();
  expect(deleted.error).toBeNull();
  expect(deleted.data).toEqual(upserted.data);
  expect((await db.from("assignments").select("id").eq("id", id)).data).toEqual(
    []
  );
});

it("does not commit a write when its embedded selection is invalid", async () => {
  const { db, ids } = setup;
  const result = await db
    .from("repos")
    .update({ name: "should-not-stick" })
    .eq("id", ids.repoAlpha)
    .select("id, assignments(no_such_column)")
    .single();
  expect(result.error).not.toBeNull();
  expect(
    (await db.from("repos").select("name").eq("id", ids.repoAlpha).single())
      .data
  ).toEqual({ name: "alpha" });
});
