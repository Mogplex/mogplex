import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { useSandboxChanges } from "../../components/sandbox-changes/use-sandbox-changes";
import type { SandboxChanges } from "../../lib/sandbox/changes";

const dirty = (branch: string): SandboxChanges => ({
  branch,
  baseBranch: "main",
  ahead: 0,
  behind: 0,
  files: [
    { path: `${branch}.ts`, status: "modified", additions: 1, deletions: 0 },
  ],
});

test("sandbox changes isolate pending status, failed status, and late mutations across switches", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const pending: Array<{
    url: string;
    init?: RequestInit;
    resolve: (value: Response) => void;
  }> = [];
  const values = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: (url: string, init?: RequestInit) =>
      new Promise<Response>((resolve) => pending.push({ url, init, resolve })),
  };
  const descriptors = Object.getOwnPropertyDescriptors(globalThis);
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  const { renderHook, act } = await import("@testing-library/react");
  const view = renderHook(
    ({ sandboxId }: { sandboxId: string | null }) =>
      useSandboxChanges({ sandboxId, refreshToken: 0 }),
    { initialProps: { sandboxId: "a" as string | null } }
  );
  const respond = async (body: unknown, status = 200) => {
    const request = pending.shift();
    assert.ok(request);
    await act(async () => request.resolve(Response.json(body, { status })));
    return request;
  };
  const getChanges = () => view.result.current.changes;
  try {
    await respond(dirty("a"));
    assert.equal(getChanges()?.branch, "a");
    view.rerender({ sandboxId: "b" });
    assert.equal(getChanges(), null);
    assert.equal(view.result.current.loading, true);
    await act(async () =>
      assert.equal(await view.result.current.revert(["a.ts"]), false)
    );
    assert.equal(pending.length, 1);
    await respond({ error: "status unavailable" }, 503);
    assert.equal(getChanges(), null);
    assert.equal(view.result.current.error, "status unavailable");
    await act(async () =>
      assert.equal(
        await view.result.current.commit({
          message: "stale",
          push: false,
          openPullRequest: false,
        }),
        null
      )
    );
    assert.equal(pending.length, 0);

    view.rerender({ sandboxId: "c" });
    await respond(dirty("c"));
    let mutation: Promise<boolean>;
    act(() => {
      mutation = view.result.current.revert(["c.ts"]);
    });
    const oldPost = pending.shift();
    assert.equal(oldPost?.init?.method, "POST");
    view.rerender({ sandboxId: "d" });
    await respond(dirty("d"));
    let currentMutation: Promise<boolean>;
    act(() => {
      currentMutation = view.result.current.revert(["d.ts"]);
    });
    await act(async () => {
      oldPost!.resolve(Response.json({ changes: dirty("c") }));
      assert.equal(await mutation, false);
    });
    assert.equal(getChanges()?.branch, "d");
    assert.equal(view.result.current.busy, true);
    await respond({ changes: dirty("d") });
    assert.equal(await currentMutation!, true);
    assert.equal(view.result.current.busy, false);

    view.rerender({ sandboxId: "e" });
    const oldGet = pending.shift();
    view.rerender({ sandboxId: null });
    await act(async () => oldGet!.resolve(Response.json(dirty("e"))));
    assert.equal(getChanges(), null);
    assert.equal(view.result.current.loading, false);
    assert.equal(view.result.current.error, null);

    // The sandbox can change after headers arrive but before JSON finishes.
    view.rerender({ sandboxId: "f" });
    let releaseBody!: (value: SandboxChanges) => void;
    const response = new Response();
    response.json = () =>
      new Promise<SandboxChanges>((resolve) => {
        releaseBody = resolve;
      });
    await act(async () => pending.shift()!.resolve(response));
    view.rerender({ sandboxId: "g" });
    await respond(dirty("g"));
    await act(async () => releaseBody(dirty("f")));
    assert.equal(getChanges()?.branch, "g");
  } finally {
    view.unmount();
    dom.window.close();
    for (const key of Object.keys(values)) {
      if (descriptors[key])
        Object.defineProperty(globalThis, key, descriptors[key]);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
