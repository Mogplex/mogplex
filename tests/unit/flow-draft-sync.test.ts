import assert from "node:assert/strict";
import test from "node:test";
import { shouldHydrateFlowDraftFromServer } from "../../lib/flows/draft-sync";

test("hydrates when the user switches to a different flow", () => {
  assert.equal(
    shouldHydrateFlowDraftFromServer({
      currentFlowId: "flow-a",
      incomingFlowId: "flow-b",
      hasDraftHistory: true,
      hasBaselineDraft: true,
      dirty: true,
      currentBaselineSignature: "draft-a",
      incomingSignature: "draft-b",
    }),
    true
  );
});

test("does not hydrate same-flow server echoes over dirty local edits", () => {
  assert.equal(
    shouldHydrateFlowDraftFromServer({
      currentFlowId: "flow-a",
      incomingFlowId: "flow-a",
      hasDraftHistory: true,
      hasBaselineDraft: true,
      dirty: true,
      currentBaselineSignature: "saved-snapshot",
      incomingSignature: "stale-snapshot",
    }),
    false
  );
});

test("hydrates clean same-flow state when the server draft diverges", () => {
  assert.equal(
    shouldHydrateFlowDraftFromServer({
      currentFlowId: "flow-a",
      incomingFlowId: "flow-a",
      hasDraftHistory: true,
      hasBaselineDraft: true,
      dirty: false,
      currentBaselineSignature: "saved-snapshot",
      incomingSignature: "server-updated-snapshot",
    }),
    true
  );
});

test("skips hydration when a clean same-flow revalidation matches the local baseline", () => {
  assert.equal(
    shouldHydrateFlowDraftFromServer({
      currentFlowId: "flow-a",
      incomingFlowId: "flow-a",
      hasDraftHistory: true,
      hasBaselineDraft: true,
      dirty: false,
      currentBaselineSignature: "saved-snapshot",
      incomingSignature: "saved-snapshot",
    }),
    false
  );
});

// Documents an invariant: during init races, `history` and `baselineDraft` may be
// populated in separate setState calls, so either flag can trail the other. Both
// asymmetric shapes must hydrate so the pane finishes initializing, regardless of
// which signal lands first. Guards this against a future refactor from `||` to `&&`.
test("hydrates when draft history is populated but baseline draft is missing", () => {
  assert.equal(
    shouldHydrateFlowDraftFromServer({
      currentFlowId: "flow-a",
      incomingFlowId: "flow-a",
      hasDraftHistory: true,
      hasBaselineDraft: false,
      dirty: false,
      currentBaselineSignature: null,
      incomingSignature: "server-snapshot",
    }),
    true
  );
});

test("hydrates when baseline draft is populated but draft history is missing", () => {
  assert.equal(
    shouldHydrateFlowDraftFromServer({
      currentFlowId: "flow-a",
      incomingFlowId: "flow-a",
      hasDraftHistory: false,
      hasBaselineDraft: true,
      dirty: false,
      currentBaselineSignature: "saved-snapshot",
      incomingSignature: "server-snapshot",
    }),
    true
  );
});
