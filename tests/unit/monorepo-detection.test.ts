import assert from "node:assert/strict";
import test from "node:test";

async function loadMonorepoDetection() {
  return import("../../lib/monorepo-detection");
}

function extractPath(input: string | URL) {
  const url = new URL(typeof input === "string" ? input : input.toString());
  const match = /\/contents\/(.+)$/.exec(url.pathname);
  return decodeURIComponent(match?.[1] || "");
}

test("parsePnpmWorkspaceGlobs reads package entries from pnpm-workspace.yaml", async () => {
  const { parsePnpmWorkspaceGlobs } = await loadMonorepoDetection();

  const globs = parsePnpmWorkspaceGlobs(
    ["packages:", '  - "."', '  - "web"', '  - "packages/*"'].join("\n")
  );

  assert.deepEqual(globs, [".", "web", "packages/*"]);
});

test("detectMonorepoStructure surfaces direct pnpm workspace paths like web", async () => {
  const { detectMonorepoStructure } = await loadMonorepoDetection();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ) => {
    const url = input instanceof Request ? input.url : input;
    const path = extractPath(url);
    const method =
      init?.method || (input instanceof Request ? input.method : "GET");

    if (method === "HEAD") {
      if (path === "pnpm-workspace.yaml" || path === "web/package.json") {
        return new Response(null, { status: 200 });
      }
      return new Response(null, { status: 404 });
    }

    if (path === "package.json") {
      return Response.json(
        { name: "credit-renew-actor" },
        {
          status: 200,
        }
      );
    }

    if (path === "pnpm-workspace.yaml") {
      return new Response(
        ["packages:", '  - "."', '  - "web"', '  - "packages/*"'].join("\n"),
        { status: 200 }
      );
    }

    if (path === "web/package.json") {
      return Response.json(
        {
          dependencies: { next: "16.2.0" },
        },
        { status: 200 }
      );
    }

    if (path === "packages") {
      return Response.json([], { status: 200 });
    }

    return new Response("Not Found", { status: 404 });
  }) as typeof fetch;

  try {
    const structure = await detectMonorepoStructure(
      "webrenew/credit-renew",
      "token",
      "main"
    );
    assert.equal(structure.is_monorepo, true);
    assert.equal(structure.marker, "pnpm-workspace.yaml");
    assert.deepEqual(structure.workspaces, [
      {
        path: "web",
        name: "web",
        hasPackageJson: true,
        framework: "next",
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
