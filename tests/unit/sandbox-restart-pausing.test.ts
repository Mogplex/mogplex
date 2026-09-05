import assert from "node:assert/strict";
import test from "node:test";
import { loadSandboxRestartRouteModule } from "./sandbox-record-route-test-harness/loaders";
import { buildLoadedSandboxDetailRecord } from "./sandbox-record-route-test-harness/record-builders";
import { buildLoadedPersistentRestartContext } from "./helpers/sandbox-restart-route-fixtures";
import {
  buildSandboxRouteParams,
  buildSandboxRouteRequest,
} from "./sandbox-record-route-test-harness";

for (const persistent of [true, false]) {
  test(`restart rejects an in-flight pause before provider work (persistent=${persistent})`, async () => {
    const { createSandboxRestartHandler } =
      await loadSandboxRestartRouteModule();
    let loadedContext = false;
    const handler = createSandboxRestartHandler({
      loadOwnedSandboxRouteRecord: (async () =>
        buildLoadedSandboxDetailRecord({
          status: "pausing",
          persistent,
        })) as never,
      loadOwnedSandboxRouteContext: (async () => {
        loadedContext = true;
        return buildLoadedPersistentRestartContext({ status: "pausing" });
      }) as never,
      resolveLoadedSandboxRouteContext: async () => {
        throw new Error("must not resolve legacy restart");
      },
      getSandbox: async () => {
        throw new Error("must not reach provider");
      },
      enforceSandboxBootLimits: async () => {
        throw new Error("must not admit restart");
      },
    });
    const response = await handler(
      buildSandboxRouteRequest({ method: "POST", suffix: "/restart" }),
      buildSandboxRouteParams()
    );
    assert.equal(response.status, 409);
    assert.equal(loadedContext, false);
  });
}
