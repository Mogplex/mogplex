import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPRFixTools,
  buildSandboxPRFixTools,
  buildUpdateFilePatch,
} from "../../lib/agents/pr-fixer";

type UpdateFileToolResult = {
  success: boolean;
  branch?: string;
  path?: string;
  commitSha?: string | null;
  commitUrl?: string | null;
  patch?: string | null;
  error?: string;
};

type UpdateFileTool = {
  execute: (input: {
    path: string;
    content: string;
    message: string;
  }) => Promise<UpdateFileToolResult>;
};

type ListFilesTool = {
  execute: (input: { path: string }) => Promise<
    Array<{
      name: string;
      path: string;
      type: string;
    }>
  >;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("buildUpdateFilePatch returns null for no-op writes", () => {
  assert.equal(buildUpdateFilePatch("src/widget.ts", "same\n", "same\n"), null);
});

test("buildUpdateFilePatch emits new-file patches", () => {
  assert.deepEqual(
    buildUpdateFilePatch(
      "src/widget.ts",
      null,
      "export const value = 1;\n"
    )?.split("\n"),
    [
      "diff --git a/src/widget.ts b/src/widget.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/src/widget.ts",
      "@@ -0,0 +1,1 @@",
      "+export const value = 1;",
    ]
  );
});

test("buildUpdateFilePatch normalizes CRLF and marks missing trailing newlines", () => {
  assert.deepEqual(
    buildUpdateFilePatch(
      "src/widget.ts",
      "old\r\nvalue",
      "new\r\nvalue"
    )?.split("\n"),
    [
      "diff --git a/src/widget.ts b/src/widget.ts",
      "index 0000000..0000000 100644",
      "--- a/src/widget.ts",
      "+++ b/src/widget.ts",
      "@@ -1,2 +1,2 @@",
      "-old",
      "-value",
      "\\ No newline at end of file",
      "+new",
      "+value",
      "\\ No newline at end of file",
    ]
  );
});

test("updateFile suppresses patches when GitHub does not return base64 content", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ input: string; init?: RequestInit }> = [];

  globalThis.fetch = (async (input, init) => {
    calls.push({ input: String(input), init });

    if (calls.length === 1) {
      return jsonResponse({
        content: "",
        encoding: "none",
        sha: "existing-sha",
      });
    }

    return jsonResponse({
      content: { path: "src/large.ts" },
      commit: {
        sha: "commit-sha",
        html_url: "https://github.com/acme/widgets/commit/commit-sha",
      },
    });
  }) satisfies typeof fetch;

  try {
    const updateFile = buildPRFixTools({
      githubToken: "token",
      owner: "acme",
      repo: "widgets",
      headOwner: "acme",
      headRepo: "widgets",
      prNumber: 42,
      branch: "fix/widgets",
    }).updateFile as unknown as UpdateFileTool;

    const result = await updateFile.execute({
      path: "src/large.ts",
      content: "export const value = 2;\n",
      message: "Update large file",
    });

    assert.deepEqual(result, {
      success: true,
      branch: "fix/widgets",
      path: "src/large.ts",
      commitSha: "commit-sha",
      commitUrl: "https://github.com/acme/widgets/commit/commit-sha",
      patch: null,
    });
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sandbox updateFile writes, commits, and pushes with command env", async () => {
  const commands: Array<{
    cmd: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
  }> = [];
  const writes: Array<{ path: string; content: Buffer }> = [];
  const sandbox = {
    readFileToBuffer: async ({ path }: { path: string }) => {
      assert.equal(path, "app/src/widget.ts");
      return Buffer.from("export const value = 1;\n");
    },
    writeFiles: async (files: Array<{ path: string; content: Buffer }>) => {
      writes.push(...files);
    },
    runCommand: async (input: {
      cmd: string;
      args?: string[];
      cwd?: string;
      env?: Record<string, string>;
    }) => {
      commands.push(input);
      if (input.cmd === "mkdir") {
        return {
          exitCode: 0,
          stdout: async () => "",
          stderr: async () => "",
        };
      }
      return {
        exitCode: 0,
        stdout: async () =>
          "[fix/widgets abcdef1234567890abcdef1234567890abcdef12] Fix widget\nabcdef1234567890abcdef1234567890abcdef12\n",
        stderr: async () => "",
      };
    },
  };

  const updateFile = buildSandboxPRFixTools({
    githubToken: "github-token",
    owner: "acme",
    repo: "widgets",
    headOwner: "acme",
    headRepo: "widgets",
    prNumber: 42,
    branch: "fix/widgets",
    sandbox: sandbox as Parameters<typeof buildSandboxPRFixTools>[0]["sandbox"],
    rootDirectory: "app",
  }).updateFile as unknown as UpdateFileTool;

  const result = await updateFile.execute({
    path: "src/widget.ts",
    content: "export const value = 2;\n",
    message: "Fix widget",
  });

  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.path, "app/src/widget.ts");
  assert.equal(
    writes[0]?.content.toString("utf-8"),
    "export const value = 2;\n"
  );
  assert.equal(commands.at(-1)?.cmd, "sh");
  assert.equal(commands.at(-1)?.cwd, "app");
  assert.deepEqual(commands.at(-1)?.env, {
    GITHUB_TOKEN: "github-token",
    GITHUB_REPOSITORY: "acme/widgets",
    MOGPLEX_BRANCH: "fix/widgets",
    MOGPLEX_COMMIT_MESSAGE: "Fix widget",
    MOGPLEX_FILE: "src/widget.ts",
  });
  assert.deepEqual(result, {
    success: true,
    branch: "fix/widgets",
    path: "src/widget.ts",
    commitSha: "abcdef1234567890abcdef1234567890abcdef12",
    commitUrl:
      "https://github.com/acme/widgets/commit/abcdef1234567890abcdef1234567890abcdef12",
    patch: [
      "diff --git a/src/widget.ts b/src/widget.ts",
      "index 0000000..0000000 100644",
      "--- a/src/widget.ts",
      "+++ b/src/widget.ts",
      "@@ -1,1 +1,1 @@",
      "-export const value = 1;",
      "+export const value = 2;",
    ].join("\n"),
  });
});

test("sandbox updateFile strips rootDirectory from repo-root paths", async () => {
  const commands: Array<{
    cmd: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
  }> = [];
  const writes: Array<{ path: string; content: Buffer }> = [];
  const sandbox = {
    readFileToBuffer: async ({ path }: { path: string }) => {
      assert.equal(path, "app/src/widget.ts");
      return Buffer.from("export const value = 1;\n");
    },
    writeFiles: async (files: Array<{ path: string; content: Buffer }>) => {
      writes.push(...files);
    },
    runCommand: async (input: {
      cmd: string;
      args?: string[];
      cwd?: string;
      env?: Record<string, string>;
    }) => {
      commands.push(input);
      return {
        exitCode: 0,
        stdout: async () =>
          input.cmd === "sh"
            ? "[fix/widgets abcdef1234567890abcdef1234567890abcdef12] Fix widget\nabcdef1234567890abcdef1234567890abcdef12\n"
            : "",
        stderr: async () => "",
      };
    },
  };

  const updateFile = buildSandboxPRFixTools({
    githubToken: "github-token",
    owner: "acme",
    repo: "widgets",
    headOwner: "acme",
    headRepo: "widgets",
    prNumber: 42,
    branch: "fix/widgets",
    sandbox: sandbox as Parameters<typeof buildSandboxPRFixTools>[0]["sandbox"],
    rootDirectory: "app",
  }).updateFile as unknown as UpdateFileTool;

  const result = await updateFile.execute({
    path: "app/src/widget.ts",
    content: "export const value = 2;\n",
    message: "Fix widget",
  });

  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.path, "app/src/widget.ts");
  assert.equal(commands.at(-1)?.cwd, "app");
  assert.equal(commands.at(-1)?.env?.MOGPLEX_FILE, "src/widget.ts");
  assert.deepEqual(result, {
    success: true,
    branch: "fix/widgets",
    path: "app/src/widget.ts",
    commitSha: "abcdef1234567890abcdef1234567890abcdef12",
    commitUrl:
      "https://github.com/acme/widgets/commit/abcdef1234567890abcdef1234567890abcdef12",
    patch: [
      "diff --git a/app/src/widget.ts b/app/src/widget.ts",
      "index 0000000..0000000 100644",
      "--- a/app/src/widget.ts",
      "+++ b/app/src/widget.ts",
      "@@ -1,1 +1,1 @@",
      "-export const value = 1;",
      "+export const value = 2;",
    ].join("\n"),
  });
});

test("sandbox listFiles strips rootDirectory from repo-root paths", async () => {
  const commands: Array<{
    cmd: string;
    args?: string[];
    cwd?: string;
  }> = [];
  const sandbox = {
    readFileToBuffer: async () => Buffer.from(""),
    writeFiles: async () => undefined,
    runCommand: async (input: {
      cmd: string;
      args?: string[];
      cwd?: string;
    }) => {
      commands.push(input);
      return {
        exitCode: 0,
        stdout: async () =>
          JSON.stringify([
            { name: "widget.ts", path: "src/widget.ts", type: "file" },
          ]),
        stderr: async () => "",
      };
    },
  };

  const listFiles = buildSandboxPRFixTools({
    githubToken: "github-token",
    owner: "acme",
    repo: "widgets",
    headOwner: "acme",
    headRepo: "widgets",
    prNumber: 42,
    branch: "fix/widgets",
    sandbox: sandbox as unknown as Parameters<
      typeof buildSandboxPRFixTools
    >[0]["sandbox"],
    rootDirectory: "app",
  }).listFiles as unknown as ListFilesTool;

  const result = await listFiles.execute({ path: "app/src" });

  assert.equal(commands.length, 1);
  assert.equal(commands[0]?.cmd, "node");
  assert.equal(commands[0]?.cwd, "app");
  assert.equal(commands[0]?.args?.[2], "src");
  assert.deepEqual(result, [
    { name: "widget.ts", path: "src/widget.ts", type: "file" },
  ]);
});
