import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSystemPrompt,
  resolveAgentDeliveryBranch,
} from "../../lib/agents/system-prompt";

test("sandbox agents receive the fetch, checkout, push, and PR delivery contract", () => {
  const prompt = buildSystemPrompt({
    repoFullName: "acme/demo",
    repoOwner: "acme",
    repoName: "demo",
    repoBranch: "mogplex/fix-checkout",
    repoBaseBranch: "main",
    sandboxId: "sandbox-1",
  });

  assert.match(
    prompt,
    /git fetch origin && git checkout mogplex\/fix-checkout && git pull --ff-only origin mogplex\/fix-checkout/
  );
  assert.match(prompt, /commit and push mogplex\/fix-checkout/);
  assert.match(
    prompt,
    /github_create_pull_request with head mogplex\/fix-checkout and base main/
  );
  assert.match(prompt, /Never leave completed work only inside the sandbox/);
});

test("legacy base-branch sandboxes are redirected to an isolated delivery branch", () => {
  const prompt = buildSystemPrompt({
    repoFullName: "acme/demo",
    repoOwner: "acme",
    repoName: "demo",
    repoBranch: "main",
    repoBaseBranch: "main",
    sandboxId: "sandbox-123",
  });

  assert.equal(
    resolveAgentDeliveryBranch({
      repoBranch: "main",
      repoBaseBranch: "main",
      sandboxId: "sandbox-123",
    }),
    "mogplex/agent-sandbox-123"
  );
  assert.match(
    prompt,
    /switch to the isolated delivery branch mogplex\/agent-sandbox-123/
  );
  assert.match(prompt, /Never commit or push directly to main/);
  assert.match(
    prompt,
    /github_create_pull_request with head mogplex\/agent-sandbox-123 and base main/
  );
});

test("repositories without a sandbox keep their actual branch", () => {
  assert.equal(
    resolveAgentDeliveryBranch({
      repoBranch: "main",
      repoBaseBranch: "main",
    }),
    "main"
  );
});
