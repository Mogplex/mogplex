import { resolveSandboxPath } from "@/lib/repo-settings";
import type { Sandbox } from "@vercel/sandbox";
import type { LinkedVercelProject } from "./env-vars";

const GENERATED_MANIFEST_RELATIVE_PATH = ".mogplex/vercel-link-manifest.json";

type SandboxFileAccess = Pick<
  Sandbox,
  "readFileToBuffer" | "runCommand" | "writeFiles"
>;

type PreparedVercelLinkManifest = {
  version: 1;
  files: string[];
};

export type PrepareSandboxVercelLinkResult = {
  applied: boolean;
  warning: string | null;
  generatedFiles: string[];
};

export async function prepareSandboxVercelLink(
  _sandbox: SandboxFileAccess,
  _opts: {
    rootDirectory?: string | null;
    envSyncMode?: unknown;
    envVars?: unknown;
    linkedProject?: LinkedVercelProject | null;
  }
): Promise<PrepareSandboxVercelLinkResult> {
  // Retained for older bootstrap callers. New sandboxes never materialize
  // personal Vercel links; cleanup below still handles historical artifacts.
  return { applied: false, warning: null, generatedFiles: [] };
}

export async function cleanupPreparedSandboxVercelLink(
  sandbox: SandboxFileAccess,
  opts: {
    rootDirectory?: string | null;
  }
): Promise<{ removedFiles: string[] }> {
  const { manifestFile } = resolveGeneratedLinkPaths(opts.rootDirectory);
  const manifestText = await readSandboxTextFile(sandbox, manifestFile);
  if (!manifestText) {
    return { removedFiles: [] };
  }

  const manifest = parsePreparedLinkManifest(manifestText);
  const filesToRemove = [...manifest.files, manifestFile];
  if (filesToRemove.length === 0) {
    return { removedFiles: [] };
  }

  const remove = await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-lc",
      `rm -f ${filesToRemove.map((path) => `'${escapeShell(path)}'`).join(" ")}`,
    ],
  });

  if (remove.exitCode !== 0) {
    throw new Error(
      "Failed to remove generated Vercel bootstrap files before snapshotting"
    );
  }

  return {
    removedFiles: manifest.files,
  };
}

function escapeShell(value: string) {
  return value.replace(/'/g, String.raw`'\''`);
}

async function readSandboxTextFile(sandbox: SandboxFileAccess, path: string) {
  try {
    const buffer = await sandbox.readFileToBuffer({ path });
    return buffer ? buffer.toString("utf-8") : null;
  } catch {
    return null;
  }
}

function resolveGeneratedLinkPaths(rootDirectory?: string | null) {
  return {
    manifestFile: resolveSandboxPath(
      rootDirectory,
      GENERATED_MANIFEST_RELATIVE_PATH
    ),
  };
}

function parsePreparedLinkManifest(text: string): PreparedVercelLinkManifest {
  const parsed = JSON.parse(text) as { version?: number; files?: unknown };
  if (
    parsed.version !== 1 ||
    !Array.isArray(parsed.files) ||
    parsed.files.some((file) => typeof file !== "string")
  ) {
    throw new Error("Invalid Mogplex Vercel link manifest");
  }
  return {
    version: 1,
    files: parsed.files,
  };
}
