import assert from "node:assert/strict";
import test from "node:test";

import {
  MOGPLEX_AUTOMATION_COMMENT_MARKER,
  isMogplexAuthoredComment,
  withAutomationMarker,
} from "../../lib/github-automation-marker";
import { MOGPLEX_PR_REVIEW_TIMELINE_MARKER } from "../../lib/github-check-runs";

test("withAutomationMarker appends the hidden marker once", () => {
  const stamped = withAutomationMarker(
    "Thanks @mogplex — addressed all three."
  );
  assert.ok(stamped.includes(MOGPLEX_AUTOMATION_COMMENT_MARKER));

  const restamped = withAutomationMarker(stamped);
  const occurrences =
    restamped.split(MOGPLEX_AUTOMATION_COMMENT_MARKER).length - 1;
  assert.equal(occurrences, 1, "marker must not be duplicated");
});

test("isMogplexAuthoredComment detects our own marked comments", () => {
  const ours = withAutomationMarker("Both fixed in `925bfd2`. @mogplex");
  assert.equal(isMogplexAuthoredComment(ours), true);
});

test("isMogplexAuthoredComment detects the PR-review timeline comment", () => {
  const timeline = `${MOGPLEX_PR_REVIEW_TIMELINE_MARKER}\nReview summary @mogplex`;
  assert.equal(isMogplexAuthoredComment(timeline), true);
});

test("isMogplexAuthoredComment ignores a human comment that mentions us", () => {
  assert.equal(
    isMogplexAuthoredComment("@mogplex please fix the failing tests"),
    false
  );
  assert.equal(isMogplexAuthoredComment(null), false);
  assert.equal(isMogplexAuthoredComment(undefined), false);
});
