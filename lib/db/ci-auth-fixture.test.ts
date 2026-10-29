import { expect, it } from "vitest";
import { CiAuthFixtureError, ciConnectionParams } from "./ci-auth-fixture";

const source = "postgres://owner@ep-source.us-east-1.aws.neon.tech/app";

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
