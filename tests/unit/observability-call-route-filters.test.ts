import assert from "node:assert/strict";
import test from "node:test";
import {
  buildClearedCallFilterHref,
  buildCurrentObservabilityCallHref,
  buildClearedRepoCallFilterHref,
  buildClearedSandboxCallFilterHref,
  buildSelectedCallFilterHref,
  mergeObservabilityCallRouteFilters,
  readObservabilityCallRouteFilters,
} from "../../lib/observability/call-route-filters";

test("readObservabilityCallRouteFilters parses and trims repo, sandbox, and call filters", () => {
  const params = new URLSearchParams(
    "repo_id= repo-1 &sandbox_record_id= sandbox-1 &call_id= call-1 "
  );

  assert.deepEqual(readObservabilityCallRouteFilters(params), {
    repoId: "repo-1",
    sandboxRecordId: "sandbox-1",
    callId: "call-1",
  });
});

test("mergeObservabilityCallRouteFilters resets page when repo or sandbox route filters change", () => {
  const previous = {
    page: 3,
    limit: 50,
    sort: "started_at",
    order: "desc" as const,
    repoId: "repo-1",
    sandboxRecordId: undefined,
    callId: undefined,
    type: "chat",
  };

  const next = mergeObservabilityCallRouteFilters(previous, {
    repoId: "repo-2",
    sandboxRecordId: "sandbox-2",
    callId: "call-2",
  });

  assert.deepEqual(next, {
    ...previous,
    page: 1,
    repoId: "repo-2",
    sandboxRecordId: "sandbox-2",
    callId: "call-2",
  });
});

test("mergeObservabilityCallRouteFilters updates callId without resetting page", () => {
  const previous = {
    page: 3,
    limit: 50,
    sort: "started_at",
    order: "desc" as const,
    repoId: "repo-1",
    sandboxRecordId: "sandbox-1",
    callId: undefined,
  };

  const next = mergeObservabilityCallRouteFilters(previous, {
    repoId: "repo-1",
    sandboxRecordId: "sandbox-1",
    callId: "call-2",
  });

  assert.deepEqual(next, {
    ...previous,
    callId: "call-2",
  });
});

test("mergeObservabilityCallRouteFilters clears callId without resetting page", () => {
  const previous = {
    page: 3,
    limit: 50,
    sort: "started_at",
    order: "desc" as const,
    repoId: "repo-1",
    sandboxRecordId: "sandbox-1",
    callId: "call-1",
  };

  const next = mergeObservabilityCallRouteFilters(previous, {
    repoId: "repo-1",
    sandboxRecordId: "sandbox-1",
    callId: undefined,
  });

  assert.deepEqual(next, {
    ...previous,
    callId: undefined,
  });
});

test("mergeObservabilityCallRouteFilters resets page when only the sandbox filter changes", () => {
  const previous = {
    page: 3,
    limit: 50,
    sort: "started_at",
    order: "desc" as const,
    repoId: "repo-1",
    sandboxRecordId: "sandbox-1",
    callId: "call-1",
    type: "chat",
  };

  const next = mergeObservabilityCallRouteFilters(previous, {
    repoId: "repo-1",
    sandboxRecordId: "sandbox-2",
    callId: "call-1",
  });

  assert.deepEqual(next, {
    ...previous,
    page: 1,
    sandboxRecordId: "sandbox-2",
  });
});

test("mergeObservabilityCallRouteFilters returns the previous object when route filters are unchanged", () => {
  const previous = {
    page: 1,
    limit: 50,
    sort: "started_at",
    order: "desc" as const,
    repoId: "repo-1",
    sandboxRecordId: "sandbox-1",
    callId: "call-1",
  };

  const next = mergeObservabilityCallRouteFilters(previous, {
    repoId: "repo-1",
    sandboxRecordId: "sandbox-1",
    callId: "call-1",
  });

  assert.equal(next, previous);
});

test("buildClearedRepoCallFilterHref removes only repo_id", () => {
  const href = buildClearedRepoCallFilterHref(
    new URLSearchParams(
      "repo_id=repo-1&sandbox_record_id=sandbox-1&call_id=call-1&type=chat"
    )
  );
  assert.equal(
    href,
    "/observability?sandbox_record_id=sandbox-1&call_id=call-1&type=chat"
  );
});

test("buildClearedSandboxCallFilterHref removes only sandbox_record_id", () => {
  const href = buildClearedSandboxCallFilterHref(
    new URLSearchParams(
      "repo_id=repo-1&sandbox_record_id=sandbox-1&call_id=call-1&type=chat"
    )
  );
  assert.equal(href, "/observability?repo_id=repo-1&call_id=call-1&type=chat");
});

test("buildSelectedCallFilterHref replaces call_id and preserves unrelated params", () => {
  const href = buildSelectedCallFilterHref(
    new URLSearchParams(
      "repo_id=repo-1&sandbox_record_id=sandbox-1&call_id=call-1&type=chat&page=2&order=asc"
    ),
    "call-2"
  );
  assert.equal(
    href,
    "/observability?repo_id=repo-1&sandbox_record_id=sandbox-1&call_id=call-2&type=chat&page=2&order=asc"
  );
});

test("buildCurrentObservabilityCallHref preserves the full current query state", () => {
  const href = buildCurrentObservabilityCallHref(
    new URLSearchParams(
      "repo_id=repo-1&sandbox_record_id=sandbox-1&call_id=call-1&type=chat&status=success&page=2&foo=bar"
    )
  );
  assert.equal(
    href,
    "/observability?repo_id=repo-1&sandbox_record_id=sandbox-1&call_id=call-1&type=chat&status=success&page=2&foo=bar"
  );
});

test("buildClearedCallFilterHref removes only call_id and preserves repo, sandbox, and unrelated params", () => {
  const href = buildClearedCallFilterHref(
    new URLSearchParams(
      "repo_id=repo-1&sandbox_record_id=sandbox-1&call_id=call-1&type=chat&page=2&order=asc"
    )
  );
  assert.equal(
    href,
    "/observability?repo_id=repo-1&sandbox_record_id=sandbox-1&type=chat&page=2&order=asc"
  );
});
