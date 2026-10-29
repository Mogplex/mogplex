import { randomBytes } from "node:crypto";
import { betterAuth } from "better-auth";
import { createLocalJWKSet, jwtVerify } from "jose";
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  prepareCiAuthFixture,
  type CiAuthFixtureTarget,
} from "@/lib/db/ci-auth-fixture";
import {
  AUTH_USER_ID,
  authForDatabase,
  existingBrowserSession,
  migrateAuth,
  oldAuthDatabase,
} from "./helpers/better-auth-oauth-fixture";

let db: PGlite;
let cookie: string;

function target(): CiAuthFixtureTarget {
  return {
    githubActions: true,
    runId: "123",
    runAttempt: "1",
    branchId: "br-temporary",
    branch: { id: "br-temporary", name: "ci-run-123-1" },
    databaseUrl: "postgres://owner@ep-temporary.us-east-1.aws.neon.tech/app",
    sourceDatabaseUrl:
      "postgres://owner@ep-production.us-east-1.aws.neon.tech/app",
  };
}

const tokenRequest = () =>
  new Request("http://localhost:3000/api/auth/token", {
    headers: { cookie },
  });

beforeEach(async () => {
  db = await oldAuthDatabase();
  cookie = await existingBrowserSession(db);
  await migrateAuth(db);
  const foreignAuth = betterAuth({
    ...authForDatabase(db).instance.options,
    secret: randomBytes(32).toString("hex"),
  });
  const seeded = await foreignAuth.handler(
    new Request("http://localhost:3000/api/auth/jwks")
  );
  expect(seeded.status).toBe(200);
});

afterEach(async () => {
  await db.close();
});

it("replaces copied signing keys with fixture-secret keys while retaining credential rows", async () => {
  const before = await authForDatabase(db).request(tokenRequest());
  expect(before.status).toBe(500);
  const credentials = async () =>
    (
      await db.query(`select
        (select count(*)::int from "user") as users,
        (select count(*)::int from "session") as sessions,
        (select count(*)::int from "oauthApplication") as legacy_clients,
        (select count(*)::int from "oauthAccessToken") as legacy_tokens,
        (select count(*)::int from "oauthClient") as clients,
        (select count(*)::int from "oauthRefreshToken") as refresh_tokens`)
    ).rows;
  const original = await credentials();
  await prepareCiAuthFixture(db, target());
  expect((await db.query("select id from jwks")).rows).toHaveLength(0);
  expect(await credentials()).toEqual(original);

  const native = authForDatabase(db);
  const response = await native.request(tokenRequest());
  expect(response.status).toBe(200);
  const { token } = (await response.json()) as { token: string };
  const jwks = await native.request(
    new Request("http://localhost:3000/api/auth/jwks")
  );
  const { payload } = await jwtVerify(
    token,
    createLocalJWKSet(await jwks.json())
  );
  expect(payload.sub).toBe(AUTH_USER_ID);
  expect((await db.query("select id from jwks")).rows).toHaveLength(1);
  expect(await credentials()).toEqual(original);
});

it("rejects shared, production, protected, stale, and unverified targets before changing keys", async () => {
  const valid = target();
  const identity = /this run's temporary CI branch/;
  const source = /must never reset the source database's keys/;
  const unsafe: Array<[CiAuthFixtureTarget, RegExp]> = [
    [{ ...valid, githubActions: false }, identity],
    [{ ...valid, runId: "" }, identity],
    [{ ...valid, branchId: "br-other" }, identity],
    [{ ...valid, branch: { ...valid.branch, name: "ci-run-123-2" } }, identity],
    [{ ...valid, branch: { ...valid.branch, default: true } }, identity],
    [{ ...valid, branch: { ...valid.branch, protected: true } }, identity],
    [{ ...valid, sourceDatabaseUrl: valid.databaseUrl }, source],
    [
      {
        ...valid,
        sourceDatabaseUrl: valid.databaseUrl.replace(
          "ep-temporary.",
          "ep-temporary-pooler."
        ),
      },
      source,
    ],
    [
      { ...valid, databaseUrl: "postgres://owner@localhost/app" },
      /Neon endpoints/,
    ],
    [{ ...valid, sourceDatabaseUrl: "" }, /Neon database URL is invalid/],
    [
      { ...valid, sourceDatabaseUrl: "postgres://owner@db.example.com/app" },
      /Neon endpoints/,
    ],
  ];
  for (const [candidate, reason] of unsafe) {
    await expect(prepareCiAuthFixture(db, candidate)).rejects.toThrow(reason);
    expect((await db.query("select id from jwks")).rows).toHaveLength(1);
  }
});
