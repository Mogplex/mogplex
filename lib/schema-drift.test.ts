import { expect, it } from "vitest";
import {
  DatabaseSchemaError,
  isSchemaDriftError,
  SCHEMA_DRIFT_MESSAGE,
} from "./schema-drift";

it("recognizes SQLSTATE and PostgREST schema failures plus wrapped safe messages", () => {
  for (const code of [
    "42P01",
    "42703",
    "42883",
    "PGRST200",
    "PGRST202",
    "PGRST204",
    "PGRST205",
    "SCHEMA_DRIFT",
  ]) {
    expect(isSchemaDriftError({ code })).toBe(true);
  }
  expect(
    isSchemaDriftError(new DatabaseSchemaError("private column", "42703"))
  ).toBe(true);
  expect(
    isSchemaDriftError(new Error(`Save failed: ${SCHEMA_DRIFT_MESSAGE}`))
  ).toBe(true);
  expect(isSchemaDriftError({ error: SCHEMA_DRIFT_MESSAGE })).toBe(true);
  expect(isSchemaDriftError(SCHEMA_DRIFT_MESSAGE)).toBe(true);
});

it("does not classify constraints, permissions, network failures, or arbitrary input as drift", () => {
  for (const error of [
    null,
    undefined,
    3,
    {},
    { code: "23505" },
    { code: "23503" },
    { code: "42501" },
    { code: "08006" },
    new Error("database unavailable"),
    "schema",
    { error: {} },
  ]) {
    expect(isSchemaDriftError(error)).toBe(false);
  }
});
