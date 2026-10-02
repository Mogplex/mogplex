import assert from "node:assert/strict";
import { test } from "vitest";
import { wrapControlSideEffects } from "./tool-idempotency";
import {
  callTool,
  createMemoryStore,
  executableTool,
} from "../../tests/unit/helpers/slack-tool-idempotency-fixtures";

for (const name of ["open_pr", "git_push", "deploy"]) {
  test(`${name} executes identical inputs once and durably replays across wrappers`, async () => {
    const { store } = createMemoryStore();
    let calls = 0;
    const tools = {
      [name]: executableTool(() => ({ ok: true, result: ++calls })),
    };
    const context = { userId: "owner", aiCallId: "turn-1" };
    const first = wrapControlSideEffects(tools, context, store);
    assert.deepEqual(
      await callTool(first, name, { title: "Fix", branch: "topic" }),
      { ok: true, result: 1 }
    );
    assert.deepEqual(
      await callTool(first, name, { branch: "topic", title: "Fix" }),
      { ok: true, result: 1 }
    );
    const retry = wrapControlSideEffects(tools, context, store);
    assert.deepEqual(
      await callTool(retry, name, { title: "Fix", branch: "topic" }),
      { ok: true, result: 1 }
    );
    assert.equal(calls, 1);
    await callTool(retry, name, { title: "Another", branch: "topic" });
    await callTool(
      wrapControlSideEffects(tools, { ...context, aiCallId: "turn-2" }, store),
      name,
      { title: "Fix", branch: "topic" }
    );
    assert.equal(calls, 3);
  });
}

test("parallel copies suppress an uncertain in-flight action without executing it", async () => {
  const { store } = createMemoryStore();
  let calls = 0;
  let complete: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const tools = {
    open_pr: executableTool(async () => {
      calls++;
      await pending;
      return { ok: true };
    }),
  };
  const context = { userId: "owner", aiCallId: "turn-1" };
  const first = callTool(
    wrapControlSideEffects(tools, context, store),
    "open_pr"
  );
  const second = callTool(
    wrapControlSideEffects(tools, context, store),
    "open_pr"
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  complete?.();
  await first;
  assert.equal(calls, 1);
  assert.deepEqual(await second, {
    ok: false,
    deduplicated: true,
    error: "This turn already attempted this action. Control did not retry it.",
  });
});

test("uncertain failures are not retried and ledger outages fail before external writes", async () => {
  const { store } = createMemoryStore();
  let calls = 0;
  const context = { userId: "owner", aiCallId: "turn-1" };
  const tools = {
    open_pr: executableTool(() => {
      calls++;
      throw new Error("response lost");
    }),
  };
  await assert.rejects(
    callTool(wrapControlSideEffects(tools, context, store), "open_pr"),
    /response lost/
  );
  const result = (await callTool(
    wrapControlSideEffects(tools, context, store),
    "open_pr"
  )) as { deduplicated: boolean };
  assert.equal(result.deduplicated, true);
  assert.equal(calls, 1);
  const unavailable = {
    ...store,
    reserve: async () => {
      throw new Error("ledger unavailable");
    },
  };
  await assert.rejects(
    callTool(
      wrapControlSideEffects(
        tools,
        { ...context, aiCallId: "turn-2" },
        unavailable
      ),
      "open_pr"
    ),
    /ledger unavailable/
  );
  assert.equal(calls, 1);
});

test("read and command tools remain repeatable", async () => {
  const { store, records } = createMemoryStore();
  let calls = 0;
  const tools = wrapControlSideEffects(
    {
      list_worktrees: executableTool(() => ++calls),
      run_command: executableTool(() => ++calls),
    },
    { userId: "owner", aiCallId: "turn" },
    store
  );
  await callTool(tools, "list_worktrees");
  await callTool(tools, "list_worktrees");
  await callTool(tools, "run_command");
  await callTool(tools, "run_command");
  assert.equal(calls, 4);
  assert.equal(records.size, 0);
});

test("a missing turn cannot execute a protected tool", async () => {
  const { store, records } = createMemoryStore();
  let calls = 0;
  await assert.rejects(
    callTool(
      wrapControlSideEffects(
        { deploy: executableTool(() => ++calls) },
        { userId: "owner" },
        store
      ),
      "deploy"
    ),
    /active coordinator turn/
  );
  assert.equal(calls, 0);
  assert.equal(records.size, 0);
});

test("a lost completion write preserves the first result and prevents another external attempt", async () => {
  const { store } = createMemoryStore();
  const unavailable = {
    ...store,
    complete: async () => {
      throw new Error("completion unavailable");
    },
  };
  let calls = 0;
  const tools = {
    deploy: executableTool(() => ({ ok: true, deployment: ++calls })),
  };
  const context = { userId: "owner", aiCallId: "turn" };
  assert.deepEqual(
    await callTool(
      wrapControlSideEffects(tools, context, unavailable),
      "deploy"
    ),
    { ok: true, deployment: 1 }
  );
  assert.equal(
    (
      (await callTool(
        wrapControlSideEffects(tools, context, store),
        "deploy"
      )) as { deduplicated: boolean }
    ).deduplicated,
    true
  );
  assert.equal(calls, 1);
});
