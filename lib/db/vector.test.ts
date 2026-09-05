import { describe, expect, it } from "vitest";
import { serializeVectorValue } from "./vector";

describe("serializeVectorValue", () => {
  it.each(["vector", "vector(3)", "extensions.vector", '"extensions".vector'])(
    "encodes %s as a vector literal",
    (sqlType) => {
      expect(serializeVectorValue([1, -0.2, 0], sqlType)).toBe("[1,-0.2,0]");
    }
  );
  it.each([
    undefined,
    "vector[]",
    "text[]",
    "double precision[]",
    "jsonb",
    "notvector",
  ])("preserves array input for %s", (sqlType) => {
    const input = [1, 2, 3];
    expect(serializeVectorValue(input, sqlType)).toBe(input);
  });
  it.each([null, undefined, "[1,2,3]"])(
    "preserves scalar input %s",
    (value) => {
      expect(serializeVectorValue(value, "vector")).toBe(value);
    }
  );
});
