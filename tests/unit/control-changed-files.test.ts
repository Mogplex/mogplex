import assert from "node:assert/strict";
import test from "node:test";
import type { UIMessage } from "ai";
import {
  buildChangedFileTree,
  collectChangedFiles,
  collectDirPaths,
  splitPatchByFile,
} from "../../lib/control/changed-files";

const TWO_FILE_PATCH = `diff --git a/src/lib/constants.ts b/src/lib/constants.ts
index 1111111..2222222 100644
--- a/src/lib/constants.ts
+++ b/src/lib/constants.ts
@@ -1,3 +1,9 @@
 export const A = 1;
+export const B = 2;
+export const C = 3;
+export const D = 4;
+export const E = 5;
+export const F = 6;
+export const G = 7;
+export const H = 8;
 export const I = 9;
+export const J = 10;
diff --git a/public/robots.txt b/public/robots.txt
index 3333333..4444444 100644
--- a/public/robots.txt
+++ b/public/robots.txt
@@ -1,2 +1,4 @@
 User-agent: *
+Allow: /
+Sitemap: https://example.com/sitemap.xml
-Disallow: /admin
-Disallow: /internal
`;

function patchMessage(patch: string): UIMessage[] {
  return [
    {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "tool-apply_patch",
          toolCallId: "c1",
          state: "output-available",
          input: { patch },
          output: { result: "ok" },
        },
      ],
    },
  ] as UIMessage[];
}

test("splitPatchByFile splits a git patch into per-file sections with counts", () => {
  const sections = splitPatchByFile(TWO_FILE_PATCH);

  assert.equal(sections.length, 2);
  assert.deepEqual(
    sections.map((s) => [s.path, s.additions, s.deletions]),
    [
      ["src/lib/constants.ts", 8, 0],
      ["public/robots.txt", 2, 2],
    ]
  );
  assert.match(sections[0].patch, /^diff --git a\/src\/lib\/constants\.ts/);
});

test("splitPatchByFile handles a bare unified diff without git headers", () => {
  const patch = `--- a/README.md
+++ b/README.md
@@ -1,1 +1,2 @@
 # Title
+New line
`;
  const sections = splitPatchByFile(patch);

  assert.equal(sections.length, 1);
  assert.equal(sections[0].path, "README.md");
  assert.equal(sections[0].additions, 1);
  assert.equal(sections[0].deletions, 0);
});

test("collectChangedFiles aggregates per-file stats from tool patches", () => {
  const files = collectChangedFiles(patchMessage(TWO_FILE_PATCH));

  assert.equal(files.length, 2);
  const constants = files.find((f) => f.path === "src/lib/constants.ts");
  assert.ok(constants);
  assert.equal(constants.additions, 8);
  assert.equal(constants.deletions, 0);
  assert.equal(constants.state, "done");
  assert.ok(constants.patch?.includes("constants.ts"));
});

test("collectChangedFiles sums repeated edits to the same path", () => {
  const patch = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,2 @@
 keep
+added
`;
  const messages = [
    {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "tool-edit",
          toolCallId: "c1",
          state: "output-available",
          input: { patch },
          output: "ok",
        },
        {
          type: "tool-edit",
          toolCallId: "c2",
          state: "output-available",
          input: { patch },
          output: "ok",
        },
      ],
    },
  ] as UIMessage[];

  const files = collectChangedFiles(messages);

  assert.equal(files.length, 1);
  assert.equal(files[0].path, "a.ts");
  assert.equal(files[0].additions, 2);
});

test("collectChangedFiles includes patch-less mutation calls with zero counts", () => {
  const messages = [
    {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "tool-write_file",
          toolCallId: "c1",
          state: "output-available",
          input: { path: "docs/new.md", content: "hello" },
          output: { result: "written" },
        },
      ],
    },
  ] as UIMessage[];

  const files = collectChangedFiles(messages);

  assert.equal(files.length, 1);
  assert.deepEqual(files[0], {
    path: "docs/new.md",
    additions: 0,
    deletions: 0,
    patch: null,
    state: "done",
  });
});

test("buildChangedFileTree nests directories and rolls up totals", () => {
  const files = collectChangedFiles(patchMessage(TWO_FILE_PATCH));
  const tree = buildChangedFileTree(files);

  assert.equal(tree.additions, 10);
  assert.equal(tree.deletions, 2);

  const [publicDir, srcDir] = tree.dirs;
  assert.equal(publicDir.name, "public");
  assert.equal(publicDir.files[0].path, "public/robots.txt");
  assert.equal(publicDir.additions, 2);
  assert.equal(publicDir.deletions, 2);

  assert.equal(srcDir.name, "src");
  assert.equal(srcDir.dirs[0].name, "lib");
  assert.equal(srcDir.dirs[0].files[0].path, "src/lib/constants.ts");
  assert.equal(srcDir.additions, 8);

  assert.deepEqual(collectDirPaths(tree), ["public", "src", "src/lib"]);
});
