import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const scopeLayoutUrl = new URL(
  "../../app/(dashboard)/[scope]/layout.tsx",
  import.meta.url
);
test("the scoped layout owns the terminal host across route navigation", async () => {
  const scopeLayout = await readFile(scopeLayoutUrl, "utf8");

  assert.match(scopeLayout, /import \{ TerminalHost \}/);
  assert.match(scopeLayout, /<TerminalHost(?:\s[^>]*)?\s*\/>/);
});
