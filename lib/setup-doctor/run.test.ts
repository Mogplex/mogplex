import { describe, expect, it } from "vitest";
import { formatDoctorTable, hasFailures, runSetupDoctor } from "./run";
import type { DoctorCheckResult } from "./types";

const deps = {
  database: {
    withConnection: async () => {
      throw new Error("unreachable");
    },
    listMigrationVersions: async () => [],
  },
  fetch: async () => new Response(null, { status: 200 }),
};

describe("runSetupDoctor", () => {
  it("should run the static checks and add live checks only when asked", async () => {
    const offline = await runSetupDoctor({}, deps);
    expect(offline.map((result) => result.id)).toEqual([
      "app",
      "secrets",
      "database",
      "auth",
      "github",
      "trigger",
      "sandboxes",
      "models",
      "access",
    ]);
    const live = await runSetupDoctor({}, deps, { live: true });
    expect(live.map((result) => result.id).slice(-2)).toEqual([
      "trigger-live",
      "sandboxes-live",
    ]);
  });
});

describe("hasFailures", () => {
  it("should be true only when a check failed", () => {
    const result = (
      status: DoctorCheckResult["status"]
    ): DoctorCheckResult => ({
      id: "x",
      status,
      summary: "",
      docsUrl: "",
    });
    expect(hasFailures([result("pass"), result("warn"), result("skip")])).toBe(
      false
    );
    expect(hasFailures([result("pass"), result("fail")])).toBe(true);
  });
});

describe("formatDoctorTable", () => {
  it("should print a row per check and docs links for problems only", () => {
    const table = formatDoctorTable([
      {
        id: "app",
        status: "pass",
        summary: "App URL ok",
        docsUrl: "https://docs/app",
      },
      {
        id: "database",
        status: "fail",
        summary: "No database URL",
        docsUrl: "https://docs/db",
      },
    ]);
    expect(table).toContain("PASS    app       App URL ok");
    expect(table).toContain("FAIL    database  No database URL");
    expect(table).toContain("database: https://docs/db");
    expect(table).not.toContain("https://docs/app");
  });
});
