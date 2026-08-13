import assert from "node:assert/strict";
import test from "node:test";

/**
 * These tests exercise both the command shapes and the runtime behavior of
 * the baseline bootstrap path.
 */

function shellQuote(value: string) {
  return `'${value.replace(/'/g, String.raw`'\''`)}'`;
}

function buildFetchCommand(
  baseBranch: string,
  workingBranch: string,
  createBranch: boolean
) {
  const refs = createBranch ? [baseBranch] : [baseBranch, workingBranch];
  return `git fetch --depth=1 origin ${refs.map(shellQuote).join(" ")}`;
}

function buildCheckoutCommand(
  baseBranch: string,
  workingBranch: string,
  createBranch: boolean
) {
  return createBranch
    ? `git checkout -b ${shellQuote(workingBranch)} origin/${shellQuote(
        baseBranch
      )} && git push -u origin ${shellQuote(workingBranch)}`
    : `git checkout -B ${shellQuote(workingBranch)} origin/${shellQuote(
        workingBranch
      )}`;
}

test("fetch command pulls only base branch when createBranch=true", () => {
  const cmd = buildFetchCommand("main", "feat/new", true);
  assert.equal(cmd, "git fetch --depth=1 origin 'main'");
});

test("fetch command pulls both branches when not creating", () => {
  const cmd = buildFetchCommand("main", "feat/x", false);
  assert.equal(cmd, "git fetch --depth=1 origin 'main' 'feat/x'");
});

test("checkout command creates branch and pushes when createBranch=true", () => {
  const cmd = buildCheckoutCommand("main", "feat/new", true);
  assert.match(cmd, /git checkout -b 'feat\/new' origin\/'main'/);
  assert.match(cmd, /git push -u origin 'feat\/new'/);
});

test("checkout command forces existing branch when not creating", () => {
  const cmd = buildCheckoutCommand("main", "feat/x", false);
  assert.equal(cmd, "git checkout -B 'feat/x' origin/'feat/x'");
});

test("shell quoting survives single quotes in branch names", () => {
  assert.equal(shellQuote("feat/o'malley"), String.raw`'feat/o'\''malley'`);
});

test("BaselineSnapshotRestoreError exposes phase and cause", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  const { BaselineSnapshotRestoreError } =
    await import("../../lib/sandbox/client");
  const cause = new Error("inner");
  const err = new BaselineSnapshotRestoreError("boom", "checkout", cause);
  assert.equal(err.name, "BaselineSnapshotRestoreError");
  assert.equal(err.phase, "checkout");
  assert.equal(err.cause, cause);
});

test("baseline streaming ensures Bun before launching the dev command", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  const { bootstrapFromBaselineSnapshotStreaming } =
    await import("../../lib/sandbox/client");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("<html>ok</html>", { status: 200 })) as typeof fetch;

  const shCommands: string[] = [];
  const fakeSandbox = {
    readFile: async () => null,
    readFileToBuffer: async ({ path }: { path: string }) => {
      if (path === "package.json") {
        return Buffer.from(
          JSON.stringify({
            scripts: { dev: "pnpm --filter @mogplex/tui dev" },
          })
        );
      }
      if (path === ".mogplex/dev.log") {
        return Buffer.from("ready in 375ms\n");
      }
      return null;
    },
    runCommand: async (opts: {
      cmd: string;
      args?: string[];
      detached?: boolean;
    }) => {
      if (opts.cmd === "node") {
        return {
          stdout: async () => "1",
          stderr: async () => "",
          exitCode: 0,
        };
      }
      shCommands.push(opts.args?.[1] ?? "");
      if (opts.detached) {
        return {
          async *logs() {
            yield { data: "ready in 375ms\n" };
          },
          wait: () => new Promise<{ exitCode: number | null }>(() => {}),
        };
      }
      return {
        stdout: async () => "",
        stderr: async () => "",
        exitCode: 0,
      };
    },
    domain: () => "https://preview.example.test",
  };

  try {
    const events = [];
    for await (const event of bootstrapFromBaselineSnapshotStreaming(
      fakeSandbox as never,
      {
        baseBranch: "main",
        workingBranch: "feature/bun",
        createBranch: false,
        expectedLockfileHash: "baseline-hash",
      }
    )) {
      events.push(event);
    }

    const ensureIndex = shCommands.findIndex((command) =>
      command.includes("command -v bun")
    );
    const devIndex = shCommands.findIndex((command) =>
      command.includes("dev.log")
    );
    assert.ok(ensureIndex !== -1, "expected an ensure-bun command");
    assert.ok(devIndex > ensureIndex, "expected Bun setup before dev launch");
    assert.deepEqual(
      events.filter(
        (event) => event.type === "log" && event.phase === "install"
      ),
      [
        {
          type: "log",
          phase: "install",
          data: "Ensuring Bun runtime is available...\n",
        },
        { type: "log", phase: "install", data: "Bun runtime ready.\n" },
      ]
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("streamed Bun prerequisite failures retain setup diagnostics", async () => {
  const { streamRuntimePrerequisitePhase } =
    await import("../../lib/sandbox/client-bootstrap-phases");
  const { SandboxBootstrapError } =
    await import("../../lib/sandbox/client-validation");
  const stream = streamRuntimePrerequisitePhase(
    {
      runCommand: async () => ({
        stdout: async () => "",
        stderr: async () => "bun archive checksum mismatch",
        exitCode: 1,
      }),
    } as never,
    true,
    {} as never,
    "https://preview.example.test"
  );

  assert.deepEqual(await stream.next(), {
    done: false,
    value: {
      type: "log",
      phase: "install",
      data: "Ensuring Bun runtime is available...\n",
    },
  });
  await assert.rejects(stream.next(), (error: unknown) => {
    assert.ok(error instanceof SandboxBootstrapError);
    assert.equal(error.installLog, "bun archive checksum mismatch");
    return true;
  });
});
