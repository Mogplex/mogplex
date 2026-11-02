import { expect, it } from "vitest";
import {
  createSandboxTaskLifecycle,
  type SandboxTaskLifecycleDeps,
} from "./sandbox-task-lifecycle";

it.each([false, true])(
  "keeps every actionable cleanup warning regardless of sandbox order (reversed=%s)",
  async (reversed) => {
    const results = new Map<
      string,
      Awaited<ReturnType<SandboxTaskLifecycleDeps["stop"]>>
    >([
      ["unknown", false],
      ["unsaved", "unsaved_work"],
      ["another-unsaved", "unsaved_work"],
      ["inspection", "inspection_unavailable"],
      ["busy", "active_work"],
    ]);
    const lifecycle = createSandboxTaskLifecycle({
      userId: "user-1",
      aiCallId: "current-call",
      userText: "fix the tests",
      binding: { sandboxId: null, status: "unavailable" },
      deps: {
        loadState: async () => ({
          status: "running",
          previewUrl: null,
        }),
        stop: async (id) => results.get(id) ?? false,
      },
    });
    const ids = [...results.keys()];
    for (const sandboxId of reversed ? ids.reverse() : ids) {
      const toolCall = { toolName: "edit_file" };
      lifecycle.onToolStart({ toolCall });
      lifecycle.onToolFinish({
        toolCall,
        output: { sandboxId },
        success: true,
      });
    }
    const footer = await lifecycle.footer();
    expect(footer).toBe(
      [
        "This workspace cannot preserve uncommitted changes when stopped. Commit and push the changes before stopping compute.",
        "Could not check for unsaved changes. Compute was left running to protect your work. Review its changes before stopping it.",
        "Could not confirm that sandbox compute stopped. Check its status before leaving.",
      ].join("\n\n")
    );
    await expect(lifecycle.cleanup()).resolves.toMatchObject({
      state: "running",
      reason: "unsaved_work",
    });
  }
);
