import {
  getAncestorDirectoryTreePaths,
  isDirectoryTreePath,
} from "@/lib/file-tree-paths";
import type { useFileTree } from "@pierre/trees/react";

export type TreeCreateKind = "directory" | "file";

export function buildDefaultCreatePath(
  kind: TreeCreateKind,
  directoryPath?: string | null
) {
  const baseName = kind === "file" ? "untitled.txt" : "new-folder/";
  return directoryPath ? `${directoryPath}${baseName}` : baseName;
}

export function getComposedPath(event: Event) {
  return typeof event.composedPath === "function" ? event.composedPath() : [];
}

export function getTreeInteractionMeta(event: Event) {
  const composedPath = getComposedPath(event);
  let targetPath: string | null = null;
  let targetKind: "directory" | "file" | null = null;

  for (const node of composedPath) {
    if (!(node instanceof HTMLElement)) continue;
    if (
      node.getAttribute("data-type") === "context-menu-trigger" ||
      node.getAttribute("data-item-rename-input") === "true"
    ) {
      return null;
    }
    const itemPath = node.getAttribute("data-item-path");
    if (!targetPath && itemPath) {
      targetPath = itemPath;
      targetKind =
        node.getAttribute("data-item-type") === "folder" ? "directory" : "file";
    }
  }

  return targetPath && targetKind
    ? { kind: targetKind, path: targetPath }
    : null;
}

export function expandTreeAncestors(
  model: ReturnType<typeof useFileTree>["model"],
  path: string,
  options?: { includeSelf?: boolean }
) {
  for (const ancestor of getAncestorDirectoryTreePaths(path, options)) {
    const item = model.getItem(ancestor);
    if (item && "expand" in item) item.expand();
  }
}

export function getExpandedDirectoryTreePaths(
  model: ReturnType<typeof useFileTree>["model"],
  paths: readonly string[]
) {
  const expandedPaths: string[] = [];

  for (const treePath of paths) {
    if (!isDirectoryTreePath(treePath)) continue;
    const item = model.getItem(treePath);
    if (item && "isExpanded" in item && item.isExpanded()) {
      expandedPaths.push(treePath);
    }
  }

  return expandedPaths;
}

export async function readJsonResponse<T>(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String(payload.error)
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}
