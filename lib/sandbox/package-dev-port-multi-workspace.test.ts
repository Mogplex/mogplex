import { expect, it } from "vitest";
import { resolvePackageDevPort } from "./package-dev-port";

it.each([
  ["npm run serve --workspaces", null],
  ["npm --workspaces run serve", null],
  ["npm run serve --workspaces=true", null],
  ["npm run serve -ws", null],
  ["pnpm --recursive run serve", null],
  ["pnpm -r run serve", null],
  ["pnpm run --recursive serve", null],
  ["PORT=3015 pnpm -r exec next dev", null],
  ["yarn workspaces run serve", null],
  ["npm run serve --workspaces=false", 4123],
  ["pnpm --recursive=false run serve", 4123],
  ["npm run serve -- --workspaces", 4123],
  ["pnpm run serve --recursive", 4123],
  ["yarn run workspaces", 4666],
])("distinguishes multi-workspace execution: %s", async (command, port) => {
  const files: Record<string, string> = {
    "package.json": JSON.stringify({
      workspaces: ["apps/*"],
      scripts: {
        dev: command,
        serve: "next dev --port 4123",
        workspaces: "next dev --port 4666",
      },
    }),
    "apps/web/package.json": JSON.stringify({
      name: "@acme/web",
      scripts: { serve: "next dev --port 3015" },
    }),
  };
  expect(
    await resolvePackageDevPort(
      {
        readText: async (path) => files[path] ?? null,
        listDirectories: async () => ["web"],
      },
      {}
    )
  ).toBe(port);
});
