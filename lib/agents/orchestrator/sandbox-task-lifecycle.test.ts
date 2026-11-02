import type { UIMessageChunk } from "ai";
import { describe, expect, it, vi } from "vitest";
import {
  appendSandboxTaskLifecycleFooter,
  createSandboxTaskLifecycle,
  shouldRetainSandboxForRequest,
} from "./sandbox-task-lifecycle";

function createLifecycle(overrides?: {
  userText?: string;
  binding?: {
    sandboxId: string | null;
    status: "running" | "pending" | "unavailable";
  };
  state?: {
    status: string;
    persistent: boolean;
    previewUrl: string | null;
  };
  stopResult?: boolean | "active_work";
}) {
  const stop = vi.fn(async () => overrides?.stopResult ?? true);
  const binding = overrides?.binding ?? {
    sandboxId: "sandbox-1",
    status: "running" as const,
  };
  const lifecycle = createSandboxTaskLifecycle({
    userId: "user-1",
    userText: overrides?.userText ?? "run the check",
    binding,
    deps: {
      loadState: async () =>
        overrides?.state ?? {
          status: "running",
          persistent: false,
          previewUrl: null,
        },
      stop,
    },
  });
  return { binding, lifecycle, stop };
}

describe("sandbox task lifecycle", () => {
  it.each([
    ["keep the sandbox running", true],
    ["don't keep it running", false],
    ["do not leave the sandbox running", false],
    ["use a persistent session to fix the tests", false],
    ["review the follow-up work", false],
  ])("parses explicit retention intent in %j", (userText, expected) => {
    expect(shouldRetainSandboxForRequest(userText)).toBe(expected);
  });

  it.each([
    ["blocked credentials", "cat ~/.aws/credentials", false],
    ["unavailable tooling", "missing-tool --version", false],
    ["command failure", "pnpm test", false],
    ["successful one-shot", "pnpm test", true],
  ])("stops compute after %s", async (_name, command, success) => {
    const { lifecycle, stop } = createLifecycle();
    lifecycle.onToolStart({
      toolCall: { toolName: "run_command", input: { command } },
    });
    lifecycle.onToolFinish({
      toolCall: { toolName: "run_command", input: { command } },
      output: { sandboxId: "sandbox-1", exitCode: success ? 0 : 1 },
      success,
    });

    await expect(lifecycle.cleanup()).resolves.toEqual({
      state: "stopped",
      sandboxIds: ["sandbox-1"],
    });
    expect(stop).toHaveBeenCalledOnce();
  });

  it("cleans up after a stream interruption with an active sandbox tool", async () => {
    const { lifecycle, stop } = createLifecycle();
    lifecycle.onToolStart({
      toolCall: { toolName: "run_command", input: { command: "pnpm test" } },
    });

    await expect(lifecycle.cleanupAfterInterruption()).resolves.toEqual({
      state: "stopped",
      sandboxIds: ["sandbox-1"],
    });
    expect(stop).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "live preview",
      "check the preview",
      {
        status: "running",
        persistent: false,
        previewUrl: "https://preview.example",
      },
      "preview",
    ],
    [
      "explicit request",
      "keep the sandbox running for follow-up",
      { status: "running", persistent: false, previewUrl: null },
      "explicit",
    ],
  ])("preserves a %s", async (_name, userText, state, reason) => {
    const { lifecycle, stop } = createLifecycle({ userText, state });
    lifecycle.onToolStart({
      toolCall: { toolName: "run_command", input: { command: "pnpm test" } },
    });
    lifecycle.onToolFinish({
      toolCall: { toolName: "run_command", input: { command: "pnpm test" } },
      output: { sandboxId: "sandbox-1", exitCode: 0 },
      success: true,
    });

    await expect(lifecycle.cleanup()).resolves.toMatchObject({
      state: "running",
      reason,
    });
    expect(stop).not.toHaveBeenCalled();
  });

  it("does not retain an ambient preview after unrelated one-shot work", async () => {
    const { lifecycle, stop } = createLifecycle({
      state: {
        status: "running",
        persistent: false,
        previewUrl: "https://preview.example",
      },
    });
    lifecycle.onToolStart({
      toolCall: { toolName: "run_command", input: { command: "pnpm test" } },
    });
    lifecycle.onToolFinish({
      toolCall: { toolName: "run_command", input: { command: "pnpm test" } },
      output: { sandboxId: "sandbox-1", exitCode: 0 },
      success: true,
    });

    await expect(lifecycle.cleanup()).resolves.toMatchObject({
      state: "stopped",
    });
    expect(stop).toHaveBeenCalledOnce();
  });

  it.each(["run_command", "edit_file"])(
    "pauses a durable workspace after %s without adding a compute footer",
    async (toolName) => {
      const { lifecycle, binding, stop } = createLifecycle({
        userText: "fix the tests",
        state: { status: "running", persistent: true, previewUrl: null },
      });
      const toolCall = { toolName, input: { command: "pnpm test" } };
      lifecycle.onToolStart({ toolCall });
      lifecycle.onToolFinish({
        toolCall,
        output: { exitCode: 0 },
        success: true,
      });

      await expect(lifecycle.footer()).resolves.toBeNull();
      expect(stop).toHaveBeenCalledOnce();
      expect(binding.status).toBe("unavailable");
      await expect(lifecycle.cleanup()).resolves.toMatchObject({
        state: "stopped",
      });
    }
  );

  it("keeps required compute without adding routine infrastructure chatter", async () => {
    const { lifecycle, stop } = createLifecycle({
      userText: "keep the sandbox running",
      state: { status: "running", persistent: true, previewUrl: null },
    });
    lifecycle.onToolStart({ toolCall: { toolName: "run_command" } });
    lifecycle.onToolFinish({
      toolCall: { toolName: "run_command" },
      success: true,
    });
    await expect(lifecycle.cleanup()).resolves.toMatchObject({
      state: "running",
      reason: "explicit",
    });
    await expect(lifecycle.footer()).resolves.toBeNull();
    expect(stop).not.toHaveBeenCalled();
  });

  it("warns when a safe automatic stop cannot be confirmed", async () => {
    const { lifecycle, binding } = createLifecycle({ stopResult: false });
    lifecycle.onToolStart({ toolCall: { toolName: "run_command" } });
    lifecycle.onToolFinish({
      toolCall: { toolName: "run_command" },
      success: true,
    });
    await expect(lifecycle.footer()).resolves.toBe(
      "Could not confirm that sandbox compute stopped. Check its status before leaving."
    );
    expect(binding.status).toBe("running");
  });

  it("retains compute used by another active run without a warning", async () => {
    const { lifecycle, binding } = createLifecycle({
      stopResult: "active_work",
    });
    lifecycle.onToolStart({ toolCall: { toolName: "run_command" } });
    lifecycle.onToolFinish({
      toolCall: { toolName: "run_command" },
      success: true,
    });
    await expect(lifecycle.footer()).resolves.toBeNull();
    await expect(lifecycle.cleanup()).resolves.toMatchObject({
      state: "running",
      reason: "follow_up",
    });
    expect(binding.status).toBe("running");
  });

  it.each(["spawn_worktree", "spawn_subagent"])(
    "does not retain idle compute just because %s ran earlier",
    async (toolName) => {
      const { lifecycle } = createLifecycle();
      lifecycle.onToolStart({ toolCall: { toolName } });
      lifecycle.onToolFinish({
        toolCall: { toolName },
        success: true,
      });
      await expect(lifecycle.cleanup()).resolves.toMatchObject({
        state: "stopped",
      });
    }
  );

  it("does not treat starting a sandbox as a request to retain it", async () => {
    const { lifecycle, stop } = createLifecycle({
      userText: "start a sandbox and run the tests",
    });
    lifecycle.onToolStart({
      toolCall: { toolName: "run_command", input: { command: "pnpm test" } },
    });
    lifecycle.onToolFinish({
      toolCall: { toolName: "run_command", input: { command: "pnpm test" } },
      output: { sandboxId: "sandbox-1", exitCode: 0 },
      success: true,
    });

    await expect(lifecycle.cleanup()).resolves.toMatchObject({
      state: "stopped",
    });
    expect(stop).toHaveBeenCalledOnce();
  });

  it("keeps a long-running server for follow-up work", async () => {
    const { lifecycle, stop } = createLifecycle();
    lifecycle.onToolStart({
      toolCall: { toolName: "run_command", input: { command: "pnpm dev" } },
    });
    lifecycle.onToolFinish({
      toolCall: { toolName: "run_command", input: { command: "pnpm dev" } },
      output: { sandboxId: "sandbox-1", exitCode: 0 },
      success: true,
    });

    await expect(lifecycle.cleanup()).resolves.toMatchObject({
      state: "running",
      reason: "follow_up",
    });
    expect(stop).not.toHaveBeenCalled();
  });

  it("does not report a failed server start as still running", async () => {
    const { lifecycle, stop } = createLifecycle({
      state: { status: "running", persistent: false, previewUrl: null },
    });
    lifecycle.onToolStart({
      toolCall: { toolName: "run_command", input: { command: "pnpm dev" } },
    });
    lifecycle.onToolFinish({
      toolCall: { toolName: "run_command", input: { command: "pnpm dev" } },
      output: { sandboxId: "sandbox-1", exitCode: 1 },
      success: true,
    });

    await expect(lifecycle.cleanup()).resolves.toMatchObject({
      state: "stopped",
    });
    expect(stop).toHaveBeenCalledOnce();
  });

  it("waits for in-flight provisioning before cancellation cleanup", async () => {
    const { binding, lifecycle, stop } = createLifecycle({
      binding: { sandboxId: null, status: "unavailable" },
    });
    lifecycle.onToolStart({
      toolCall: { toolName: "run_command", input: { command: "pnpm test" } },
    });
    const cleanup = lifecycle.cleanup();
    await Promise.resolve();
    expect(stop).not.toHaveBeenCalled();

    binding.sandboxId = "sandbox-1";
    binding.status = "running";
    lifecycle.onToolFinish({
      toolCall: { toolName: "run_command", input: { command: "pnpm test" } },
      output: { sandboxId: "sandbox-1", exitCode: 0 },
      success: true,
    });

    await expect(cleanup).resolves.toMatchObject({
      state: "stopped",
      sandboxIds: ["sandbox-1"],
    });
    expect(stop).toHaveBeenCalledOnce();
  });

  it("does not trust a rejected model-supplied sandbox ID", async () => {
    const { lifecycle, stop } = createLifecycle({
      binding: { sandboxId: null, status: "unavailable" },
    });
    lifecycle.onToolStart({
      toolCall: {
        toolName: "sandbox_stop",
        input: { sandboxId: "sandbox-untrusted" },
      },
    });
    lifecycle.onToolFinish({
      toolCall: {
        toolName: "sandbox_stop",
        input: { sandboxId: "sandbox-untrusted" },
      },
      output: { error: "Sandbox mismatch", reason: "sandbox_mismatch" },
      success: true,
    });

    await expect(lifecycle.cleanup()).resolves.toEqual({ state: "unused" });
    expect(stop).not.toHaveBeenCalled();
  });

  it("appends an actionable lifecycle warning before the stream finish", async () => {
    const source = new ReadableStream<UIMessageChunk>({
      start(controller) {
        controller.enqueue({ type: "start" });
        controller.enqueue({ type: "finish", finishReason: "stop" });
        controller.close();
      },
    });
    const chunks: UIMessageChunk[] = [];
    const reader = appendSandboxTaskLifecycleFooter(source, {
      footer: async () =>
        "Could not confirm that sandbox compute stopped. Check its status before leaving.",
      textPartId: "lifecycle-status",
    }).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "start",
      "text-start",
      "text-delta",
      "text-end",
      "finish",
    ]);
    expect(chunks[2]).toMatchObject({
      delta:
        "\n\nCould not confirm that sandbox compute stopped. Check its status before leaving.",
    });
  });
});
