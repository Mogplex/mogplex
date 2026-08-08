import assert from "node:assert/strict";
import test from "node:test";

async function loadSandboxClient() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/sandbox/client");
}

test("detects common dev-server readiness signals from log output", async () => {
  const { logSignalsPreviewReady } = await loadSandboxClient();
  assert.equal(logSignalsPreviewReady("ready in 1350ms"), true);
  assert.equal(logSignalsPreviewReady("Local: http://127.0.0.1:3000"), true);
  assert.equal(logSignalsPreviewReady("Application startup complete"), true);
  assert.equal(
    logSignalsPreviewReady("Server started on http://localhost:3000"),
    true
  );
});

test("does not treat generic install logs as preview readiness", async () => {
  const { logSignalsPreviewReady } = await loadSandboxClient();
  assert.equal(logSignalsPreviewReady("Installing dependencies..."), false);
  assert.equal(logSignalsPreviewReady("pnpm install finished"), false);
  assert.equal(logSignalsPreviewReady("waiting for build output"), false);
});

test("extracts explicit dev ports from commands", async () => {
  const { extractPortFromCommand } = await loadSandboxClient();
  assert.equal(extractPortFromCommand("next dev --port 3003"), 3003);
  assert.equal(extractPortFromCommand("vite --port=4173"), 4173);
  assert.equal(extractPortFromCommand("PORT=4321 pnpm run dev"), 4321);
  assert.equal(extractPortFromCommand("pnpm run dev"), null);
});

test("detects dev commands that require Bun", async () => {
  const { commandRequiresBun } = await import("../../lib/sandbox/client-shell");
  assert.equal(commandRequiresBun("bun run src/index.tsx"), true);
  assert.equal(commandRequiresBun("pnpm --filter @mogplex/tui dev"), false);
  assert.equal(commandRequiresBun("echo bunny"), false);
});

test("builds a pinned Bun install command for sandbox previews", async () => {
  const {
    buildEnsureBunCommand,
    buildWithBunOnPathCommand,
    SANDBOX_BUN_VERSION,
  } = await import("../../lib/sandbox/client-shell");
  const command = buildEnsureBunCommand();

  assert.match(command, /command -v bun/);
  assert.match(
    command,
    new RegExp(
      `https://github\\.com/oven-sh/bun/releases/download/bun-v${SANDBOX_BUN_VERSION}/\\$\\{bun_target\\}\\.zip`
    )
  );
  assert.match(command, /export PATH="\$BUN_INSTALL\/bin:\$PATH"/);
  assert.match(
    buildWithBunOnPathCommand("bun run src/index.tsx"),
    /export PATH="\$BUN_INSTALL\/bin:\$PATH"\nbun run src\/index\.tsx/
  );
});

test("allows root 404 readiness for API-oriented runtimes", async () => {
  const { previewAllowsRoot404 } = await loadSandboxClient();
  assert.equal(previewAllowsRoot404({ runtime: "python3.13" }), true);
  assert.equal(
    previewAllowsRoot404({ runtime: "node22", framework: "fastapi" }),
    true
  );
  assert.equal(
    previewAllowsRoot404({ runtime: "node22", framework: "vite" }),
    false
  );
});

test("retryPreviewHealth tolerates brief proxy lag after the dev server logs ready", async () => {
  const { retryPreviewHealth } = await loadSandboxClient();

  const originalFetch = globalThis.fetch;
  let attempts = 0;

  globalThis.fetch = (async () => {
    attempts += 1;
    if (attempts === 1) {
      return new Response("warming up", { status: 503 });
    }

    return new Response("<html>ok</html>", { status: 200 });
  }) as typeof fetch;

  try {
    const health = await retryPreviewHealth(
      "https://preview.example.test",
      undefined,
      1,
      0
    );
    assert.equal(health?.ready, true);
    assert.equal(health?.healthStatus, "running");
    assert.equal(attempts, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("bootstrapFromSnapshotStreaming retries preview health after a ready log", async () => {
  const { bootstrapFromSnapshotStreaming } = await loadSandboxClient();

  const originalFetch = globalThis.fetch;
  let attempts = 0;

  globalThis.fetch = (async () => {
    attempts += 1;
    if (attempts === 1) {
      return new Response("warming up", { status: 503 });
    }

    return new Response("<html>ok</html>", { status: 200 });
  }) as typeof fetch;

  const fakeCommand = {
    async *logs() {
      yield { data: "ready in 375ms\n" };
    },
    wait: () => new Promise<{ exitCode: number | null }>(() => {}),
  };

  const fakeSandbox = {
    readFile: async ({ path }: { path: string }) => {
      if (path === "package.json") return Buffer.from("{}");
      return null;
    },
    readFileToBuffer: async ({ path }: { path: string }) => {
      if (path === "package.json") {
        return Buffer.from(JSON.stringify({ scripts: { dev: "next dev" } }));
      }
      if (path === ".mogplex/dev.log") {
        return Buffer.from("ready in 375ms\n");
      }
      return null;
    },
    runCommand: async () => fakeCommand,
    domain: () => "https://preview.example.test",
  };

  try {
    const events = [];
    for await (const event of bootstrapFromSnapshotStreaming(
      fakeSandbox as never,
      {}
    )) {
      events.push(event);
    }

    assert.equal(attempts, 2);
    assert.deepEqual(events, [
      { type: "preview_url", url: "https://preview.example.test" },
      { type: "log", phase: "dev", data: "ready in 375ms\n" },
      { type: "status", status: "running" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
