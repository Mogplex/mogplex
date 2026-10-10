import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PathParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { CommandInput } from "../../components/command-input";

test("workspace context stays unknown until the current model reports usage", () => {
  const html = renderToStaticMarkup(
    createElement(
      PathParamsContext.Provider,
      { value: { scope: "user" } },
      createElement(CommandInput, {
        onSubmit: () => {},
        builtinCommands: [],
        models: ["test-model"],
        model: "test-model",
      })
    )
  );
  assert.match(html, /Context: unknown/);
  assert.doesNotMatch(html, /100% left/);
});
