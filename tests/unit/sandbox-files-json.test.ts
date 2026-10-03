import assert from "node:assert/strict";
import test from "node:test";

test("PUT sandbox files returns 400 for malformed JSON before writing a file", async () => {
  const { createSandboxFilePutHandler } =
    await import("../../app/api/sandbox/[id]/files/route");
  const handler = createSandboxFilePutHandler({
    loadOwnedSandboxRouteContext: async () => {
      throw new Error("must not access sandbox");
    },
    renewSandboxActivityLease: async () => {
      throw new Error("must not renew lease");
    },
    touchSandboxLastActive: async () => {
      throw new Error("must not write");
    },
    withSandboxMutationLock: async () => {
      throw new Error("must not acquire lock");
    },
  });
  for (const body of ['{"path":', ""]) {
    const response = await handler(
      new Request("http://localhost/api/sandbox/id/files", {
        method: "PUT",
        body,
      }),
      { params: Promise.resolve({ id: "id" }) }
    );
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Invalid JSON body." });
  }
});
