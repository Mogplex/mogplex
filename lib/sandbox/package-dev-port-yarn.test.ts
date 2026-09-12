import { expect, it } from "vitest";
import { resolvePackageDevPort } from "./package-dev-port";

it.each([
  [undefined, {}, 3015],
  ["yarn@1.22.22", {}, 3015],
  ["yarn@4.9.2", {}, null],
  ["yarn@2.4.3", {}, null],
  [undefined, { ".yarnrc.yml": "nodeLinker: node-modules" }, null],
  [undefined, { "yarn.lock": "__metadata:\n  version: 8\n" }, null],
  [undefined, { "yarn.lock": "# yarn lockfile v1\n" }, 3015],
] as const)(
  "uses Yarn's version-specific forwarding delimiter: %s %j",
  async (packageManager, metadata, port) => {
    const files: Record<string, string> = {
      ...metadata,
      "package.json": JSON.stringify({
        packageManager,
        scripts: { dev: "yarn run serve -- --port 3015", serve: "next dev" },
      }),
    };
    expect(
      await resolvePackageDevPort(
        {
          readText: async (path) => files[path] ?? null,
          listDirectories: async () => [],
        },
        {}
      )
    ).toBe(port);
  }
);

it.each([
  ["yarn@1.22.22", 3015],
  ["yarn@4.9.2", 4222],
])(
  "inherits the root Yarn version in a workspace: %s",
  async (version, port) => {
    const files: Record<string, string> = {
      "package.json": JSON.stringify({ packageManager: version }),
      "apps/web/package.json": JSON.stringify({
        scripts: {
          dev: "yarn run serve -- --port 3015",
          serve: "next dev --port 4222",
        },
      }),
    };
    expect(
      await resolvePackageDevPort(
        {
          readText: async (path) => files[path] ?? null,
          listDirectories: async () => [],
        },
        { rootDirectory: "apps/web" }
      )
    ).toBe(port);
  }
);
