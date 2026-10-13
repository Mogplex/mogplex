import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkDatabase,
  type DatabaseProbe,
  type DoctorQuery,
  listNeonMigrationVersions,
} from "./database-check";

type Fixture = {
  ledger?: string[] | "missing";
  files?: string[];
  role?: { rolsuper: boolean; rolcreaterole: boolean; owns_public: boolean };
  connectError?: Error;
};

function probe(fixture: Fixture, seenUrls: string[] = []): DatabaseProbe {
  const query: DoctorQuery = async (sql) => {
    if (sql.includes("schema_migrations")) {
      if (fixture.ledger === "missing")
        throw new Error("relation does not exist");
      return (fixture.ledger ?? []).map((version) => ({ version }));
    }
    return [
      fixture.role ?? {
        rolsuper: false,
        rolcreaterole: false,
        owns_public: false,
      },
    ];
  };
  return {
    withConnection: async (url, run) => {
      seenUrls.push(url);
      if (fixture.connectError) throw fixture.connectError;
      return run(query);
    },
    listMigrationVersions: async () => fixture.files ?? [],
  };
}

const env = { DATABASE_URL: "postgres://owner@db/app" };

describe("checkDatabase", () => {
  it("should fail without a database URL", async () => {
    expect((await checkDatabase({}, probe({}))).status).toBe("fail");
  });

  it("should prefer the runtime URL the app serves from", async () => {
    const urls: string[] = [];
    await checkDatabase(
      { ...env, MOGPLEX_RUNTIME_DATABASE_URL: "postgres://svc@db/app" },
      probe({}, urls)
    );
    expect(urls).toEqual(["postgres://svc@db/app"]);
  });

  it("should report a connection error code without the URL", async () => {
    const error = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
    const result = await checkDatabase(env, probe({ connectError: error }));
    expect(result).toMatchObject({
      status: "fail",
      summary: expect.stringMatching(/ECONNREFUSED/),
    });
    expect(result.summary).not.toContain("pw");
  });

  it("should fail when the migration ledger does not exist", async () => {
    expect(
      (await checkDatabase(env, probe({ ledger: "missing" }))).summary
    ).toMatch(/never ran/);
  });

  it("should count pending migrations and name the oldest", async () => {
    const result = await checkDatabase(
      env,
      probe({
        ledger: ["20260101000000"],
        files: ["20260101000000", "20260201000000", "20260301000000"],
      })
    );
    expect(result).toMatchObject({
      status: "fail",
      summary: "2 pending migration(s), oldest 20260201000000",
    });
  });

  it("should warn when a privileged role serves the app", async () => {
    const result = await checkDatabase(
      env,
      probe({
        role: { rolsuper: false, rolcreaterole: false, owns_public: true },
      })
    );
    expect(result.status).toBe("warn");
  });

  it("should pass for current migrations and a dedicated runtime role", async () => {
    const result = await checkDatabase(
      { ...env, MOGPLEX_RUNTIME_DATABASE_URL: "postgres://svc@db/app" },
      probe({ ledger: ["20260101000000"], files: ["20260101000000"] })
    );
    expect(result).toMatchObject({
      status: "pass",
      summary: "Connected; migrations current",
    });
  });
});

describe("listNeonMigrationVersions", () => {
  it("should return sorted versions and ignore other files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "doctor-migrations-"));
    await writeFile(path.join(dir, "20260201000000_second.sql"), "");
    await writeFile(path.join(dir, "20260101000000_first.sql"), "");
    await writeFile(path.join(dir, "README.md"), "");
    expect(await listNeonMigrationVersions(dir)).toEqual([
      "20260101000000",
      "20260201000000",
    ]);
  });
});
