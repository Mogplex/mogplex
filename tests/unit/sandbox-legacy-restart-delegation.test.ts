import assert from "node:assert/strict";
import test from "node:test";
import { buildLoadedSandboxRestartRecord } from "./sandbox-record-route-test-harness/record-builders";
import { loadSandboxRestartRouteModule } from "./sandbox-record-route-test-harness/loaders";
import {
  buildResolvedSandboxRouteContext,
  buildSandboxRouteParams,
} from "./sandbox-record-route-test-harness";

const TEAM_ID = "00000000-0000-4000-8000-000000000456";

for (const [host, root, savedTeam, requestedTeam] of [
  ["mogplex.internal", "apps/web", TEAM_ID, TEAM_ID],
  ["internal.mogplex", null, TEAM_ID, null],
  ["spoofed.example", "apps/web", null, TEAM_ID],
  ["browser.example", null, TEAM_ID, "00000000-0000-4000-8000-000000000999"],
] as const) {
  test(`legacy restart from ${host} preserves saved scope and root at the configured app origin`, async () => {
    const previousUrl = process.env.APP_URL;
    process.env.APP_URL = "https://configured-app.example";
    const { createSandboxRestartHandler } =
      await loadSandboxRestartRouteModule();
    const captured: Array<{
      url: string;
      headers: Headers;
      body: Record<string, unknown>;
    }> = [];
    const snapshotOptions: unknown[] = [];
    const saved = buildLoadedSandboxRestartRecord();
    const handler = createSandboxRestartHandler({
      loadOwnedSandboxRouteRecord: (async () => ({
        ...saved,
        record: { ...saved.record, product_team_id: savedTeam },
        rootDirectory: root,
      })) as never,
      resolveLoadedSandboxRouteContext: async (loaded) =>
        buildResolvedSandboxRouteContext(loaded) as never,
      getSandbox: async () =>
        ({
          snapshot: async (options: unknown) => {
            snapshotOptions.push(options);
            return { snapshotId: "saved-snapshot" };
          },
        }) as never,
      stopSandboxRecord: async () => ({ id: "sandbox-1" }) as never,
      updateSandboxRecord: async () => ({ id: "sandbox-1" }) as never,
      fetchImpl: async (input, init) => {
        captured.push({
          url: String(input),
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)),
        });
        return Response.json({ sandbox: { id: "restored-workspace" } });
      },
    });
    try {
      const response = await handler(
        new Request(`https://${host}/api/sandbox`, {
          method: "POST",
          headers: {
            authorization: "Bearer internal-test-secret",
            "x-delegated-user-id": "user-1",
            ...(requestedTeam ? { "x-mogplex-team-id": requestedTeam } : {}),
          },
        }),
        buildSandboxRouteParams()
      );
      assert.equal(response.status, 200);
      assert.equal(captured.length, 1);
      assert.equal(
        captured[0]?.url,
        "https://configured-app.example/api/sandbox"
      );
      assert.equal(captured[0]?.headers.get("x-mogplex-team-id"), savedTeam);
      assert.equal(captured[0]?.headers.get("x-delegated-user-id"), "user-1");
      assert.equal(
        captured[0]?.headers.get("authorization"),
        "Bearer internal-test-secret"
      );
      assert.equal(captured[0]?.body.rootDirectory, root);
      assert.equal(captured[0]?.body.restoreSnapshotId, "saved-snapshot");
      assert.deepEqual(snapshotOptions, [{ expiration: 0 }]);
    } finally {
      if (previousUrl === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = previousUrl;
    }
  });
}

test("missing app URL configuration returns a safe 503 before touching the saved workspace", async () => {
  const names = ["APP_URL", "NEXT_PUBLIC_APP_URL", "VERCEL_URL"];
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  const originalError = console.error;
  const diagnostics: unknown[] = [];
  console.error = (...args) => diagnostics.push(args);
  try {
    const { createSandboxRestartHandler } =
      await loadSandboxRestartRouteModule();
    let sideEffects = 0;
    const handler = createSandboxRestartHandler({
      loadOwnedSandboxRouteRecord: (async () =>
        buildLoadedSandboxRestartRecord()) as never,
      getSandbox: async () => {
        sideEffects++;
        throw new Error("Must not touch a VM");
      },
      stopSandboxRecord: async () => {
        sideEffects++;
        return { id: "sandbox-1" } as never;
      },
      fetchImpl: async () => {
        sideEffects++;
        return Response.json({});
      },
    });
    const response = await handler(
      new Request("https://mogplex.internal/api/sandbox", { method: "POST" }),
      buildSandboxRouteParams()
    );
    assert.equal(response.status, 503);
    assert.doesNotMatch((await response.json()).error, /APP_URL|VERCEL_URL/);
    assert.equal(sideEffects, 0);
    assert.match(JSON.stringify(diagnostics), /APP_URL/);
  } finally {
    console.error = originalError;
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("ownership changes between legacy authorization reads return conflict before provider operations", async () => {
  const previousUrl = process.env.APP_URL;
  process.env.APP_URL = "https://configured-app.example";
  try {
    const { createSandboxRestartHandler } =
      await loadSandboxRestartRouteModule();
    const saved = buildLoadedSandboxRestartRecord();
    let fullReads = 0;
    let sideEffects = 0;
    const handler = createSandboxRestartHandler({
      loadOwnedSandboxRouteRecord: (async (
        _request: Request,
        _id: string,
        options: { select: string }
      ) => {
        if (options.select.includes("product_team_id")) fullReads++;
        return {
          ...saved,
          record: {
            ...saved.record,
            product_team_id:
              fullReads > 1 ? "00000000-0000-4000-8000-000000000999" : TEAM_ID,
          },
        };
      }) as never,
      getSandbox: async () => {
        sideEffects++;
        throw new Error("Must not touch a VM");
      },
      stopSandboxRecord: async () => {
        sideEffects++;
        return { id: "sandbox-1" } as never;
      },
      fetchImpl: async () => {
        sideEffects++;
        return Response.json({});
      },
    });
    const response = await handler(
      new Request("https://browser.example/api/sandbox", { method: "POST" }),
      buildSandboxRouteParams()
    );
    assert.equal(response.status, 409);
    assert.match(await response.text(), /Workspace access changed/);
    assert.equal(sideEffects, 0);
  } finally {
    if (previousUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previousUrl;
  }
});

for (const failure of ["provider", "snapshot", "metadata", "record"] as const) {
  test(`legacy ${failure} failure never stops or replaces saved work`, async () => {
    const { createSandboxRestartHandler } =
      await loadSandboxRestartRouteModule();
    let providerStops = 0;
    let recordStops = 0;
    let launches = 0;
    const handler = createSandboxRestartHandler({
      loadOwnedSandboxRouteRecord: (async () =>
        buildLoadedSandboxRestartRecord()) as never,
      resolveLoadedSandboxRouteContext: async (loaded) =>
        buildResolvedSandboxRouteContext(loaded) as never,
      getSandbox: async () => {
        if (failure === "provider")
          throw Object.assign(new Error("Provider disappeared"), {
            status: 404,
          });
        return {
          snapshot: async () => {
            if (failure === "snapshot") throw new Error("Snapshot unavailable");
            return { snapshotId: "saved-snapshot" };
          },
          stop: async () => {
            providerStops++;
          },
        } as never;
      },
      updateSandboxRecord: async () =>
        (failure === "metadata" ? null : { id: "sandbox-1" }) as never,
      stopSandboxRecord: async () => {
        recordStops++;
        return (failure === "record" ? null : { id: "sandbox-1" }) as never;
      },
      fetchImpl: async () => {
        launches++;
        return Response.json({});
      },
    });
    const response = await handler(
      new Request("https://browser.example/api/sandbox", { method: "POST" }),
      buildSandboxRouteParams()
    );
    assert.equal(response.status, failure === "metadata" ? 503 : 409);
    assert.equal(providerStops, 0);
    assert.equal(recordStops, failure === "record" ? 1 : 0);
    assert.equal(launches, 0);
  });
}

test("snapshot metadata never overwrites a concurrently replaced provider record", async () => {
  const previousBackend = process.env.MOGPLEX_DATA_BACKEND;
  process.env.MOGPLEX_DATA_BACKEND = "supabase";
  const originalFetch = globalThis.fetch;
  let metadataWrites = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(init?.method, "PATCH");
    assert.equal(url.pathname, "/rest/v1/sandboxes");
    if (url.searchParams.get("sandbox_id") === "eq.vm_123")
      return Response.json(null);
    metadataWrites++;
    return Response.json({ id: "sandbox-1", sandbox_id: "replacement-vm" });
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    const { createSandboxRestartHandler } =
      await loadSandboxRestartRouteModule();
    let launches = 0;
    const handler = createSandboxRestartHandler({
      loadOwnedSandboxRouteRecord: (async () =>
        buildLoadedSandboxRestartRecord()) as never,
      resolveLoadedSandboxRouteContext: async (loaded) =>
        buildResolvedSandboxRouteContext(loaded) as never,
      getSandbox: async () =>
        ({
          snapshot: async () => ({ snapshotId: "old-vm-snapshot" }),
        }) as never,
      stopSandboxRecord: async () => ({ id: "sandbox-1" }) as never,
      fetchImpl: async () => {
        launches++;
        return Response.json({});
      },
    });
    const response = await handler(
      new Request("https://browser.example/api/sandbox", { method: "POST" }),
      buildSandboxRouteParams()
    );
    assert.equal(response.status, 503);
    assert.equal(metadataWrites, 0);
    assert.equal(launches, 0);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    if (previousBackend === undefined) delete process.env.MOGPLEX_DATA_BACKEND;
    else process.env.MOGPLEX_DATA_BACKEND = previousBackend;
  }
});
