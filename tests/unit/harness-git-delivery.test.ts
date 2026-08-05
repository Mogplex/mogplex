import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHarnessDeliveryPrompt,
  buildHarnessWorkingBranch,
  publishHarnessPullRequest,
  syncHarnessGitWorkspace,
} from "../../lib/harness/git-delivery";

function sandboxWithResult(input: {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  commands: Array<{ command: string; env?: Record<string, string> }>;
}) {
  return {
    runCommand: async (request: {
      args: string[];
      env?: Record<string, string>;
    }) => {
      input.commands.push({ command: request.args[1] ?? "", env: request.env });
      return {
        stdout: async () => input.stdout ?? "",
        stderr: async () => input.stderr ?? "",
        wait: async () => ({ exitCode: input.exitCode ?? 0 }),
      };
    },
  } as never;
}

test("default-branch harness runs move onto a deterministic delivery branch", async () => {
  const commands: Array<{
    command: string;
    env?: Record<string, string>;
  }> = [];
  const workspace = await syncHarnessGitWorkspace(
    sandboxWithResult({ commands }),
    {
      aiCallId: "12345678-abcd-4321-9999-abcdefabcdef",
      baseBranch: "main",
      workingBranch: "main",
    }
  );

  assert.deepEqual(workspace, {
    baseBranch: "main",
    workingBranch: "mogplex/agent-12345678abcd",
    createdBranch: true,
  });
  assert.match(commands[0]?.command ?? "", /git fetch origin/);
  assert.match(commands[0]?.command ?? "", /git checkout -b/);
  assert.match(commands[0]?.command ?? "", /git push -u origin/);
  assert.equal(commands[0]?.env?.MOGPLEX_BASE_BRANCH, "main");
  assert.equal(
    commands[0]?.env?.MOGPLEX_WORKING_BRANCH,
    "mogplex/agent-12345678abcd"
  );
  assert.equal(commands[0]?.env?.MOGPLEX_CREATE_BRANCH, "1");
});

test("existing delivery branches are fetched, checked out, and fast-forwarded", async () => {
  const commands: Array<{
    command: string;
    env?: Record<string, string>;
  }> = [];
  const workspace = await syncHarnessGitWorkspace(
    sandboxWithResult({ commands }),
    {
      aiCallId: "call-1",
      baseBranch: "main",
      workingBranch: "mogplex/feature",
    }
  );

  assert.equal(workspace.createdBranch, false);
  assert.match(commands[0]?.command ?? "", /git fetch origin/);
  assert.match(commands[0]?.command ?? "", /git pull --ff-only origin/);
  assert.equal(commands[0]?.env?.MOGPLEX_BASE_BRANCH, "main");
  assert.equal(commands[0]?.env?.MOGPLEX_WORKING_BRANCH, "mogplex/feature");
  assert.equal(commands[0]?.env?.MOGPLEX_CREATE_BRANCH, "0");
});

test("delivery prompt requires tests, commit, push, and a pull request", () => {
  const prompt = buildHarnessDeliveryPrompt({
    prompt: "Fix the checkout bug",
    baseBranch: "main",
    workingBranch: "mogplex/fix-checkout",
  });

  assert.match(prompt, /Run the relevant tests/);
  assert.match(prompt, /Commit every intended change/);
  assert.match(prompt, /Push mogplex\/fix-checkout/);
  assert.match(prompt, /pull request into main/);
  assert.ok(prompt.endsWith("Fix the checkout bug"));
});

test("successful code changes are committed, pushed, and return a PR URL", async () => {
  const commands: Array<{ command: string; env?: Record<string, string> }> = [];
  const delivered = await publishHarnessPullRequest(
    sandboxWithResult({
      commands,
      stdout:
        "MOGPLEX_CHANGED=true\nMOGPLEX_PULL_REQUEST_URL=https://github.com/acme/repo/pull/42\n",
    }),
    {
      prompt: "Fix the checkout bug\nwith details",
      baseBranch: "main",
      workingBranch: "mogplex/fix-checkout",
    }
  );

  assert.deepEqual(delivered, {
    changed: true,
    pullRequestUrl: "https://github.com/acme/repo/pull/42",
  });
  assert.match(commands[0]?.command ?? "", /git status --porcelain/);
  assert.match(commands[0]?.command ?? "", /git ls-files --others/);
  assert.match(commands[0]?.command ?? "", /git add -u/);
  assert.doesNotMatch(commands[0]?.command ?? "", /git add -A/);
  assert.match(commands[0]?.command ?? "", /git commit/);
  assert.match(commands[0]?.command ?? "", /git push -u origin/);
  assert.match(commands[0]?.command ?? "", /gh pr create/);
  assert.equal(commands[0]?.env?.MOGPLEX_BASE_BRANCH, "main");
  assert.equal(
    commands[0]?.env?.MOGPLEX_WORKING_BRANCH,
    "mogplex/fix-checkout"
  );
  assert.equal(commands[0]?.env?.MOGPLEX_PR_TITLE, "Fix the checkout bug");
});

test("delivery failures surface the git or GitHub error", async () => {
  await assert.rejects(
    () =>
      publishHarnessPullRequest(
        sandboxWithResult({
          commands: [],
          exitCode: 1,
          stderr: "GraphQL: Resource not accessible by integration",
        }),
        {
          prompt: "Fix it",
          baseBranch: "main",
          workingBranch: buildHarnessWorkingBranch("call-123"),
        }
      ),
    /GitHub delivery failed.*Resource not accessible/
  );
});
