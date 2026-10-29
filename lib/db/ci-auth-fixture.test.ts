import { expect, it } from "vitest";
import {
  assertCiAuthFixtureTarget,
  CiAuthFixtureError,
  ciConnectionParams,
  type CiAuthFixtureTarget,
} from "./ci-auth-fixture";

const source = "postgres://owner@ep-source.us-east-1.aws.neon.tech/app";

const target: CiAuthFixtureTarget = {
  githubActions: true,
  runId: "123",
  runAttempt: "1",
  branchId: "br-temporary",
  branch: { id: "br-temporary", name: "ci-run-123-1" },
  databaseUrl: "postgres://owner@ep-temporary.us-east-1.aws.neon.tech/app",
  sourceDatabaseUrl: source,
};

it("permits only the matching temporary CI fork", () => {
  expect(() => assertCiAuthFixtureTarget(target)).not.toThrow();
});

it.each([
  { ...target, githubActions: false },
  {
    ...target,
    runId: "invalid",
    branch: { ...target.branch, name: "ci-run-invalid-1" },
  },
  {
    ...target,
    runAttempt: "invalid",
    branch: { ...target.branch, name: "ci-run-123-invalid" },
  },
  { ...target, branchId: "", branch: { ...target.branch, id: "" } },
  { ...target, branch: { ...target.branch, id: "br-other" } },
  { ...target, branch: { ...target.branch, name: "ci-run-123-2" } },
  { ...target, branch: { ...target.branch, default: true } },
  { ...target, branch: { ...target.branch, protected: true } },
])("rejects mismatched or protected CI identity %#", (candidate) => {
  expect(() => assertCiAuthFixtureTarget(candidate)).toThrow(
    /this run's temporary CI branch/
  );
});

it.each([
  target.databaseUrl,
  target.databaseUrl.replace("ep-temporary.", "ep-temporary-pooler."),
])("rejects the source endpoint and its pooled alias %s", (url) => {
  expect(() =>
    assertCiAuthFixtureTarget({ ...target, sourceDatabaseUrl: url })
  ).toThrow(/must never reset the source database's keys/);
});

it.each([
  [source, "app", "owner"],
  [`${source}?sslmode=require&channel_binding=require`, "app", "owner"],
  [
    "postgresql://role%20name@ep-source.us-east-1.aws.neon.tech/db%20name",
    "db name",
    "role name",
  ],
])("derives an explicit child connection from %s", (url, database, role) => {
  expect(Object.fromEntries(ciConnectionParams(url, "br-temporary"))).toEqual({
    branch_id: "br-temporary",
    database_name: database,
    role_name: role,
    pooled: "false",
  });
});

it.each([
  ["", "br-temporary", /Neon database URL is invalid/],
  [source.replace("postgres:", "https:"), "br-temporary", /PostgreSQL URLs/],
  ["postgres://owner@db.example.com/app", "br-temporary", /Neon endpoints/],
  [source.replace("/app", "/"), "br-temporary", /database name is required/],
  [source.replace("/app", ""), "br-temporary", /database name is required/],
  [source.replace("owner@", ""), "br-temporary", /role name is required/],
  [source.replace("owner@", "%ZZ@"), "br-temporary", /valid URI components/],
  [source, "", /branch id is required/],
])("rejects malformed source configuration %s", (url, branchId, reason) => {
  expect(() => ciConnectionParams(url, branchId)).toThrow(CiAuthFixtureError);
  expect(() => ciConnectionParams(url, branchId)).toThrow(reason);
});
