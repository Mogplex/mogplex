/**
 * Changed-files model for the Diffs rail tab.
 *
 * Aggregates every file the agent touched during a chat into per-file
 * add/del stats (from unified patches in tool inputs/outputs) plus
 * patch-less mutation calls, then groups them into a directory tree —
 * the Conductor-style "changed files by directory" view.
 *
 * Pure builders only: no @pierre/diffs import (ESM-only, breaks the
 * node:test tier); inline rendering happens in the browser via PatchViewer.
 */

import type { UIMessage } from "ai";
import { isToolOrDynamicToolUIPart } from "ai";
import { extractPatchFromValue } from "./diff-text";
import { collectFileMutations } from "./activity-stream";

export type ChangedFile = {
  /** Repo-relative path as the agent reported it. */
  path: string;
  additions: number;
  deletions: number;
  /** This file's section of the latest patch that touched it, if any. */
  patch: string | null;
  state: "running" | "done" | "failed";
};

export type ChangedDirNode = {
  /** Single path segment ("" for the root). */
  name: string;
  /** Full directory path ("" for the root). */
  path: string;
  dirs: ChangedDirNode[];
  files: ChangedFile[];
  additions: number;
  deletions: number;
};

type PatchSection = {
  path: string;
  patch: string;
  additions: number;
  deletions: number;
};

function countSection(section: string): {
  path: string | null;
  additions: number;
  deletions: number;
} {
  let path: string | null = null;
  let additions = 0;
  let deletions = 0;
  for (const line of section.split("\n")) {
    if (line.startsWith("+++ ")) {
      const name = line.slice(4).trim();
      path = name === "/dev/null" ? null : name.replace(/^b\//, "");
    } else if (line.startsWith("--- ")) {
      if (path === null) {
        const name = line.slice(4).trim();
        if (name !== "/dev/null") path = name.replace(/^a\//, "");
      }
    } else if (line.startsWith("+")) {
      additions += 1;
    } else if (line.startsWith("-")) {
      deletions += 1;
    }
  }
  return { path, additions, deletions };
}

/**
 * Split a unified patch into per-file sections. `diff --git` patches split
 * on each header; a bare unified diff (no git headers) is one section whose
 * path comes from its +++/--- lines.
 */
export function splitPatchByFile(patch: string): PatchSection[] {
  const normalized = patch.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const hasGitHeaders = /^diff --git /m.test(normalized);
  const rawSections = hasGitHeaders
    ? normalized.split(/^(?=diff --git )/m)
    : [normalized];

  const sections: PatchSection[] = [];
  for (const raw of rawSections) {
    const section = raw.trim();
    if (!section) continue;
    const counted = countSection(section);
    const headerPath = section.match(/^diff --git a\/(.+?) b\/.+$/m)?.[1];
    const path = counted.path ?? headerPath ?? "(unknown)";
    sections.push({
      path,
      patch: section,
      additions: counted.additions,
      deletions: counted.deletions,
    });
  }
  return sections;
}

function toolState(part: unknown): "running" | "done" | "failed" {
  const raw =
    typeof part === "object" && part !== null && "state" in part
      ? String((part as { state: unknown }).state)
      : "";
  if (raw === "output-available") return "done";
  if (raw === "output-error") return "failed";
  return "running";
}

/**
 * Every file the agent changed, aggregated by path: repeated edits sum
 * their add/del counts and keep the latest patch section. Mutation tool
 * calls that produced no unified diff are included with zero counts so the
 * tab still reflects them.
 */
export function collectChangedFiles(messages: UIMessage[]): ChangedFile[] {
  const byPath = new Map<string, ChangedFile>();
  const order: string[] = [];
  const patchedCallIds = new Set<string>();

  const upsert = (path: string, update: Partial<ChangedFile>) => {
    const existing = byPath.get(path);
    if (existing) {
      existing.additions += update.additions ?? 0;
      existing.deletions += update.deletions ?? 0;
      if (update.patch) existing.patch = update.patch;
      if (update.state) existing.state = update.state;
    } else {
      byPath.set(path, {
        path,
        additions: update.additions ?? 0,
        deletions: update.deletions ?? 0,
        patch: update.patch ?? null,
        state: update.state ?? "done",
      });
      order.push(path);
    }
  };

  for (const msg of messages) {
    if (msg.role !== "assistant" || !msg.parts) continue;
    for (const [index, part] of msg.parts.entries()) {
      if (!isToolOrDynamicToolUIPart(part)) continue;
      const patch =
        extractPatchFromValue("output" in part ? part.output : undefined) ??
        extractPatchFromValue("input" in part ? part.input : undefined);
      if (!patch) continue;
      // This call contributed real diffs; don't also list it as a
      // patch-less mutation (its input usually lacks a path anyway).
      patchedCallIds.add(`${msg.id}-${index}`);
      const state = toolState(part);
      for (const section of splitPatchByFile(patch)) {
        upsert(section.path, {
          additions: section.additions,
          deletions: section.deletions,
          patch: section.patch,
          state: state === "running" ? "done" : state,
        });
      }
    }
  }

  for (const mutation of collectFileMutations(messages)) {
    if (patchedCallIds.has(mutation.id) || byPath.has(mutation.path)) continue;
    upsert(mutation.path, { state: mutation.state });
  }

  return order.map((path) => byPath.get(path)!);
}

/**
 * Group changed files into a nested directory tree with per-directory
 * add/del totals. Directories sort before files, both alphabetical.
 */
export function buildChangedFileTree(files: ChangedFile[]): ChangedDirNode {
  const root: ChangedDirNode = {
    name: "",
    path: "",
    dirs: [],
    files: [],
    additions: 0,
    deletions: 0,
  };

  for (const file of files) {
    const segments = file.path.split("/").filter(Boolean);
    // A bare filename lands on the root; the last segment is never a dir.
    segments.pop();
    let node = root;
    let currentPath = "";
    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      let child = node.dirs.find((dir) => dir.name === segment);
      if (!child) {
        child = {
          name: segment,
          path: currentPath,
          dirs: [],
          files: [],
          additions: 0,
          deletions: 0,
        };
        node.dirs.push(child);
      }
      node = child;
    }
    node.files.push(file);
  }

  const finalize = (node: ChangedDirNode): void => {
    for (const dir of node.dirs) finalize(dir);
    node.dirs.sort((a, b) => a.name.localeCompare(b.name));
    node.files.sort((a, b) => a.path.localeCompare(b.path));
    node.additions =
      node.files.reduce((sum, f) => sum + f.additions, 0) +
      node.dirs.reduce((sum, d) => sum + d.additions, 0);
    node.deletions =
      node.files.reduce((sum, f) => sum + f.deletions, 0) +
      node.dirs.reduce((sum, d) => sum + d.deletions, 0);
  };
  finalize(root);

  return root;
}

/** All directory paths in the tree (for collapse-all). */
export function collectDirPaths(root: ChangedDirNode): string[] {
  const paths: string[] = [];
  const walk = (node: ChangedDirNode) => {
    for (const dir of node.dirs) {
      paths.push(dir.path);
      walk(dir);
    }
  };
  walk(root);
  return paths;
}
