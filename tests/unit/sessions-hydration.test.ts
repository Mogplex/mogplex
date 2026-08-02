import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

test("useSessionsHydrated is safe during server rendering", async () => {
  const { useSessionsHydrated } = await import("../../hooks/use-sessions");

  function Probe() {
    const hydrated = useSessionsHydrated();
    return createElement("div", null, hydrated ? "hydrated" : "loading");
  }

  assert.doesNotThrow(() => {
    const html = renderToString(createElement(Probe));
    assert.match(html, /loading/);
  });
});
