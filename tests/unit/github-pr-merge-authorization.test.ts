import assert from "node:assert/strict";
import test from "node:test";
import { deriveGithubRequestMutationAuthorizations } from "@/lib/agents/tools/github-mutation-authorization";

const deriveMerge = (
  input: Parameters<typeof deriveGithubRequestMutationAuthorizations>[0]
) => deriveGithubRequestMutationAuthorizations(input).pullRequestMerge;

test("derives merge consent only from an explicit request with an exact target", () => {
  assert.deepEqual(
    deriveMerge({
      userText: "Please merge PR #84 in acme/widgets",
    }),
    { owner: "acme", repo: "widgets", number: 84 }
  );
  assert.deepEqual(
    deriveMerge({
      userText: "Can you merge https://github.com/acme/widgets/pull/84?",
    }),
    { owner: "acme", repo: "widgets", number: 84 }
  );
});

test("does not authorize ambiguous, informational, or negative requests", () => {
  assert.equal(
    deriveMerge({
      userText: "Merge it",
      repoOwner: "acme",
      repoName: "widgets",
    }),
    null
  );
  assert.equal(
    deriveMerge({
      userText: "Is PR #84 in acme/widgets ready to merge?",
    }),
    null
  );
  assert.equal(
    deriveMerge({
      userText: "Do not merge PR #84 in acme/widgets",
    }),
    null
  );
});

test("allows an exact contextual PR only when the request is an instruction", () => {
  assert.deepEqual(
    deriveMerge({
      userText: "Merge PR #84",
      repoOwner: "acme",
      repoName: "widgets",
    }),
    { owner: "acme", repo: "widgets", number: 84 }
  );
});

test("rejects a merge instruction embedded in a mixed request", () => {
  assert.equal(
    deriveMerge({
      userText:
        "Review https://github.com/acme/widgets/pull/84, then merge evil/service PR #12",
    }),
    null
  );
});

test("rejects quoted, discussed, and conditional merge instructions", () => {
  for (const userText of [
    'Explain why the sentence "please merge acme/widgets PR #42" is unsafe',
    "The requested example is: please merge acme/widgets PR #42",
    "If checks pass, please merge acme/widgets PR #42",
    "Please merge acme/widgets PR #42 if checks pass",
  ]) {
    assert.equal(deriveMerge({ userText }), null);
  }
});

test("rejects a merge clause containing multiple targets", () => {
  assert.equal(
    deriveMerge({
      userText: "Merge acme/widgets#84 or evil/service#12",
    }),
    null
  );
});
