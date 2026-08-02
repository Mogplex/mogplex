import assert from "node:assert/strict";
import test from "node:test";
import { Sandbox } from "@vercel/sandbox";
import { checkSandboxHealth } from "@/lib/sandbox/health-status";

function setSandboxGet(nextGet: typeof Sandbox.get) {
  Object.defineProperty(Sandbox, "get", {
    value: nextGet,
    configurable: true,
    writable: true,
  });
}

test("checkSandboxHealth falls back to the preview probe when Vercel lookup fails transiently", async () => {
  const originalGet = Sandbox.get;
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const warnings: unknown[][] = [];

  try {
    console.warn = (...args) => {
      warnings.push(args);
    };
    setSandboxGet(async () => {
      throw new Error("temporary Vercel lookup failure");
    });
    globalThis.fetch = async () =>
      new Response("<html>ready</html>", { status: 200 });

    const result = await checkSandboxHealth("https://preview.example.com", {
      sandboxId: "vm_123",
      token: "platform-token",
      projectId: "project-1",
    });

    assert.equal(result.status, "running");
    assert.equal(result.message, "Sandbox and dev server are running");
    assert.equal(result.statusCode, undefined);
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = originalWarn;
    globalThis.fetch = originalFetch;
    setSandboxGet(originalGet);
  }
});
