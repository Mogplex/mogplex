import assert from "node:assert/strict";
import test from "node:test";
import {
  getRuntimeDatabaseUrl,
  getRuntimeUnpooledDatabaseUrl,
} from "../../lib/db/connection-urls";

test("serving pools prefer the least-privilege runtime connection", () => {
  const env = {
    MOGPLEX_RUNTIME_DATABASE_URL: " postgres://runtime-pooled ",
    DATABASE_URL: "postgres://owner",
    mogplex_DATABASE_URL: "postgres://managed-owner",
  };

  assert.equal(getRuntimeDatabaseUrl(env), "postgres://runtime-pooled");
});

test("serving pools retain local and managed integration fallbacks", () => {
  assert.equal(
    getRuntimeDatabaseUrl({ DATABASE_URL: "postgres://local" }),
    "postgres://local"
  );
  assert.equal(
    getRuntimeDatabaseUrl({
      mogplex_DATABASE_URL: "postgres://managed",
    }),
    "postgres://managed"
  );
});

test("LISTEN clients prefer the direct runtime connection", () => {
  const env = {
    MOGPLEX_RUNTIME_DATABASE_URL_UNPOOLED: "postgres://runtime-direct",
    DATABASE_URL_UNPOOLED: "postgres://owner-direct",
    MOGPLEX_RUNTIME_DATABASE_URL: "postgres://runtime-pooled",
  };

  assert.equal(getRuntimeUnpooledDatabaseUrl(env), "postgres://runtime-direct");
});

test("LISTEN clients fall back through direct then pooled connections", () => {
  assert.equal(
    getRuntimeUnpooledDatabaseUrl({
      mogplex_DATABASE_URL_UNPOOLED: "postgres://managed-direct",
      DATABASE_URL: "postgres://local-pooled",
    }),
    "postgres://managed-direct"
  );
  assert.equal(
    getRuntimeUnpooledDatabaseUrl({
      MOGPLEX_RUNTIME_DATABASE_URL: "postgres://runtime-pooled",
    }),
    "postgres://runtime-pooled"
  );
});
