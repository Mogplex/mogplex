import { expect, test } from "@playwright/test";
import type { UIMessageChunk } from "ai";
import {
  appendSandboxTaskLifecycleFooter,
  createSandboxTaskLifecycle,
} from "@/lib/agents/orchestrator/sandbox-task-lifecycle";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  mockBaseChrome,
  mockControlSessionBootstrap,
} from "./helpers/automation-control-plane-fixtures";

for (const stopResult of [true, "activity_unknown"] as const) {
  const outcome =
    stopResult === true
      ? "paused compute without routine chatter"
      : "an unavailable activity check";
  test(`completed task cleanup reports ${outcome}`, async ({ page }) => {
    await enableScopedE2EAuth(page);
    await mockBaseChrome(page);
    await mockControlSessionBootstrap(page);
    const binding = {
      sandboxId: "sandbox-1" as string | null,
      status: "running" as "running" | "pending" | "unavailable",
    };
    await page.route("**/api/control/chat", async (route) => {
      const lifecycle = createSandboxTaskLifecycle({
        userId: "user-1",
        aiCallId: "current-call",
        userText: "Run the checks",
        binding,
        deps: {
          loadState: async () => ({
            status: "running",
            previewUrl: null,
          }),
          stop: async () => stopResult,
        },
      });
      const toolCall = {
        toolName: "run_command",
        input: { command: "pnpm typecheck" },
      };
      lifecycle.onToolStart({ toolCall });
      lifecycle.onToolFinish({
        toolCall,
        output: { sandboxId: "sandbox-1", exitCode: 0 },
        success: true,
      });
      const source = new ReadableStream<UIMessageChunk>({
        start(controller) {
          for (const chunk of [
            { type: "start", messageId: "reply" },
            { type: "text-start", id: "text" },
            { type: "text-delta", id: "text", delta: "Typecheck passed." },
            { type: "text-end", id: "text" },
            { type: "finish", finishReason: "stop" },
          ] as UIMessageChunk[])
            controller.enqueue(chunk);
          controller.close();
        },
      });
      const reader = appendSandboxTaskLifecycleFooter(source, {
        footer: lifecycle.footer,
        textPartId: "lifecycle",
      }).getReader();
      const chunks: UIMessageChunk[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      await route.fulfill({
        headers: {
          "content-type": "text/event-stream",
          "x-vercel-ai-ui-message-stream": "v1",
        },
        body:
          chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
          "data: [DONE]\n\n",
      });
    });
    await page.goto(scopedPath("control"));
    await page
      .getByPlaceholder("Ask anything or run a command...")
      .fill("Run the checks");
    await page.getByRole("button", { name: "Start mission" }).click();
    const transcript = page.getByRole("log", { name: "Conversation" });
    await expect(transcript).toContainText("Typecheck passed.");
    await expect(transcript).not.toContainText("Compute:");
    expect(binding.status).toBe(
      stopResult === true ? "unavailable" : "running"
    );
    if (stopResult === "activity_unknown") {
      await expect(transcript).toContainText(
        "Compute was left running because active work could not be checked."
      );
      await expect(transcript).not.toContainText("Could not confirm");
    }
  });
}
