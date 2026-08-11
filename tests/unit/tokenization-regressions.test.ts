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
const dashboardLayoutUrl = new URL(
  "../../app/(dashboard)/layout.tsx",
  import.meta.url
);
const topBarUrl = new URL("../../components/top-bar.tsx", import.meta.url);
const statusBarUrl = new URL(
  "../../components/status-bar.tsx",
  import.meta.url
);
const appSidebarUrl = new URL(
  "../../components/app-sidebar.tsx",
  import.meta.url
);

test("tokenized shadows preserve semantic shadow tokens", async () => {
  const [globals, modelsSection, notFound] = await Promise.all([
    readFile(globalsUrl, "utf8"),
    readFile(modelsSectionUrl, "utf8"),
    readFile(notFoundUrl, "utf8"),
  ]);

  assert.match(
    globals,
    /--app-shadow-card: 0 12px 30px oklch\(10\.88% 0\.006 132 \/ 12%\);/
  );
  assert.match(
    globals,
    /--app-shadow-panel: 0 18px 50px oklch\(10\.88% 0\.006 132 \/ 14%\);/
  );
  assert.match(
    globals,
    /--signal-lost-action-shadow: 0 12px 36px\s+oklch\(9\.16% 0\.0368 264\.04 \/ 20%\);/
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

  assert.match(globals, /--accent-fuchsia: oklch\(74\.01% 0\.1732 327\.29\);/);
  assert.match(
    globals,
    /\.hljs-built_in \{\s*color: var\(--accent-fuchsia\);\s*\}/
  );
});

test("application theme tokens carry the Mogplex paper and orange brand roles", async () => {
  const globals = await readFile(globalsUrl, "utf8");

  assert.match(globals, /--brand-accent: oklch\(66\.57% 0\.225 36\.57\);/);
  assert.match(globals, /--neutral-1: oklch\(96\.88% 0\.007 96\);/);
  assert.match(globals, /--background: var\(--neutral-1\);/);
  assert.match(globals, /--primary: var\(--brand-accent\);/);
  assert.match(globals, /--ring: var\(--brand-accent\);/);
  assert.match(globals, /::selection \{\s*background: var\(--brand-accent\);/);
});

test("dashboard chrome exposes the branded shell and compact navigation mark", async () => {
  const [globals, dashboardLayout, topBar, statusBar, appSidebar] =
    await Promise.all([
      readFile(globalsUrl, "utf8"),
      readFile(dashboardLayoutUrl, "utf8"),
      readFile(topBarUrl, "utf8"),
      readFile(statusBarUrl, "utf8"),
      readFile(appSidebarUrl, "utf8"),
    ]);

  assert.match(dashboardLayout, /className="app-shell /);
  assert.match(dashboardLayout, /className="app-shell-content /);
  assert.match(topBar, /className="app-topbar /);
  assert.doesNotMatch(topBar, /import \{ MogplexMark \}/);
  assert.doesNotMatch(topBar, /className="app-brand-mark /);
  assert.match(statusBar, /className="app-statusbar /);
  assert.match(dashboardLayout, /<AppSidebar \/>/);
  // The brand mark lives in the window chrome and stays inside the app:
  // it links to the scoped control route, never the marketing homepage.
  assert.match(dashboardLayout, /import \{ MogplexMark \}/);
  assert.match(dashboardLayout, /scopedHref\(scope, "\/control"\)/);
  assert.match(appSidebar, /data-testid="app-sidebar"/);
  assert.match(appSidebar, /data-testid="app-sidebar-resizer"/);
  assert.match(appSidebar, /role="separator"/);
  assert.match(appSidebar, /const MIN_WIDTH = 64/);
  assert.match(appSidebar, /data-compact=\{compact \? "true" : "false"\}/);
  assert.match(appSidebar, /app-nav-\$\{item\.id\}/);
  assert.match(globals, /\.app-sidebar-link\.is-active/);
  assert.match(globals, /\.app-sidebar\[data-compact="true"\]/);
});
