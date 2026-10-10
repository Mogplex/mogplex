import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/postcss";
import postcss from "postcss";

test("dashboard utilities compile independently of the public route exclusions", async () => {
  const compile = async (name: string) => {
    const file = new URL(`../../app/${name}`, import.meta.url);
    return postcss([tailwindcss()]).process(await readFile(file, "utf8"), {
      from: fileURLToPath(file),
    });
  };
  const [publicStyles, dashboardStyles] = await Promise.all([
    compile("globals.css"),
    compile("dashboard.css"),
  ]);
  // This app-only utility contains the observability inspector's own scroll
  // surface. Losing it makes long runs scroll the page instead of the panel.
  const inspectorHeight = /max-height:\s*calc\(100vh\s*-\s*8rem\)/;
  assert.ok(
    inspectorHeight.test(dashboardStyles.css),
    "Dashboard retains the inspector height utility"
  );
  assert.equal(inspectorHeight.test(publicStyles.css), false);
  assert.ok(/\.app-shell\s*\{/.test(dashboardStyles.css));
  assert.equal(/\.app-shell\s*\{/.test(publicStyles.css), false);
});
