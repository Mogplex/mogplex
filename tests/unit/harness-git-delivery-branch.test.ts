import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildHarnessDeliveryPrompt,
  normalizeHarnessDeliveryMode,
  publishHarnessPullRequest,
  type HarnessDeliveryMode,
} from "../../lib/harness/git-delivery";

const BRANCH = "mogplex/automation-0123456789abcdef";

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/**
 * A checkout on the run branch the way the sandbox leaves it: pushed, with
 * the platform's self-ignoring .mogplex directory holding runtime config.
 */
function createRunCheckout() {
  const root = mkdtempSync(path.join(tmpdir(), "mogplex-delivery-"));
  const origin = path.join(root, "origin.git");
  const work = path.join(root, "work");
  const bin = path.join(root, "bin");
  mkdirSync(work);
  mkdirSync(bin);
  execFileSync("git", [
    "init",
    "-q",
    "--bare",
    "--initial-branch=main",
    origin,
  ]);
  git(work, "init", "-q", "--initial-branch=main");
  git(work, "config", "user.email", "test@example.com");
  git(work, "config", "user.name", "Test");
  git(work, "config", "commit.gpgsign", "false");
  writeFileSync(path.join(work, "README.md"), "previews\n");
  git(work, "add", ".");
  git(work, "commit", "-q", "-m", "init");
  git(work, "remote", "add", "origin", origin);
  git(work, "push", "-q", "-u", "origin", "main");
  git(work, "checkout", "-q", "-b", BRANCH);
  git(work, "push", "-q", "-u", "origin", BRANCH);
  mkdirSync(path.join(work, ".mogplex", "artifacts"), { recursive: true });
  writeFileSync(path.join(work, ".mogplex", ".gitignore"), "*\n");
  writeFileSync(path.join(work, ".mogplex", "mcp.json"), '{"token":"secret"}');

  const ghLog = path.join(root, "gh.log");
  writeFileSync(
    path.join(bin, "gh"),
    `#!/bin/sh\necho "$*" >> "${ghLog}"\ncase "$2" in\n  list) printf '%s' "\${FAKE_OPEN_PR_URL:-}" ;;\n  create) echo https://github.com/acme/previews/pull/7 ;;\nesac\n`
  );
  chmodSync(path.join(bin, "gh"), 0o755);
  return { work, origin, bin, ghLog };
}

function localSandbox(
  checkout: ReturnType<typeof createRunCheckout>,
  extraEnv: Record<string, string> = {}
) {
  return {
    runCommand: async (request: {
      args: string[];
      env?: Record<string, string>;
    }) => {
      let stdout = "";
      let stderr = "";
      let exitCode = 0;
      try {
        stdout = execFileSync("sh", ["-c", request.args[1] ?? ""], {
          cwd: checkout.work,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            ...request.env,
            ...extraEnv,
            PATH: `${checkout.bin}:${process.env.PATH}`,
          },
        });
      } catch (error) {
        const failure = error as {
          status?: number;
          stdout?: string;
          stderr?: string;
        };
        exitCode = failure.status ?? 1;
        stdout = failure.stdout ?? "";
        stderr = failure.stderr ?? "";
      }
      return {
        stdout: async () => stdout,
        stderr: async () => stderr,
        wait: async () => ({ exitCode }),
      };
    },
  } as never;
}

function deliver(
  checkout: ReturnType<typeof createRunCheckout>,
  delivery?: HarnessDeliveryMode,
  extraEnv?: Record<string, string>
) {
  return publishHarnessPullRequest(localSandbox(checkout, extraEnv), {
    prompt: "Build the preview site",
    baseBranch: "main",
    workingBranch: BRANCH,
    delivery,
  });
}

function pushedFiles(origin: string) {
  return git(origin, "ls-tree", "-r", "--name-only", BRANCH).split("\n");
}

function ghCalls(ghLog: string) {
  return existsSync(ghLog) ? readFileSync(ghLog, "utf8") : "";
}

function writeAgentWork(work: string) {
  mkdirSync(path.join(work, "sites", "demo"), { recursive: true });
  writeFileSync(path.join(work, "sites", "demo", "content.ts"), "export {};\n");
  git(work, "add", "sites");
  git(work, "commit", "-q", "-m", "Add demo site");
  writeFileSync(
    path.join(work, ".mogplex", "artifacts", "demo.json"),
    '{"version":1}'
  );
}

test("branch delivery pushes the run's artifacts and opens no pull request", async () => {
  const checkout = createRunCheckout();
  writeAgentWork(checkout.work);
  mkdirSync(path.join(checkout.work, ".mogplex", "artifacts", "nested"));
  writeFileSync(
    path.join(checkout.work, ".mogplex", "artifacts", "nested", "x.json"),
    "{}"
  );
  writeFileSync(
    path.join(checkout.work, ".mogplex", "artifacts", "notes.txt"),
    "scratch"
  );

  const delivered = await deliver(checkout, "branch");

  assert.deepEqual(delivered, {
    changed: true,
    pullRequestUrl: null,
    autoCommittedFiles: [".mogplex/artifacts/demo.json"],
  });
  const files = pushedFiles(checkout.origin);
  assert.ok(files.includes("sites/demo/content.ts"));
  assert.ok(files.includes(".mogplex/artifacts/demo.json"));
  assert.ok(!files.includes(".mogplex/mcp.json"));
  assert.ok(!files.includes(".mogplex/.gitignore"));
  assert.ok(!files.includes(".mogplex/artifacts/nested/x.json"));
  assert.ok(!files.includes(".mogplex/artifacts/notes.txt"));
  assert.doesNotMatch(ghCalls(checkout.ghLog), /pr create/);
});

test("branch delivery reports a pull request the agent opened itself", async () => {
  const checkout = createRunCheckout();
  writeAgentWork(checkout.work);

  const delivered = await deliver(checkout, "branch", {
    FAKE_OPEN_PR_URL: "https://github.com/acme/previews/pull/3",
  });

  assert.equal(
    delivered.pullRequestUrl,
    "https://github.com/acme/previews/pull/3"
  );
  assert.doesNotMatch(ghCalls(checkout.ghLog), /pr create/);
});

test("branch delivery refuses runtime files the agent committed", async () => {
  const checkout = createRunCheckout();
  writeAgentWork(checkout.work);
  git(checkout.work, "add", "-f", ".mogplex/mcp.json");
  git(checkout.work, "commit", "-q", "-m", "Leak runtime config");

  await assert.rejects(
    () => deliver(checkout, "branch"),
    /Refusing to deliver committed Mogplex runtime files[\s\S]*\.mogplex\/mcp\.json/
  );
  assert.ok(!pushedFiles(checkout.origin).includes(".mogplex/mcp.json"));
});

test("branch delivery still refuses uncommitted runtime file changes", async () => {
  const checkout = createRunCheckout();
  writeFileSync(path.join(checkout.work, ".mogplex", "skills.json"), "{}");
  git(checkout.work, "add", "-f", ".mogplex/skills.json");

  await assert.rejects(
    () => deliver(checkout, "branch"),
    /Refusing to deliver tracked Mogplex runtime files[\s\S]*\.mogplex\/skills\.json/
  );
});

test("pull request delivery is unchanged: artifacts stay out and a PR opens", async () => {
  const checkout = createRunCheckout();
  writeAgentWork(checkout.work);

  const delivered = await deliver(checkout);

  assert.equal(
    delivered.pullRequestUrl,
    "https://github.com/acme/previews/pull/7"
  );
  assert.ok(
    !pushedFiles(checkout.origin).includes(".mogplex/artifacts/demo.json")
  );
  assert.match(ghCalls(checkout.ghLog), /pr create/);
});

test("only an explicit branch request selects branch delivery", () => {
  assert.equal(normalizeHarnessDeliveryMode("branch"), "branch");
  for (const value of [undefined, null, "", "BRANCH", "push", 1]) {
    assert.equal(normalizeHarnessDeliveryMode(value), "pull_request");
  }
});

test("branch delivery prompt allows artifacts and makes the pull request optional", () => {
  const prompt = buildHarnessDeliveryPrompt({
    prompt: "Build the preview site",
    baseBranch: "main",
    workingBranch: BRANCH,
    delivery: "branch",
  });

  assert.match(prompt, /Open a pull request only if your instructions ask/);
  assert.doesNotMatch(prompt, /Open or update a pull request into main/);
  assert.match(
    prompt,
    /except the JSON artifacts directly under \.mogplex\/artifacts\//
  );
  assert.ok(prompt.endsWith("Build the preview site"));
});
