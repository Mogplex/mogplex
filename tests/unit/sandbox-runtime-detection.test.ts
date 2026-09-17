import assert from "node:assert/strict";
import test from "node:test";
import { detectRuntimeFromGithub } from "../../lib/sandbox/runtimes";

for (const fixture of [
  {
    name: "auto-selected monorepo workspace",
    files: {
      "package.json": '{"workspaces":["apps/web"]}',
      "apps/web/package.json":
        '{"scripts":{"dev":"next dev"},"engines":{"node":">=24"}}',
    },
    runtime: "node24",
  },
  {
    name: "engine requirement",
    files: { "package.json": '{"engines":{"node":">=24.0.0"}}' },
    runtime: "node24",
  },
  {
    name: "nvmrc",
    files: { "package.json": "{}", ".nvmrc": "v24.1.0\n" },
    runtime: "node24",
  },
  {
    name: "node-version",
    files: { "package.json": "{}", ".node-version": "24\n" },
    runtime: "node24",
  },
  {
    name: "compatible default",
    files: { "package.json": '{"engines":{"node":">=20"}}' },
    runtime: "node22",
  },
  {
    name: "monorepo root requirement",
    root: "apps/web",
    files: {
      "apps/web/package.json": "{}",
      "package.json": '{"engines":{"node":">=24"}}',
    },
    runtime: "node24",
  },
  {
    name: "python",
    files: { "pyproject.toml": "[project]" },
    runtime: "python3.13",
  },
] as const) {
  test(`runtime discovery respects ${fixture.name}`, async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get("ref"), "feature/runtime");
      const file = decodeURIComponent(url.pathname.split("/contents/")[1]);
      const content = (fixture.files as Partial<Record<string, string>>)[file];
      return new Response(init?.method === "HEAD" ? null : (content ?? ""), {
        status: content === undefined ? 404 : 200,
      });
    }) as typeof fetch;
    try {
      assert.equal(
        await detectRuntimeFromGithub(
          "acme/widgets",
          "fixture-token",
          "feature/runtime",
          "root" in fixture ? fixture.root : null
        ),
        fixture.runtime
      );
    } finally {
      globalThis.fetch = original;
    }
  });
}

for (const status of [401, 500]) {
  test(`runtime discovery reports GitHub ${status} instead of selecting a fallback`, async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("", { status })) as typeof fetch;
    try {
      await assert.rejects(
        detectRuntimeFromGithub("acme/widgets", "fixture-token"),
        new RegExp(`GitHub ${status}`)
      );
    } finally {
      globalThis.fetch = original;
    }
  });
}
