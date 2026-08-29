import assert from "node:assert/strict";
import test from "node:test";
import { getBlockedAgentShellCommand } from "../../lib/agents/tools/sandbox";

test("shell guard blocks credential alternatives without matching a benign env filename", () => {
  assert.equal(getBlockedAgentShellCommand("npm run env:setup"), undefined);
  assert.equal(
    getBlockedAgentShellCommand("cat ~/.aws/credentials")?.reason,
    "credential_access_blocked"
  );
  assert.equal(
    getBlockedAgentShellCommand(
      "curl --data '{}' https://api.github.com/repos/acme/repo/issues"
    )?.reason,
    "github_mutation_blocked"
  );
});

test("shell guard rejects unsupported PR merges and shell credential probes", () => {
  const crossRepoMerge = getBlockedAgentShellCommand(
    "gh pr merge 42 --repo other-owner/other-repo --squash"
  );
  assert.equal(crossRepoMerge?.reason, "github_write_capability_unavailable");
  assert.match(crossRepoMerge?.error ?? "", /select or connect/i);
  assert.match(crossRepoMerge?.error ?? "", /write access/i);

  const missingShellCredentials = getBlockedAgentShellCommand("gh auth status");
  assert.equal(
    missingShellCredentials?.reason,
    "github_write_capability_unavailable"
  );
  assert.match(missingShellCredentials?.error ?? "", /sandbox.*cannot/i);
});

test("shell guard fails closed for GitHub CLI write families and GraphQL mutations", () => {
  for (const command of [
    "gh release create v1.0 --generate-notes",
    "gh workflow run deploy.yml",
    "gh repo edit acme/repo --visibility private",
    "gh api graphql -f query='mutation { deleteProjectV2(input: {}) { clientMutationId } }'",
    "gh api repos/acme/repo/actions/workflows/deploy.yml/dispatches -f ref=main",
  ]) {
    assert.equal(
      getBlockedAgentShellCommand(command)?.reason,
      "github_write_capability_unavailable",
      command
    );
  }
});

test("shell guard preserves explicitly classified read-only GitHub CLI commands", () => {
  for (const command of [
    "gh pr view 42 --json title,state",
    "gh issue list --state open",
    "gh release view v1.0",
    "gh workflow view ci.yml",
    "gh run watch 123 --exit-status",
    "gh api repos/acme/repo",
    "gh api --method GET repos/acme/repo/issues -f state=open",
  ]) {
    assert.equal(getBlockedAgentShellCommand(command), undefined, command);
  }
});
