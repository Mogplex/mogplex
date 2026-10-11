import { expect, it } from "vitest";
import {
  selectNodeRuntime,
  detectNodeRuntimeFromFiles,
  selectNodeVersion,
} from "./node-version";
import { getStrategy } from "./index";
import { normalizeRuntime } from "@/lib/repo-settings";

it("keeps Node 26 settings and uses the Node tooling strategy", () => {
  expect(normalizeRuntime("node26")).toBe("node26");
  const strategy = getStrategy("node26");
  expect(strategy.id).toBe("node26");
  expect(strategy.buildInstallCommand("pnpm")).toContain("pnpm");
  expect(strategy.buildDevCommand("pnpm")).toContain("pnpm");
});

it.each([
  [[], undefined, "node22"],
  [[">=24"], undefined, "node24"],
  [[">=22.22.0 <23"], undefined, "node22"],
  [["^22 || ^24"], "24", "node24"],
  [[">=20"], "v24.1.0", "node24"],
  [[], "lts/*", "node24"],
  [[">=24", ">=22"], undefined, "node24"],
  [[">=26.5.0 <27"], "26.5.0", "node26"],
  [[], "v26.5.0", "node26"],
] as const)(
  "selects a supported major for %j and %s",
  (engines, versionFile, runtime) => {
    expect(selectNodeRuntime({ engines: [...engines], versionFile })).toBe(
      runtime
    );
  }
);

it.each([">=28", "^20", "nonsense"])(
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

it("installs an exact pin even when the provider ships an older minor", () => {
  expect(
    selectNodeVersion(["v26.1.0", "v26.5.0", "v26.6.0"], "node26", {
      engines: [">=26.5.0 <27"],
      versionFile: "v26.5.0",
    })
  ).toBe("26.5.0");
});

it("requires every workspace engine and keeps the selected runtime major", () => {
  expect(
    selectNodeVersion(["v26.6.0", "v26.5.1", "v24.9.0"], "node26", {
      engines: [">=26.5.0", "<26.6"],
    })
  ).toBe("26.5.1");
  expect(() =>
    selectNodeVersion(["v26.1.0", "v24.9.0"], "node26", {
      engines: [">=26.5.0 <27"],
    })
  ).toThrow(/No published Node.js/);
});
