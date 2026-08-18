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
