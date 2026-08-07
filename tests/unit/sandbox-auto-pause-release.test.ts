import assert from "node:assert/strict";
import test from "node:test";
import {
  createReleaseRpcClient,
  loadAutoPauseModule,
  sandboxRecordId,
} from "./helpers/sandbox-auto-pause-fixtures";

test("active AI-call metadata filter covers chat and sandbox-record keys", async () => {
  const { buildActiveAiCallSandboxMetadataFilter } =
    await loadAutoPauseModule();

  assert.equal(
    buildActiveAiCallSandboxMetadataFilter(sandboxRecordId, "vm_123"),
    `metadata->>sandbox_record_id.eq.${sandboxRecordId},metadata->>sandbox_id.eq.${sandboxRecordId},metadata->>sandbox_id.eq.vm_123`
  );
});

test("active AI-call metadata filter rejects non-UUID ids", async () => {
  const { buildActiveAiCallSandboxMetadataFilter } =
    await loadAutoPauseModule();

  assert.throws(
    () => buildActiveAiCallSandboxMetadataFilter("sandbox-record-1"),
    /sandboxRecordId must be a UUID/
  );
  assert.throws(
    () => buildActiveAiCallSandboxMetadataFilter(sandboxRecordId, "vm 123"),
    /sandboxId has unsupported metadata filter characters/
  );
});

test("recordSandboxClientRelease issues fresh release events per applied release and reuses retry ids", async () => {
  const { state, client } = createReleaseRpcClient({
    rpcResults: [
      {
        session_row_id: "presence-row-1",
        applied: true,
        should_queue: true,
        released_at: "2026-05-20T12:00:00.000Z",
        release_event_id: "event-release-1",
      },
      {
        session_row_id: "presence-row-1",
        applied: false,
        should_queue: true,
        released_at: "2026-05-20T12:00:00.000Z",
        release_event_id: "event-release-1",
      },
      {
        session_row_id: "presence-row-1",
        applied: true,
        should_queue: true,
        released_at: "2026-05-20T12:02:00.000Z",
        release_event_id: "event-release-2",
      },
    ],
  });
  const { recordSandboxClientRelease } = await loadAutoPauseModule();
  const baseInput = {
    sandboxRecordId,
    sandboxId: "vm_123",
    userId: "user-1",
    tabId: "tab-1",
    sessionId: "session-1",
    releaseReason: "pagehide",
  };

  const firstRelease = await recordSandboxClientRelease(
    {
      ...baseInput,
      eventSeq: 2,
    },
    client
  );
  const duplicateRetry = await recordSandboxClientRelease(
    {
      ...baseInput,
      eventSeq: 2,
    },
    client
  );
  const secondRelease = await recordSandboxClientRelease(
    {
      ...baseInput,
      eventSeq: 4,
    },
    client
  );

  assert.equal(firstRelease.released, true);
  assert.equal(firstRelease.shouldQueue, true);
  assert.equal(firstRelease.releaseEventId, "event-release-1");
  assert.equal(duplicateRetry.released, false);
  assert.equal(duplicateRetry.shouldQueue, true);
  assert.equal(duplicateRetry.releaseEventId, "event-release-1");
  assert.equal(secondRelease.released, true);
  assert.equal(secondRelease.shouldQueue, true);
  assert.equal(secondRelease.releaseEventId, "event-release-2");
  assert.notEqual(firstRelease.releaseEventId, secondRelease.releaseEventId);
  assert.deepEqual(
    state.rpcCalls.map((call) => call.name),
    [
      "record_sandbox_client_release_event",
      "record_sandbox_client_release_event",
      "record_sandbox_client_release_event",
    ]
  );
});

test("recordSandboxClientRelease treats duplicate non-queued releases as no-ops", async () => {
  const { state, client } = createReleaseRpcClient({
    rpcResults: [
      {
        session_row_id: "presence-row-1",
        applied: false,
        should_queue: false,
        released_at: "2026-05-20T12:00:00.000Z",
        release_event_id: "event-release-1",
      },
    ],
  });
  const { recordSandboxClientRelease } = await loadAutoPauseModule();

  const duplicateRelease = await recordSandboxClientRelease(
    {
      sandboxRecordId,
      sandboxId: "vm_123",
      userId: "user-1",
      tabId: "tab-1",
      sessionId: "session-1",
      eventSeq: 2,
      releaseReason: "pagehide",
    },
    client
  );

  assert.deepEqual(duplicateRelease, {
    released: false,
    sessionRowId: "presence-row-1",
    releasedAt: "2026-05-20T12:00:00.000Z",
    releaseEventId: "event-release-1",
    shouldQueue: false,
  });
  assert.deepEqual(
    state.rpcCalls.map((call) => call.name),
    ["record_sandbox_client_release_event"]
  );
});
