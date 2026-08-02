import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const globalsUrl = new URL("../../app/globals.css", import.meta.url);
const globalErrorUrl = new URL("../../app/global-error.tsx", import.meta.url);
const modelsSectionUrl = new URL(
  "../../components/library/models-section.tsx",
  import.meta.url
);
const notFoundUrl = new URL("../../app/not-found.tsx", import.meta.url);
const monacoPaneUrl = new URL(
  "../../components/monaco-pane.tsx",
  import.meta.url
);
const asciiHeroUrl = new URL(
  "../../components/marketing/ascii-hero.tsx",
  import.meta.url
);

test("tokenized shadows preserve their pre-tokenization values", async () => {
  const [globals, modelsSection, notFound] = await Promise.all([
    readFile(globalsUrl, "utf8"),
    readFile(modelsSectionUrl, "utf8"),
    readFile(notFoundUrl, "utf8"),
  ]);

  assert.match(
    globals,
    /--app-shadow-card: 0 12px 30px rgba\(0, 0, 0, 0\.12\);/
  );
  assert.match(
    globals,
    /--app-shadow-panel: 0 18px 50px rgba\(0, 0, 0, 0\.14\);/
  );
  assert.match(
    globals,
    /--signal-lost-action-shadow: 0 12px 36px rgba\(3, 5, 18, 0\.2\);/
  );
  assert.match(modelsSection, /shadow-app-card/);
  assert.match(modelsSection, /shadow-app-panel/);
  assert.match(notFound, /shadow-signal-lost-action/);
});

test("global error keeps semantic tokens in their dark scope", async () => {
  const globalError = await readFile(globalErrorUrl, "utf8");

  assert.match(globalError, /<html className="dark" lang="en">/);
});

test("Monaco and ASCII token failures surface visible component errors", async () => {
  const [monacoPane, asciiHero] = await Promise.all([
    readFile(monacoPaneUrl, "utf8"),
    readFile(asciiHeroUrl, "utf8"),
  ]);

  assert.match(monacoPane, /void init\(\)\.catch\(/);
  assert.doesNotMatch(monacoPane, /^\s*init\(\)\s*$/m);
  assert.doesNotMatch(monacoPane, /void applyMonacoTheme\(themeMode\)\.then/);
  assert.match(
    asciiHero,
    /if \(!backgroundColor \|\| !foregroundColor\) \{[\s\S]*setUnsupported\(true\)/
  );
});

test("highlight.js built-ins retain their distinct fuchsia token", async () => {
  const globals = await readFile(globalsUrl, "utf8");

  assert.match(globals, /--accent-fuchsia: #e879f9;/);
  assert.match(
    globals,
    /\.hljs-built_in \{\s*color: var\(--accent-fuchsia\);\s*\}/
  );
});
