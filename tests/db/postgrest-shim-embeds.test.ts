import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PostgrestShim } from "@/lib/db/postgrest-shim";
import {
  createPostgrestTestDb,
  type TestIds,
  USER_A,
  USER_B,
} from "./helpers/postgrest-shim-fixtures";

let pglite: PGlite;
let db: PostgrestShim;
let ids: TestIds;

beforeAll(async () => {
  const setup = await createPostgrestTestDb();
  pglite = setup.pglite;
  db = setup.db;
  ids = setup.ids;
});

afterAll(async () => {
  await pglite.close();
});

describe("single / maybeSingle", () => {
  it("single() returns the row and errors with PGRST116 on zero rows", async () => {
    const found = await db
      .from("repos")
      .select("name")
      .eq("id", ids.repoAlpha)
      .single();
    expect(found.error).toBeNull();
    expect(found.data).toEqual({ name: "alpha" });

    const missing = await db
      .from("repos")
      .select("name")
      .eq("name", "does-not-exist")
      .single();
    expect(missing.data).toBeNull();
    expect(missing.error?.code).toBe("PGRST116");
  });

  it("maybeSingle() returns null on zero rows and PGRST116 on many", async () => {
    const none = await db
      .from("repos")
      .select("name")
      .eq("name", "does-not-exist")
      .maybeSingle();
    expect(none.error).toBeNull();
    expect(none.data).toBeNull();

    const many = await db
      .from("repos")
      .select("name")
      .eq("user_id", USER_A)
      .maybeSingle();
    expect(many.error?.code).toBe("PGRST116");
  });
});

describe("embedded resources", () => {
  it("embeds many-to-one as an object", async () => {
    const { data, error } = await db
      .from("assignments")
      .select("status, agents(id, name, slug, model)")
      .eq("repo_id", ids.repoAlpha)
      .order("status");
    expect(error).toBeNull();
    expect(data).toEqual([
      {
        status: "active",
        agents: {
          id: ids.agentScout,
          name: "Scout",
          slug: "scout",
          model: "claude",
        },
      },
      { status: "idle", agents: null },
    ]);
  });

  it("embeds with alias (team:teams)", async () => {
    const { data } = await db
      .from("team_members")
      .select("role, team:teams(id, slug, name, icon_path)")
      .eq("user_id", ids.profileAda)
      .single();
    expect(data).toEqual({
      role: "owner",
      team: {
        id: ids.teamCore,
        slug: "core",
        name: "Core",
        icon_path: "/icons/core.png",
      },
    });
  });

  it("embeds one-to-many as an array (empty stays [])", async () => {
    const withRows = await db
      .from("repos")
      .select("name, assignments(status)")
      .eq("id", ids.repoAlpha)
      .single();
    expect(
      (withRows.data as { assignments: { status: string }[] }).assignments
        .map((a) => a.status)
        .sort()
    ).toEqual(["active", "idle"]);

    const withoutRows = await db
      .from("repos")
      .select("name, assignments(status)")
      .eq("id", ids.repoBeta)
      .single();
    expect(withoutRows.data).toEqual({ name: "beta", assignments: [] });
  });

  it("resolves FK-name-hinted embeds across a constraint cycle", async () => {
    const { data, error } = await db
      .from("pipelines")
      .select(
        "name, published_version:pipeline_versions!pipelines_published_version_id_fkey(label)"
      )
      .eq("name", "deploy")
      .single();
    expect(error).toBeNull();
    expect(data).toEqual({
      name: "deploy",
      published_version: { label: "v2" },
    });

    const versions = await db
      .from("pipelines")
      .select(
        "name, versions:pipeline_versions!pipeline_versions_pipeline_id_fkey(label)"
      )
      .eq("name", "deploy")
      .single();
    expect(versions.error).toBeNull();
    expect(
      (versions.data as { versions: { label: string }[] }).versions
        .map((v) => v.label)
        .sort()
    ).toEqual(["v1-draft", "v2"]);
  });

  it("errors clearly on an unknown FK hint", async () => {
    const { error } = await db
      .from("pipelines")
      .select("name, pipeline_versions!does_not_exist_fkey(label)")
      .eq("name", "deploy")
      .single();
    expect(error?.message).toContain("no foreign key named");
  });

  it("embeds two levels deep", async () => {
    const { data, error } = await db
      .from("repos")
      .select("name, assignments(status, agents(name))")
      .eq("id", ids.repoAlpha)
      .single();
    expect(error).toBeNull();
    const assignments = (
      data as {
        assignments: { status: string; agents: { name: string } | null }[];
      }
    ).assignments;
    expect(assignments.find((a) => a.status === "active")?.agents).toEqual({
      name: "Scout",
    });
    expect(assignments.find((a) => a.status === "idle")?.agents).toBeNull();
  });

  it("!inner with an embed filter restricts parent rows", async () => {
    const { data, error } = await db
      .from("assignments")
      .select("id, repo_id, repos!inner(user_id)")
      .eq("repos.user_id", USER_A);
    expect(error).toBeNull();
    expect((data as unknown[]).length).toBe(2);

    const otherUser = await db
      .from("assignments")
      .select("id, repos!inner(user_id)")
      .eq("repos.user_id", USER_B);
    expect(otherUser.data).toEqual([]);
  });
});
