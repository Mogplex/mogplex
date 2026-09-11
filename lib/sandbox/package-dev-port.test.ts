import { describe, expect, it } from "vitest";
import { resolvePackageDevPort } from "./package-dev-port";
import type { RepositoryFiles } from "./repository-files";

function repository(
  rootDev: string,
  webDev = "next dev --port 3015",
  extra: Record<string, string> = {}
): RepositoryFiles {
  const files: Record<string, string> = {
    "package.json": JSON.stringify({
      workspaces: ["apps/*"],
      scripts: { dev: rootDev, serve: "next dev -p 4123" },
    }),
    "apps/web/package.json": JSON.stringify({
      name: "@acme/web",
      scripts: { dev: webDev },
    }),
    "apps/admin/package.json": JSON.stringify({
      name: "@acme/admin",
      scripts: { dev: "next dev --port 3020" },
    }),
    ...extra,
  };
  return {
    readText: async (path) => files[path] ?? null,
    listDirectories: async (path) => [
      ...new Set(
        Object.keys(files)
          .filter((file) => file.startsWith(`${path}/`))
          .map((file) => file.slice(path.length + 1).split("/")[0])
      ),
    ],
  };
}

describe("pinned package dev ports", () => {
  it.each([
    ["next dev --port 3015", 3015],
    ["next dev -p 4001", 4001],
    ["vite --port=4200", 4200],
    ["next dev --port '4310'", 4310],
    ["PORT=5050 next dev", 5050],
    ['cross-env PORT="5051" next dev', 5051],
    ["PORT=5050 next dev --port 3015", 3015],
    ["npm run serve", 4123],
    ["pnpm run serve -- --port 4201", 4201],
    ["npm run serve --port 0", null],
    ["next dev --port 65536", null],
    ["next dev", null],
    ["node ./start.js", null],
    ["next dev --port $PORT", null],
    ["echo --port 4000 && next dev", null],
    ["npm run missing", null],
    ["npm run dev", null],
  ])("resolves %s to %s", async (command, expected) => {
    expect(await resolvePackageDevPort(repository(command), {})).toBe(expected);
  });

  it.each([
    "pnpm --filter @acme/web dev",
    "pnpm --filter='@acme/web' run dev",
    "pnpm -F @acme/web dev",
    "npm run dev --workspace @acme/web",
    "npm -w apps/web run dev",
    "yarn workspace @acme/web dev",
    "bun --filter @acme/web dev",
    "pnpm --dir apps/web dev",
    "pnpm -C apps/web dev",
    "npm --prefix apps/web run dev",
    "yarn --cwd apps/web dev",
    "bun --cwd apps/web run dev",
  ])("follows %s to the selected workspace", async (command) => {
    expect(await resolvePackageDevPort(repository(command), {})).toBe(3015);
  });

  it("uses pnpm workspace declarations and follows nested script aliases", async () => {
    const files = repository("pnpm --filter @acme/web dev", "pnpm run serve", {
      "pnpm-workspace.yaml": "packages:\n  - apps/*\n  - '!apps/admin'\n",
      "apps/web/package.json": JSON.stringify({
        name: "@acme/web",
        scripts: { dev: "pnpm run serve", serve: "next dev --port 4567" },
      }),
    });
    expect(await resolvePackageDevPort(files, {})).toBe(4567);
  });

  it("reads the launch root and explicit command instead of an unrelated root script", async () => {
    const files = repository("next dev --port 3000");
    expect(
      await resolvePackageDevPort(files, { rootDirectory: "apps/web" })
    ).toBe(3015);
    expect(
      await resolvePackageDevPort(files, { devCommand: "next dev --port 4111" })
    ).toBe(4111);
    expect(
      await resolvePackageDevPort(files, { devCommand: "node other.js" })
    ).toBeNull();
  });

  it("keeps CLI flags above inherited PORT, but inherits PORT when no CLI pin exists", async () => {
    expect(
      await resolvePackageDevPort(
        repository("PORT=5000 pnpm --filter @acme/web dev"),
        {}
      )
    ).toBe(3015);
    expect(
      await resolvePackageDevPort(
        repository("PORT=5000 pnpm --filter @acme/web dev", "next dev"),
        {}
      )
    ).toBe(5000);
  });

  it.each([
    "pnpm --filter '*' dev",
    "pnpm --filter @acme/web --filter @acme/admin dev",
    "npm --prefix ../../outside run dev",
    "pnpm --filter missing dev",
  ])("does not guess a target for %s", async (command) => {
    expect(await resolvePackageDevPort(repository(command), {})).toBeNull();
  });

  it("ignores excluded workspaces and terminates script cycles", async () => {
    expect(
      await resolvePackageDevPort(
        repository("pnpm --filter @acme/admin dev", undefined, {
          "pnpm-workspace.yaml": "packages:\n  - apps/*\n  - '!apps/admin'\n",
        }),
        {}
      )
    ).toBeNull();
    expect(
      await resolvePackageDevPort(
        repository("npm run serve", undefined, {
          "package.json": JSON.stringify({
            scripts: { dev: "npm run serve", serve: "npm run dev" },
          }),
        }),
        {}
      )
    ).toBeNull();
  });
  it.each([
    "null",
    "[]",
    "invalid",
    '{"workspaces":{"packages":7},"scripts":{"dev":"pnpm --filter @acme/web dev"}}',
  ])("handles malformed package metadata: %s", async (raw) => {
    expect(
      await resolvePackageDevPort(
        repository("", undefined, { "package.json": raw }),
        {}
      )
    ).toBeNull();
  });
});

it.each(["/outside", "..", "../outside", "apps\\web", "apps\0web"])(
  "rejects an unsafe root even with a directly pinned command: %s",
  async (rootDirectory) => {
    expect(
      await resolvePackageDevPort(repository("next dev"), {
        rootDirectory,
        devCommand: "next dev --port 3015",
      })
    ).toBeNull();
  }
);

it.each([
  ["next dev --port 65535", 65535],
  ["next dev --port x3015", null],
  ["next dev --port 3015x", null],
  ["next dev --port '3015", null],
  ["env PORT=5010 NODE_ENV=development next dev", 5010],
  ["npm run-script serve", 4123],
  ["pnpm --dir apps/web --cwd apps/admin dev", null],
  ["pnpm --filter @acme/web --dir apps/admin dev", null],
])("handles command boundaries: %s", async (command, port) => {
  expect(await resolvePackageDevPort(repository(command as string), {})).toBe(
    port
  );
});

it("follows explicit workspace paths and package.json workspace objects", async () => {
  expect(
    await resolvePackageDevPort(
      repository("", undefined, {
        "package.json": JSON.stringify({
          workspaces: { packages: ["apps/web"] },
          scripts: { dev: "npm --workspace @acme/web run dev" },
        }),
      }),
      {}
    )
  ).toBe(3015);
});

it("does not guess a workspace from an unsupported recursive glob", async () => {
  expect(
    await resolvePackageDevPort(
      repository("", undefined, {
        "package.json": JSON.stringify({
          workspaces: ["apps/**"],
          scripts: { dev: "pnpm --filter @acme/web dev" },
        }),
      }),
      {}
    )
  ).toBeNull();
});
