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
