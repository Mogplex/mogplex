import assert from "node:assert/strict";
import test from "node:test";
import { buildSystemPrompt } from "../../lib/agents/system-prompt";

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
  assert.match(prompt, /github_create_pull_request with base main/);
  assert.match(prompt, /Never leave completed work only inside the sandbox/);
});
