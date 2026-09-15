import { expect, test } from "vitest";
import {
  isModelSurface,
  MODEL_SURFACES,
  surfaceDefaultModel,
} from "./surface-defaults";

test("each surface keeps its own model while legacy profiles inherit the account default", () => {
  for (const surface of MODEL_SURFACES) {
    expect(isModelSurface(surface)).toBe(true);
    expect(
      surfaceDefaultModel(
        { default_model: "new", surface_models: { [surface]: "old" } },
        surface
      )
    ).toBe("old");
    expect(surfaceDefaultModel({ default_model: "legacy" }, surface)).toBe(
      "legacy"
    );
  }
  expect(isModelSurface("unknown")).toBe(false);
  expect(isModelSurface(null)).toBe(false);
  expect(surfaceDefaultModel(null, "cli")).toBeNull();
  for (const values of [null, [], { cli: 2 }, { cli: " " }]) {
    expect(
      surfaceDefaultModel(
        { default_model: "default", surface_models: values },
        "cli"
      )
    ).toBe("default");
  }
  expect(
    surfaceDefaultModel({
      default_model: "default",
      surface_models: { cli: "cli" },
    })
  ).toBe("default");
});
