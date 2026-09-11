import { describe, expect, it } from "vitest";
import {
  buildNeonBaselineSql,
  latestMigrationVersion,
  migrationVersion,
  parseBaselineThroughVersion,
} from "./neon-baseline";

const RAW_DUMP = [
  "--",
  "-- PostgreSQL database dump",
  "--",
  "",
  "\\restrict abc123",
  "",
  "SET statement_timeout = 0;",
  "SET transaction_timeout = 0;",
  "SET client_encoding = 'UTF8';",
  "",
  "CREATE TABLE public.profiles (id uuid NOT NULL);",
  "",
  "\\unrestrict abc123",
  "",
].join("\n");

describe("buildNeonBaselineSql", () => {
  it("strips psql meta-commands and the Postgres 17-only setting", () => {
    const sql = buildNeonBaselineSql(RAW_DUMP, "20260907170000");
    expect(sql).not.toMatch(/\\restrict|\\unrestrict/);
    expect(sql).not.toContain("SET transaction_timeout");
    expect(sql).toContain("SET statement_timeout = 0;");
    expect(sql).toContain("CREATE TABLE public.profiles (id uuid NOT NULL);");
  });

  it("records the covered version and creates the policy roles first", () => {
    const sql = buildNeonBaselineSql(RAW_DUMP, "20260907170000");
    expect(parseBaselineThroughVersion(sql)).toBe("20260907170000");
    expect(sql.indexOf("create role %I nologin")).toBeLessThan(
      sql.indexOf("CREATE TABLE public.profiles")
    );
    expect(sql).toContain("'service_role', 'supabase_auth_admin'");
  });

  it("rejects malformed versions and non-dump input", () => {
    expect(() => buildNeonBaselineSql(RAW_DUMP, "v1")).toThrow(
      "invalid baseline version"
    );
    expect(() =>
      buildNeonBaselineSql("create table x ();", "20260907170000")
    ).toThrow("plain-format pg_dump");
  });
});

describe("parseBaselineThroughVersion", () => {
  it("returns null when the marker is missing or malformed", () => {
    expect(parseBaselineThroughVersion("-- nothing here\nselect 1;")).toBe(
      null
    );
    expect(parseBaselineThroughVersion("-- baseline-through: nope")).toBe(null);
  });
});

describe("migration version helpers", () => {
  it("reads the version from a migration filename", () => {
    expect(migrationVersion("20260802000000_better_auth_foundation.sql")).toBe(
      "20260802000000"
    );
    expect(migrationVersion("README.md")).toBe(null);
    expect(migrationVersion("2026_notes.sql")).toBe(null);
  });

  it("picks the newest version and ignores other files", () => {
    expect(
      latestMigrationVersion([
        "20260907170000_late.sql",
        "README.md",
        "20260802000000_early.sql",
      ])
    ).toBe("20260907170000");
    expect(latestMigrationVersion(["README.md"])).toBe(null);
  });
});
