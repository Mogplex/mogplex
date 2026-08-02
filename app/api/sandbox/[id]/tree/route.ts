import { NextResponse } from "next/server";
import {
  ensureDirectoryTreePath,
  isDirectoryTreePath,
  sortTreePaths,
  stripDirectoryTreePath,
} from "@/lib/file-tree-paths";
import { resolveSandboxPath } from "@/lib/repo-settings";
import { touchSandboxLastActive } from "@/lib/sandbox/records";
import {
  buildSandboxRouteErrorResponse,
  type LoadedSandboxRouteContext,
  type SandboxRouteRecordLike,
  loadOwnedSandboxRouteContext,
} from "@/lib/sandbox/route-context";
import path from "node:path";
import type { Sandbox } from "@vercel/sandbox";
import type { Capability } from "@/lib/team-capabilities";

const TREE_ROUTE_SELECT =
  "sandbox_id, root_directory, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id, repo:repos(root_directory)";

const PRUNED_DIRECTORY_NAMES = [
  ".cache",
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  "node_modules",
] as const;

type TreeRouteDeps = {
  loadOwnedSandboxRouteContext: typeof loadOwnedSandboxRouteContext;
  touchSandboxLastActive: typeof touchSandboxLastActive;
};

const DEFAULT_DEPS: TreeRouteDeps = {
  loadOwnedSandboxRouteContext,
  touchSandboxLastActive,
};

type LoadedTreeSandboxData =
  LoadedSandboxRouteContext<SandboxRouteRecordLike> & {
    sandbox: Sandbox;
  };

class TreeRouteError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "TreeRouteError";
    this.status = status;
  }
}

function buildTreeErrorResponse(error: unknown) {
  if (error instanceof TreeRouteError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status }
    );
  }

  const message =
    error instanceof Error ? error.message : "Tree operation failed";
  return NextResponse.json({ error: message }, { status: 500 });
}

function normalizeTreePathInput(
  value: unknown,
  kind: "file" | "directory" | "either" = "either"
) {
  if (typeof value !== "string") {
    throw new TreeRouteError("path required", 400);
  }

  const trimmed = value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "");
  if (!trimmed) {
    throw new TreeRouteError("path required", 400);
  }

  const wantsDirectory =
    kind === "directory" || (kind === "either" && trimmed.endsWith("/"));
  const normalized = path.posix.normalize(trimmed.replace(/\/+$/, ""));

  if (
    normalized.length === 0 ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    path.posix.isAbsolute(normalized) ||
    normalized.split("/").includes("..")
  ) {
    throw new TreeRouteError("path must stay within the repo root", 400);
  }

  return wantsDirectory ? ensureDirectoryTreePath(normalized) : normalized;
}

function toFilesystemPath(
  rootDirectory: string | null | undefined,
  repoPath: string
) {
  return resolveSandboxPath(rootDirectory, stripDirectoryTreePath(repoPath));
}

function parseTreeIndexOutput(output: string) {
  const indexedPaths = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separatorIndex = line.lastIndexOf("\t");
      if (separatorIndex <= 0) return null;

      const relativePath = line.slice(0, separatorIndex).trim();
      const kind = line.slice(separatorIndex + 1).trim();
      if (!relativePath || relativePath === ".") return null;
      if (kind !== "d" && kind !== "f" && kind !== "l") return null;

      try {
        return normalizeTreePathInput(
          kind === "d" ? `${relativePath}/` : relativePath,
          kind === "d" ? "directory" : "file"
        );
      } catch {
        return null;
      }
    })
    .filter((value): value is string => value !== null);

  return sortTreePaths(indexedPaths);
}

function buildFindTreeArgs(targetPath: string) {
  return [
    targetPath,
    "-mindepth",
    "1",
    "(",
    "-name",
    PRUNED_DIRECTORY_NAMES[0],
    "-o",
    "-name",
    PRUNED_DIRECTORY_NAMES[1],
    "-o",
    "-name",
    PRUNED_DIRECTORY_NAMES[2],
    "-o",
    "-name",
    PRUNED_DIRECTORY_NAMES[3],
    "-o",
    "-name",
    PRUNED_DIRECTORY_NAMES[4],
    "-o",
    "-name",
    PRUNED_DIRECTORY_NAMES[5],
    ")",
    "-prune",
    "-o",
    "-printf",
    "%P\t%y\n",
  ];
}

async function ensurePathExists(sandbox: Sandbox, fsPath: string) {
  const result = await sandbox.runCommand({
    cmd: "test",
    args: ["-e", fsPath],
  });

  if (result.exitCode === 0) return;
  if (result.exitCode === 1) {
    throw new TreeRouteError("Path not found", 404);
  }

  throw new Error(await result.stderr());
}

async function ensurePathMissing(sandbox: Sandbox, fsPath: string) {
  const result = await sandbox.runCommand({
    cmd: "test",
    args: ["-e", fsPath],
  });

  if (result.exitCode === 1) return;
  if (result.exitCode === 0) {
    throw new TreeRouteError("Destination already exists", 409);
  }

  throw new Error(await result.stderr());
}

async function ensureParentDirectory(sandbox: Sandbox, fsPath: string) {
  const parentPath = path.posix.dirname(fsPath);
  const command = await sandbox.runCommand({
    cmd: "mkdir",
    args: ["-p", parentPath],
  });

  if (command.exitCode !== 0) {
    throw new Error(await command.stderr());
  }
}

async function loadTreeSandboxContext(
  deps: TreeRouteDeps,
  request: Request,
  id: string,
  requireCapability?: Capability
) {
  const sandboxData = await deps.loadOwnedSandboxRouteContext(request, id, {
    select: TREE_ROUTE_SELECT,
    requireCapability,
  });

  if (!sandboxData.ok) {
    return {
      response: buildSandboxRouteErrorResponse(sandboxData),
      sandboxData: null,
    };
  }

  if (!sandboxData.sandbox) {
    return {
      response: NextResponse.json(
        { error: "Sandbox is not ready" },
        { status: 409 }
      ),
      sandboxData: null,
    };
  }

  return { response: null, sandboxData: sandboxData as LoadedTreeSandboxData };
}

export function createSandboxTreeGetHandler(
  deps: TreeRouteDeps = DEFAULT_DEPS
) {
  return async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    try {
      const { id } = await params;
      const loaded = await loadTreeSandboxContext(deps, request, id);
      if (loaded.response) return loaded.response;

      const sandboxData = loaded.sandboxData;
      const targetPath = resolveSandboxPath(sandboxData.rootDirectory, ".");
      const result = await sandboxData.sandbox.runCommand({
        cmd: "find",
        args: buildFindTreeArgs(targetPath),
      });

      if (result.exitCode !== 0) {
        throw new Error(await result.stderr());
      }

      const paths = parseTreeIndexOutput(await result.stdout());
      await deps.touchSandboxLastActive(id);

      return NextResponse.json(
        { paths },
        { headers: { "cache-control": "no-store" } }
      );
    } catch (error) {
      return buildTreeErrorResponse(error);
    }
  };
}

export function createSandboxTreePostHandler(
  deps: TreeRouteDeps = DEFAULT_DEPS
) {
  return async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    try {
      const { id } = await params;
      const loaded = await loadTreeSandboxContext(
        deps,
        request,
        id,
        "tools.write_file"
      );
      if (loaded.response) return loaded.response;

      const body = await request.json();
      const kind =
        body?.kind === "directory"
          ? "directory"
          : body?.kind === "file"
            ? "file"
            : null;
      if (!kind) {
        throw new TreeRouteError("kind must be 'file' or 'directory'", 400);
      }

      const repoPath = normalizeTreePathInput(body?.path, kind);

      const sandboxData = loaded.sandboxData;
      const fsPath = toFilesystemPath(sandboxData.rootDirectory, repoPath);

      await ensurePathMissing(sandboxData.sandbox, fsPath);
      await ensureParentDirectory(sandboxData.sandbox, fsPath);

      if (kind === "directory") {
        const mkdir = await sandboxData.sandbox.runCommand({
          cmd: "mkdir",
          args: ["-p", fsPath],
        });

        if (mkdir.exitCode !== 0) {
          throw new Error(await mkdir.stderr());
        }
      } else {
        await sandboxData.sandbox.writeFiles([
          {
            path: fsPath,
            content: Buffer.from(""),
          },
        ]);
      }

      await deps.touchSandboxLastActive(id);

      return NextResponse.json({ ok: true, path: repoPath }, { status: 201 });
    } catch (error) {
      return buildTreeErrorResponse(error);
    }
  };
}

export function createSandboxTreePatchHandler(
  deps: TreeRouteDeps = DEFAULT_DEPS
) {
  return async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    try {
      const { id } = await params;
      const loaded = await loadTreeSandboxContext(
        deps,
        request,
        id,
        "tools.write_file"
      );
      if (loaded.response) return loaded.response;

      const body = await request.json();
      const rawMoves = Array.isArray(body?.moves) ? body.moves : [];
      if (rawMoves.length === 0) {
        throw new TreeRouteError("moves required", 400);
      }

      const moves = rawMoves.map(
        (move: { fromPath?: unknown; toPath?: unknown }) => {
          const fromPath = normalizeTreePathInput(move?.fromPath, "either");
          const toPath = normalizeTreePathInput(
            move?.toPath,
            isDirectoryTreePath(fromPath) ? "directory" : "file"
          );

          if (isDirectoryTreePath(fromPath) !== isDirectoryTreePath(toPath)) {
            throw new TreeRouteError("move kind mismatch", 400);
          }

          if (
            isDirectoryTreePath(fromPath) &&
            toPath !== fromPath &&
            toPath.startsWith(fromPath)
          ) {
            throw new TreeRouteError(
              "Cannot move a directory into itself",
              400
            );
          }

          return { fromPath, toPath };
        }
      );

      const sandboxData = loaded.sandboxData;

      for (const move of moves) {
        if (move.fromPath === move.toPath) continue;

        const fromFsPath = toFilesystemPath(
          sandboxData.rootDirectory,
          move.fromPath
        );
        const toFsPath = toFilesystemPath(
          sandboxData.rootDirectory,
          move.toPath
        );

        await ensurePathExists(sandboxData.sandbox, fromFsPath);
        await ensurePathMissing(sandboxData.sandbox, toFsPath);
        await ensureParentDirectory(sandboxData.sandbox, toFsPath);

        const result = await sandboxData.sandbox.runCommand({
          cmd: "mv",
          args: [fromFsPath, toFsPath],
        });

        if (result.exitCode !== 0) {
          throw new Error(await result.stderr());
        }
      }

      await deps.touchSandboxLastActive(id);

      return NextResponse.json({ ok: true, moves });
    } catch (error) {
      return buildTreeErrorResponse(error);
    }
  };
}

export function createSandboxTreeDeleteHandler(
  deps: TreeRouteDeps = DEFAULT_DEPS
) {
  return async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    try {
      const { id } = await params;
      const loaded = await loadTreeSandboxContext(
        deps,
        request,
        id,
        "tools.write_file"
      );
      if (loaded.response) return loaded.response;

      const body = await request.json();
      const repoPath = normalizeTreePathInput(body?.path, "either");

      const sandboxData = loaded.sandboxData;
      const fsPath = toFilesystemPath(sandboxData.rootDirectory, repoPath);

      await ensurePathExists(sandboxData.sandbox, fsPath);

      const result = await sandboxData.sandbox.runCommand({
        cmd: "rm",
        args: [isDirectoryTreePath(repoPath) ? "-rf" : "-f", fsPath],
      });

      if (result.exitCode !== 0) {
        throw new Error(await result.stderr());
      }

      await deps.touchSandboxLastActive(id);

      return NextResponse.json({ ok: true, path: repoPath });
    } catch (error) {
      return buildTreeErrorResponse(error);
    }
  };
}

export const GET = createSandboxTreeGetHandler();
export const POST = createSandboxTreePostHandler();
export const PATCH = createSandboxTreePatchHandler();
export const DELETE = createSandboxTreeDeleteHandler();
