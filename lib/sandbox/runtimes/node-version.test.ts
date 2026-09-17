import { expect, it } from "vitest";
import { selectNodeRuntime, detectNodeRuntimeFromFiles } from "./node-version";

it.each([
  [[], undefined, "node22"],
  [[">=24"], undefined, "node24"],
  [[">=22.22.0 <23"], undefined, "node22"],
  [["^22 || ^24"], "24", "node24"],
  [[">=20"], "v24.1.0", "node24"],
  [[], "lts/*", "node24"],
  [[">=24", ">=22"], undefined, "node24"],
] as const)(
  "selects a supported major for %j and %s",
  (engines, versionFile, runtime) => {
    expect(selectNodeRuntime({ engines: [...engines], versionFile })).toBe(
      runtime
    );
  }
);

it.each([">=26", "^20", "nonsense"])(
  "rejects an unsupported or invalid requirement %s",
  (range) => {
    expect(() => selectNodeRuntime({ engines: [range] })).toThrow(/Node.js/);
  }
);

it("keeps workspace version-file precedence and ancestor engine requirements", async () => {
  const files: Record<string, string> = {
    "apps/web/package.json": '{"engines":{"node":">=22"}}',
    "apps/web/.nvmrc": "24",
    ".nvmrc": "22",
    "package.json": '{"engines":{"node":">=24"}}',
  };
  expect(
    await detectNodeRuntimeFromFiles(
      {
        readText: async (path) => files[path] ?? null,
        listDirectories: async () => [],
      },
      "apps/web"
    )
  ).toBe("node24");
});
