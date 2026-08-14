import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSandboxRecord,
  loadSandboxStore,
} from "./helpers/sandbox-launch-response-fixtures";

test("background sandbox refresh keeps existing state when fetch rejects", async () => {
  const { useSandboxStore } = await loadSandboxStore();
  const originalFetch = globalThis.fetch;
  const initialState = useSandboxStore.getState();
  let fetchCalls = 0;
  const existing = buildSandboxRecord({
    id: "sandbox-existing",
    repo_id: "repo-1",
    sandbox_id: "vm-existing",
    status: "running",
  });

  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;
  useSandboxStore.setState({
    sandboxes: {},
    sandboxesById: {},
    sandboxIdsByRepoId: {},
    activeSandboxId: null,
  });
  useSandboxStore.getState().setSandboxRecord(existing);
  const storedBeforeRefresh =
    useSandboxStore.getState().sandboxesById[existing.id];

  try {
    assert.equal(await useSandboxStore.getState().refresh(), false);
    assert.equal(
      useSandboxStore.getState().sandboxesById[existing.id],
      storedBeforeRefresh
    );
    assert.equal(useSandboxStore.getState().activeSandboxId, existing.id);
    assert.equal(fetchCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    useSandboxStore.setState(initialState, true);
  }
});

for (const testCase of [
  {
    name: "the inventory endpoint returns a non-OK response",
    response: () => new Response("Server error", { status: 500 }),
  },
  {
    name: "the inventory endpoint returns malformed JSON",
    response: () => new Response("not json", { status: 200 }),
  },
]) {
  test(`background sandbox refresh keeps existing state when ${testCase.name}`, async () => {
    const { useSandboxStore } = await loadSandboxStore();
    const originalFetch = globalThis.fetch;
    const initialState = useSandboxStore.getState();
    const existing = buildSandboxRecord({
      id: "sandbox-existing",
      repo_id: "repo-1",
      sandbox_id: "vm-existing",
      status: "running",
    });

    globalThis.fetch = (async () => testCase.response()) as typeof fetch;
    useSandboxStore.setState({
      sandboxes: {},
      sandboxesById: {},
      sandboxIdsByRepoId: {},
      activeSandboxId: null,
    });
    useSandboxStore.getState().setSandboxRecord(existing);
    const storedBeforeRefresh =
      useSandboxStore.getState().sandboxesById[existing.id];

    try {
      assert.equal(await useSandboxStore.getState().refresh(), false);
      assert.equal(
        useSandboxStore.getState().sandboxesById[existing.id],
        storedBeforeRefresh
      );
      assert.equal(useSandboxStore.getState().activeSandboxId, existing.id);
    } finally {
      globalThis.fetch = originalFetch;
      useSandboxStore.setState(initialState, true);
    }
  });
}
