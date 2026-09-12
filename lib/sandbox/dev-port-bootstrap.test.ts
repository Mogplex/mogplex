import type { Sandbox } from "@vercel/sandbox";
import { expect, it } from "vitest";
import { resolveBootstrapContext } from "./client-bootstrap-context";

it.each([
  {
    label: "delegated workspace",
    rootDev: "pnpm --filter @acme/website dev",
    opts: {},
    port: 3015,
  },
  {
    label: "package executable",
    rootDev: "PORT=3015 pnpm exec next dev",
    opts: {},
    port: 3015,
  },
  {
    label: "aliased package executable",
    rootDev: "PORT=3015 pnpm run serve",
    opts: {},
    port: 3015,
  },
  {
    label: "manual override",
    rootDev: "PORT=3015 pnpm exec next dev",
    opts: { devPort: 4555 },
    port: 4555,
  },
  {
    label: "command override",
    rootDev: "next dev --port 3015",
    opts: { devCommand: "PORT=4666 pnpm exec next dev" },
    port: 4666,
  },
  { label: "framework default", rootDev: "next dev", opts: {}, port: 3000 },
])(
  "routes $label previews to the correct port",
  async ({ rootDev, opts, port }) => {
    const files: Record<string, string> = {
      "package.json": JSON.stringify({
        dependencies: { next: "16" },
        scripts: { dev: rootDev, serve: "pnpm exec next dev" },
      }),
      "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
      "pnpm-lock.yaml": "lockfileVersion: '9.0'",
      "apps/website/package.json": JSON.stringify({
        name: "@acme/website",
        dependencies: { next: "16" },
        scripts: { dev: "next dev --port 3015" },
      }),
    };
    const sandbox = {
      readFile: async ({ path }: { path: string }) => (files[path] ? {} : null),
      readFileToBuffer: async ({ path }: { path: string }) =>
        files[path] ? Buffer.from(files[path]) : null,
      writeFiles: async () => {},
      runCommand: async () => ({
        stdout: async () => '["website"]',
        stderr: async () => "",
        exitCode: 0,
      }),
      domain: (port: number) => `https://preview-${port}.example.test`,
    } as unknown as Sandbox;
    const context = await resolveBootstrapContext(sandbox, opts);
    expect(context.previewUrl).toBe(`https://preview-${port}.example.test`);
    expect(context.devCommand).toBe(opts.devCommand ?? "pnpm run dev");
  }
);
