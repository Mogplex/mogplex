import { describe, expect, it } from "vitest";
import {
  createEnvVarRow,
  envVarsFromRows,
  mergePastedEnv,
  rowsFromEnvVars,
  withRequestedNames,
} from "./env-var-rows";

const pairs = (rows: { key: string; value: string }[]) =>
  rows.map(({ key, value }) => [key, value]);

describe("env var rows", () => {
  it("should list stored variables sorted by key", () => {
    expect(pairs(rowsFromEnvVars({ ZED: "1", API_URL: "x" }))).toEqual([
      ["API_URL", "x"],
      ["ZED", "1"],
    ]);
  });

  it("should drop blank rows and keep values verbatim when saving", () => {
    const result = envVarsFromRows([
      createEnvVarRow(" TOKEN ", " spaced "),
      createEnvVarRow("", ""),
    ]);

    expect(result).toEqual({ ok: true, vars: { TOKEN: " spaced " } });
  });

  it("should reject a value without a name", () => {
    expect(envVarsFromRows([createEnvVarRow("", "orphan")])).toEqual({
      ok: false,
      error: "Every value needs a variable name.",
    });
  });

  it("should reject a duplicated name", () => {
    expect(
      envVarsFromRows([createEnvVarRow("A", "1"), createEnvVarRow("A ", "2")])
    ).toEqual({ ok: false, error: "A is defined twice." });
  });

  it("should save variables named after object built-ins", () => {
    expect(
      envVarsFromRows([
        createEnvVarRow("constructor", "a"),
        createEnvVarRow("toString", "b"),
      ])
    ).toEqual({ ok: true, vars: { constructor: "a", toString: "b" } });
  });

  it("should reject __proto__, which the stored object cannot hold", () => {
    expect(envVarsFromRows([createEnvVarRow("__proto__", "x")])).toEqual({
      ok: false,
      error: "__proto__ can't be used as a variable name.",
    });
  });

  it("should reject a pasted __proto__ line instead of dropping it", () => {
    expect(() => mergePastedEnv([], "A=1\n__proto__=x")).toThrow(
      "__proto__ can't be used as a variable name."
    );
  });

  it("should keep a built-in-named row's value when the paste does not set it", () => {
    const merged = mergePastedEnv(
      [createEnvVarRow("constructor", "keep")],
      "A=1"
    );

    expect(pairs(merged)).toEqual([
      ["constructor", "keep"],
      ["A", "1"],
    ]);
  });

  it("should overwrite existing keys and append new ones when pasting .env text", () => {
    const merged = mergePastedEnv(
      [createEnvVarRow("A", "old"), createEnvVarRow("B", "keep")],
      '# comment\nA="new"\nC=3\n'
    );

    expect(pairs(merged)).toEqual([
      ["A", "new"],
      ["B", "keep"],
      ["C", "3"],
    ]);
  });

  it("should throw on a pasted line without a separator", () => {
    expect(() => mergePastedEnv([], "NOT_A_PAIR")).toThrow(
      /Invalid env var line/
    );
  });

  it("should add an empty row for each requested name the table lacks", () => {
    const rows = withRequestedNames(rowsFromEnvVars({ NODE_ENV: "dev" }), [
      "API_KEY",
      "NODE_ENV",
      "API_KEY",
    ]);

    expect(pairs(rows)).toEqual([
      ["NODE_ENV", "dev"],
      ["API_KEY", ""],
    ]);
    expect(rows.at(-1)?.requested).toBe(true);
  });

  it("should treat a requested name with stray spaces as the stored one", () => {
    const rows = withRequestedNames(rowsFromEnvVars({ API_KEY: "x" }), [
      " API_KEY",
      "DATABASE_URL ",
      "DATABASE_URL",
    ]);

    expect(pairs(rows)).toEqual([
      ["API_KEY", "x"],
      ["DATABASE_URL", ""],
    ]);
  });

  it("should not save a requested name left empty", () => {
    const rows = withRequestedNames(rowsFromEnvVars({ NODE_ENV: "dev" }), [
      "API_KEY",
      "DATABASE_URL",
    ]);
    const filled = rows.map((row) =>
      row.key === "API_KEY" ? { ...row, value: "abc" } : row
    );

    expect(envVarsFromRows(filled)).toEqual({
      ok: true,
      vars: { NODE_ENV: "dev", API_KEY: "abc" },
    });
  });
});
