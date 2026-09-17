import { describe, expect, it } from "vitest";
import { parseFallbackModelIds } from "./fallback-preferences";
import { gatewayProviderOptions } from "./gateway-provider-routing";

describe("account fallback choices", () => {
  it("rejects more than four account fallback models", () => {
    expect(
      parseFallbackModelIds([
        "lab/one",
        "lab/two",
        "lab/three",
        "lab/four",
        "lab/five",
      ])
    ).toBeNull();
  });
  it("keeps every choice in order and accepts explicitly turning fallbacks off", () => {
    const ids = ["lab/first", "lab/second", "lab/third", "lab/fourth"];
    expect(parseFallbackModelIds(ids)).toEqual(ids);
    expect(parseFallbackModelIds([])).toEqual([]);
    expect(
      gatewayProviderOptions("lab/primary", { userId: "owner" }, ids).gateway
        .models
    ).toEqual(ids);
  });

  it.each([
    null,
    {},
    "lab/model",
    [null],
    [""],
    ["model"],
    [" lab/model"],
    ["lab/model "],
    ["openrouter/lab/model"],
    ["lab/model", "lab/model"],
    [`lab/${"x".repeat(256)}`],
  ])("rejects invalid saved choices: %j", (value) => {
    expect(parseFallbackModelIds(value)).toBeNull();
  });

  it("omits the primary, empty choices and duplicates without changing order", () => {
    expect(
      gatewayProviderOptions(" LAB/PRIMARY ", { userId: "owner" }, [
        "lab/primary",
        " lab/second ",
        "",
        "LAB/SECOND",
        "lab/third",
      ]).gateway.models
    ).toEqual(["lab/second", "lab/third"]);
  });
});
