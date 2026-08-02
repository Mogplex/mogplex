import assert from "node:assert/strict";
import test from "node:test";
import { getExpandedCallRowIds } from "../../lib/observability/call-expansion";

test("getExpandedCallRowIds returns undefined without an exact call or sandbox filter", () => {
  const result = getExpandedCallRowIds(
    [
      {
        id: "call-1",
        sandbox_context: {
          sandbox_record_id: "sandbox-1",
          sandbox_id: "runtime-1",
          compute_billing_source: "platform",
          billing_project_id: null,
          billing_team_id: null,
          preview_url: null,
        },
      },
    ],
    {}
  );

  assert.equal(result, undefined);
});

test("getExpandedCallRowIds prefers an exact call id match", () => {
  const result = getExpandedCallRowIds(
    [
      {
        id: "call-1",
        sandbox_context: {
          sandbox_record_id: "sandbox-1",
          sandbox_id: "runtime-1",
          compute_billing_source: "platform",
          billing_project_id: null,
          billing_team_id: null,
          preview_url: null,
        },
      },
      {
        id: "call-2",
        sandbox_context: {
          sandbox_record_id: "sandbox-2",
          sandbox_id: "runtime-2",
          compute_billing_source: "platform",
          billing_project_id: null,
          billing_team_id: null,
          preview_url: null,
        },
      },
    ],
    {
      callId: "call-1",
      sandboxRecordId: "sandbox-2",
    }
  );

  assert.deepEqual(result, ["call-1"]);
});

test("getExpandedCallRowIds falls back to the first matching sandbox call id", () => {
  const result = getExpandedCallRowIds(
    [
      {
        id: "call-1",
        sandbox_context: {
          sandbox_record_id: "sandbox-1",
          sandbox_id: "runtime-1",
          compute_billing_source: "platform",
          billing_project_id: null,
          billing_team_id: null,
          preview_url: null,
        },
      },
      {
        id: "call-2",
        sandbox_context: {
          sandbox_record_id: "sandbox-2",
          sandbox_id: "runtime-2",
          compute_billing_source: "platform",
          billing_project_id: null,
          billing_team_id: null,
          preview_url: null,
        },
      },
    ],
    {
      sandboxRecordId: "sandbox-2",
    }
  );

  assert.deepEqual(result, ["call-2"]);
});

test("getExpandedCallRowIds falls back to sandbox selection when an exact call id is missing", () => {
  const result = getExpandedCallRowIds(
    [
      {
        id: "call-1",
        sandbox_context: {
          sandbox_record_id: "sandbox-1",
          sandbox_id: "runtime-1",
          compute_billing_source: "platform",
          billing_project_id: null,
          billing_team_id: null,
          preview_url: null,
        },
      },
    ],
    {
      callId: "call-missing",
      sandboxRecordId: "sandbox-1",
    }
  );

  assert.deepEqual(result, ["call-1"]);
});

test("getExpandedCallRowIds returns an empty array when no exact or sandbox match exists", () => {
  const result = getExpandedCallRowIds(
    [
      {
        id: "call-1",
        sandbox_context: {
          sandbox_record_id: "sandbox-1",
          sandbox_id: "runtime-1",
          compute_billing_source: "platform",
          billing_project_id: null,
          billing_team_id: null,
          preview_url: null,
        },
      },
    ],
    {
      callId: "call-missing",
      sandboxRecordId: "sandbox-missing",
    }
  );

  assert.deepEqual(result, []);
});
