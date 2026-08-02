import assert from "node:assert/strict";
import test from "node:test";
import {
  clearPaneFilePaths,
  retargetPaneFilePaths,
  type TreeNode,
} from "../../hooks/use-split-panes";

test("retargetPaneFilePaths updates file-backed panes for moved directories", () => {
  const root: TreeNode = {
    id: "root",
    dir: "horizontal",
    sizes: [25, 25, 25, 25],
    children: [
      {
        id: "editor-a",
        type: "editor",
        name: "a.ts",
        lines: [],
        status: "idle",
        filePath: "src/utils/a.ts",
      },
      {
        id: "editor-b",
        type: "editor",
        name: "b.ts",
        lines: [],
        status: "idle",
        filePath: "src/utils/nested/b.ts",
        sandboxBinding: "pinned",
        sandboxId: "sandbox-2",
      },
      {
        id: "preview-a",
        type: "preview",
        name: "Live Preview",
        lines: [],
        status: "idle",
        filePath: "src/utils/preview.ts",
        sandboxBinding: "pinned",
        sandboxId: "sandbox-1",
      },
      {
        id: "preview-b",
        type: "preview",
        name: "Live Preview",
        lines: [],
        status: "idle",
        filePath: "src/utils/other-preview.ts",
        sandboxBinding: "pinned",
        sandboxId: "sandbox-2",
      },
    ],
  };

  const nextRoot = retargetPaneFilePaths(root, "src/utils/", "src/lib/", {
    targetSandboxId: "sandbox-1",
    activeSessionSandboxId: "sandbox-1",
  });

  assert.deepEqual(nextRoot, {
    id: "root",
    dir: "horizontal",
    sizes: [25, 25, 25, 25],
    children: [
      {
        id: "editor-a",
        type: "editor",
        name: "a.ts",
        lines: [],
        status: "idle",
        filePath: "src/lib/a.ts",
      },
      {
        id: "editor-b",
        type: "editor",
        name: "b.ts",
        lines: [],
        status: "idle",
        filePath: "src/utils/nested/b.ts",
        sandboxBinding: "pinned",
        sandboxId: "sandbox-2",
      },
      {
        id: "preview-a",
        type: "preview",
        name: "Live Preview",
        lines: [],
        status: "idle",
        filePath: "src/lib/preview.ts",
        sandboxBinding: "pinned",
        sandboxId: "sandbox-1",
      },
      {
        id: "preview-b",
        type: "preview",
        name: "Live Preview",
        lines: [],
        status: "idle",
        filePath: "src/utils/other-preview.ts",
        sandboxBinding: "pinned",
        sandboxId: "sandbox-2",
      },
    ],
  });
});

test("clearPaneFilePaths clears file-backed panes affected by a deleted directory", () => {
  const root: TreeNode = {
    id: "root",
    dir: "horizontal",
    sizes: [25, 25, 25, 25],
    children: [
      {
        id: "editor-a",
        type: "editor",
        name: "a.ts",
        lines: [],
        status: "idle",
        filePath: "src/generated/a.ts",
      },
      {
        id: "editor-b",
        type: "editor",
        name: "b.ts",
        lines: [],
        status: "idle",
        filePath: "src/app/b.ts",
        sandboxBinding: "pinned",
        sandboxId: "sandbox-2",
      },
      {
        id: "preview-a",
        type: "preview",
        name: "Live Preview",
        lines: [],
        status: "idle",
        filePath: "src/generated/preview.ts",
        sandboxBinding: "pinned",
        sandboxId: "sandbox-1",
      },
      {
        id: "preview-b",
        type: "preview",
        name: "Live Preview",
        lines: [],
        status: "idle",
        filePath: "src/generated/other-preview.ts",
        sandboxBinding: "pinned",
        sandboxId: "sandbox-2",
      },
    ],
  };

  const nextRoot = clearPaneFilePaths(root, "src/generated/", {
    targetSandboxId: "sandbox-1",
    activeSessionSandboxId: "sandbox-1",
  });

  assert.deepEqual(nextRoot, {
    id: "root",
    dir: "horizontal",
    sizes: [25, 25, 25, 25],
    children: [
      {
        id: "editor-a",
        type: "editor",
        name: "Code Editor",
        lines: [],
        status: "idle",
        filePath: undefined,
      },
      {
        id: "editor-b",
        type: "editor",
        name: "b.ts",
        lines: [],
        status: "idle",
        filePath: "src/app/b.ts",
        sandboxBinding: "pinned",
        sandboxId: "sandbox-2",
      },
      {
        id: "preview-a",
        type: "preview",
        name: "Live Preview",
        lines: [],
        status: "idle",
        filePath: undefined,
        sandboxBinding: "pinned",
        sandboxId: "sandbox-1",
      },
      {
        id: "preview-b",
        type: "preview",
        name: "Live Preview",
        lines: [],
        status: "idle",
        filePath: "src/generated/other-preview.ts",
        sandboxBinding: "pinned",
        sandboxId: "sandbox-2",
      },
    ],
  });
});
