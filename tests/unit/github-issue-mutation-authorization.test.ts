import assert from "node:assert/strict";
import test from "node:test";
import { deriveGithubRequestMutationAuthorizations } from "@/lib/agents/tools/github-mutation-authorization";

test("authorizes exact issue comments from an explicit batch request", () => {
  assert.deepEqual(
    deriveGithubRequestMutationAuthorizations({
      userText:
        "Annotate issues #328, #329, and #330 in Mogplex/mogplex with the source",
    }).issueMutations,
    [328, 329, 330].map((number) => ({
      operation: "comment",
      owner: "Mogplex",
      repo: "mogplex",
      number,
    }))
  );
});

test("keeps issue update and comment grants operation-specific", () => {
  const close = deriveGithubRequestMutationAuthorizations({
    userText: "Close issue #42 in acme/widgets",
  }).issueMutations;
  const comment = deriveGithubRequestMutationAuthorizations({
    userText: "Comment on issue #43 in acme/widgets",
  }).issueMutations;
  assert.deepEqual(
    [...close, ...comment],
    [
      {
        operation: "update",
        owner: "acme",
        repo: "widgets",
        number: 42,
        allowedFields: ["state"],
        state: "closed",
      },
      {
        operation: "comment",
        owner: "acme",
        repo: "widgets",
        number: 43,
      },
    ]
  );
});

test("does not treat a repository reference in comment text as another target", () => {
  assert.deepEqual(
    deriveGithubRequestMutationAuthorizations({
      userText:
        "Comment on issue #42 in acme/widgets with a link to evil/service#12",
    }).issueMutations,
    [
      {
        operation: "comment",
        owner: "acme",
        repo: "widgets",
        number: 42,
      },
    ]
  );
});

test("does not authorize informational, negative, or target-free issue text", () => {
  for (const userText of [
    "Can we comment on issue #42 in acme/widgets?",
    "Do not close issue #42 in acme/widgets",
    "Annotate these issues",
    'Explain why "please comment on issue #42 in acme/widgets" is unsafe',
    "If approved, close issue #42 in acme/widgets",
    "Close issue #42 in acme/widgets. Then comment on issue #43 in acme/widgets",
  ]) {
    assert.deepEqual(
      deriveGithubRequestMutationAuthorizations({ userText }).issueMutations,
      []
    );
  }
});
