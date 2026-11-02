import { describe, expect, it } from "vitest";
import {
  createEnvVarRow,
  envVarsFromRows,
  mergePastedEnv,
  rowsFromEnvVars,
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
});
