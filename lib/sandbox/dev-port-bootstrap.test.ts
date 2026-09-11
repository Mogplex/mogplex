import type { Sandbox } from "@vercel/sandbox";
import { expect, it } from "vitest";
import { resolveBootstrapContext } from "./client-bootstrap-context";

it("routes a delegated workspace preview to its pinned port", async () => {
  const files: Record<string, string> = {
    "package.json": JSON.stringify({
      dependencies: { next: "16" },
      scripts: { dev: "pnpm --filter @acme/website dev" },
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
  const context = await resolveBootstrapContext(sandbox, {});
  expect(context.previewUrl).toBe("https://preview-3015.example.test");
  expect(context.devCommand).toBe("pnpm run dev");
});
