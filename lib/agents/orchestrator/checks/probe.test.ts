import { expect, it } from "vitest";
import { buildCheckProbeCommand, repositoryCheckProbeSchema } from "./probe";

it.each(["../outside.ts", "safe/../../outside.ts"])(
  "rejects unsafe source input %s before launching a probe",
  (path) => {
    expect(() => buildCheckProbeCommand([path])).toThrow(
      "Invalid workspace path"
    );
  }
);

const manifest = {
  available: true,
  scripts: { typecheck: "defined" },
  lockfiles: [],
};
it("accepts a content fingerprint and discovered script availability", () => {
  expect(
    repositoryCheckProbeSchema.safeParse({ revision: "a".repeat(64), manifest })
      .success
  ).toBe(true);
});
it.each(["", "a".repeat(63), "g".repeat(64)])(
  "rejects invalid source fingerprints %j",
  (revision) => {
    expect(
      repositoryCheckProbeSchema.safeParse({ revision, manifest }).success
    ).toBe(false);
  }
);
