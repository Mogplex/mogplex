import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { installControlHookDom } from "../support/control-hook-dom";

test("code blocks show current plain text while real syntax highlighting loads", async () => {
  const restore = installControlHookDom();
  const [{ render, act }, { CodeBlockContent, highlightCode }] =
    await Promise.all([
      import("@testing-library/react"),
      import("../../components/ai-elements/code-block"),
    ]);
  const firstCode = "const lazyExample = 42;";
  const secondCode = "const nextExample = true;";
  const view = render(
    createElement(CodeBlockContent, {
      code: firstCode,
      language: "typescript",
    })
  );
  const finishHighlighting = async (code: string) => {
    await act(async () => {
      await new Promise<void>((resolve) => {
        const cached = highlightCode(code, "typescript", () => resolve());
        if (cached) resolve();
      });
    });
  };
  try {
    assert.equal(view.container.querySelector("code")?.textContent, firstCode);
    assert.equal(
      view.container.querySelector("code span span")?.getAttribute("style"),
      "color: inherit;"
    );
    await finishHighlighting(firstCode);
    assert.equal(view.container.querySelector("code")?.textContent, firstCode);
    assert.notEqual(
      view.container.querySelector("code span span")?.getAttribute("style"),
      "color: inherit;"
    );

    view.rerender(
      createElement(CodeBlockContent, {
        code: secondCode,
        language: "typescript",
      })
    );
    assert.equal(view.container.querySelector("code")?.textContent, secondCode);
    await finishHighlighting(secondCode);
    assert.equal(view.container.querySelector("code")?.textContent, secondCode);
  } finally {
    view.unmount();
    restore();
  }
});

test("Markdown highlighting activates for code fences and supports real languages", async () => {
  const restore = installControlHookDom();
  const [{ renderHook, act }, { useCodeHighlighting }] = await Promise.all([
    import("@testing-library/react"),
    import("../../components/ai-elements/use-code-highlighting"),
  ]);
  const view = renderHook(
    ({ content }: { content: string }) => useCodeHighlighting(content),
    {
      initialProps: { content: "Ordinary message text." },
    }
  );
  const getPlugin = () => view.result.current;
  try {
    await act(async () => {
      await import("@streamdown/code");
    });
    assert.equal(getPlugin(), undefined);
    await act(async () => {
      view.rerender({ content: '> ~~~json\n> {"ready":true}\n> ~~~' });
    });
    await act(async () => {
      await import("@streamdown/code");
    });
    assert.equal(getPlugin()?.supportsLanguage("json"), true);
    const loadedPlugin = getPlugin();
    view.rerender({ content: "Plain text after code." });
    assert.equal(getPlugin(), loadedPlugin);
  } finally {
    view.unmount();
    restore();
  }
});
