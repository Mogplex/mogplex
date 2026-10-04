import assert from "node:assert/strict";
import test from "node:test";
import { createElement, Fragment } from "react";
import type { QueueItemActionProps } from "../../components/ai-elements/queue";
import { installControlHookDom } from "../support/control-hook-dom";

test("icon actions have useful default names and preserve caller overrides", async () => {
  const restore = installControlHookDom();
  const [testing, code, terminal, commit, stack, env, conversation] =
    await Promise.all([
      import("@testing-library/react"),
      import("../../components/ai-elements/code-block"),
      import("../../components/ai-elements/terminal"),
      import("../../components/ai-elements/commit"),
      import("../../components/ai-elements/stack-trace"),
      import("../../components/ai-elements/environment-variables"),
      import("../../components/ai-elements/conversation"),
    ]);
  const { QueueItemAction } =
    await import("../../components/ai-elements/queue");
  // @ts-expect-error An icon-only action must supply its specific action name.
  const unnamedAction: QueueItemActionProps = {};
  void unnamedAction;
  let clears = 0;
  const view = testing.render(
    createElement(
      Fragment,
      null,
      createElement(code.CodeBlockCopyButton),
      createElement(code.CodeBlockCopyButton, { "aria-label": "Copy example" }),
      createElement(terminal.Terminal, {
        output: "ready",
        onClear: () => {
          clears += 1;
        },
      }),
      createElement(commit.CommitCopyButton, { hash: "abc123" }),
      createElement(
        stack.StackTrace,
        { trace: "Error: test" },
        createElement(stack.StackTraceCopyButton)
      ),
      createElement(env.EnvironmentVariableCopyButton),
      createElement(conversation.ConversationDownload, { messages: [] }),
      createElement(conversation.Conversation, {
        initial: false,
        children: createElement(conversation.ConversationScrollButton),
      }),
      createElement(
        QueueItemAction,
        { "aria-label": "Remove queued message" },
        "×"
      )
    )
  );
  try {
    for (const name of [
      "Copy code",
      "Copy example",
      "Copy terminal output",
      "Clear terminal",
      "Copy commit hash",
      "Copy stack trace",
      "Copy environment variable",
      "Download conversation",
      "Scroll to bottom",
      "Remove queued message",
    ])
      assert.ok(view.getByRole("button", { name }));
    testing.fireEvent.click(
      view.getByRole("button", { name: "Clear terminal" })
    );
    assert.equal(clears, 1);
  } finally {
    view.unmount();
    restore();
  }
});

test("sidebar toggle and calendar days retain existing accessible names", async () => {
  const restore = installControlHookDom();
  const [{ render }, { SidebarTrigger }, { SidebarContext }, { Calendar }] =
    await Promise.all([
      import("@testing-library/react"),
      import("../../components/ui/sidebar"),
      import("../../components/ui/sidebar-context"),
      import("../../components/ui/calendar"),
    ]);
  const view = render(
    createElement(
      Fragment,
      null,
      createElement(
        SidebarContext.Provider,
        {
          value: {
            state: "expanded",
            open: true,
            openMobile: false,
            isMobile: false,
            sidebarWidth: 256,
            setOpen: () => {},
            setOpenMobile: () => {},
            toggleSidebar: () => {},
            setSidebarWidth: () => {},
          },
        },
        createElement(SidebarTrigger)
      ),
      createElement(Calendar, {
        mode: "single",
        defaultMonth: new Date(2026, 9, 1),
      })
    )
  );
  try {
    assert.ok(view.getByRole("button", { name: "Toggle Sidebar" }));
    assert.ok(view.getByRole("button", { name: /October 4th, 2026/ }));
    assert.ok(view.getByRole("button", { name: "Go to the Previous Month" }));
    assert.ok(view.getByRole("button", { name: "Go to the Next Month" }));
  } finally {
    view.unmount();
    restore();
  }
});

test("sandbox state has a live text alternative as it changes", async () => {
  const restore = installControlHookDom();
  const [{ render }, { SandboxChip }] = await Promise.all([
    import("@testing-library/react"),
    import("../../components/sandbox-chip"),
  ]);
  const view = render(
    createElement(SandboxChip, {
      state: {
        kind: "live",
        sandboxId: "test-sandbox",
        previewUrl: "https://example.com",
        expiresAt: "2026-10-05T00:00:00Z",
      },
    })
  );
  try {
    assert.equal(view.getByRole("status").textContent, "ready");
    assert.equal(view.getByRole("status").getAttribute("aria-live"), "polite");
    view.rerender(
      createElement(SandboxChip, {
        state: {
          kind: "stopped",
          sandboxId: "test-sandbox",
          reason: null,
          branch: "main",
        },
      })
    );
    assert.equal(view.getByRole("status").textContent, "stopped");
  } finally {
    view.unmount();
    restore();
  }
});
