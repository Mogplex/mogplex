import { tool } from "ai";
import { resolveSandboxPath } from "@/lib/repo-settings";
import { z } from "zod";

import { buildUpdateFilePatch } from "./pr-fixer-patch";
import {
  buildCommitUrl,
  encodePath,
  extractCommitSha,
  githubHeaders,
  normalizeRepoPath,
  parentDirectory,
  readCommandOutput,
  stripSandboxRootDirectory,
  type SandboxFileAccess,
} from "./pr-fixer-utils";

export { buildUpdateFilePatch } from "./pr-fixer-patch";

export function buildPRFixTools(config: {
  githubToken: string;
  owner: string;
  repo: string;
  headOwner: string;
  headRepo: string;
  prNumber: number;
  branch: string;
}) {
  return {
    getPullRequest: tool({
      description:
        "Fetch pull request metadata to confirm the branch and title before fixing",
      inputSchema: z.object({}),
      execute: async () => {
        const res = await fetch(
          `https://api.github.com/repos/${config.owner}/${config.repo}/pulls/${config.prNumber}`,
          { headers: githubHeaders(config.githubToken) }
        );

        if (!res.ok)
          throw new Error(`GitHub API ${res.status}: PR #${config.prNumber}`);

        const data = (await res.json()) as {
          number: number;
          title: string;
          body: string | null;
          html_url: string;
          head?: { ref?: string; sha?: string };
          base?: { ref?: string; sha?: string };
        };

        return {
          number: data.number,
          title: data.title,
          body: data.body,
          url: data.html_url,
          headRef: data.head?.ref ?? config.branch,
          headSha: data.head?.sha ?? null,
          baseRef: data.base?.ref ?? null,
          baseSha: data.base?.sha ?? null,
        };
      },
    }),
    listChangedFiles: tool({
      description:
        "List files changed in the pull request to focus fixes on the relevant surface area",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).default(100),
      }),
      execute: async ({ limit }) => {
        const perPage = Math.min(limit, 100);
        const res = await fetch(
          `https://api.github.com/repos/${config.owner}/${config.repo}/pulls/${config.prNumber}/files?per_page=${perPage}`,
          { headers: githubHeaders(config.githubToken) }
        );

        if (!res.ok)
          throw new Error(
            `GitHub API ${res.status}: PR files #${config.prNumber}`
          );

        const data = (await res.json()) as Array<{
          filename: string;
          status: string;
          additions: number;
          deletions: number;
          changes: number;
          patch?: string;
        }>;

        return {
          files: data.map((file) => ({
            path: file.filename,
            status: file.status,
            additions: file.additions,
            deletions: file.deletions,
            changes: file.changes,
            patch: file.patch ? file.patch.slice(0, 4000) : null,
          })),
        };
      },
    }),
    listFiles: tool({
      description:
        "List files in a repository directory on the current PR branch",
      inputSchema: z.object({ path: z.string().default("") }),
      execute: async ({ path }) => {
        const normalizedPath = path.trim();
        const suffix = normalizedPath ? `/${encodePath(normalizedPath)}` : "";
        const res = await fetch(
          `https://api.github.com/repos/${config.headOwner}/${config.headRepo}/contents${suffix}?ref=${encodeURIComponent(config.branch)}`,
          { headers: githubHeaders(config.githubToken) }
        );

        if (!res.ok)
          throw new Error(`GitHub API ${res.status}: ${normalizedPath || "."}`);

        const data = (await res.json()) as Array<{
          name: string;
          path: string;
          type: string;
        }>;
        return data.map((entry) => ({
          name: entry.name,
          path: entry.path,
          type: entry.type,
        }));
      },
    }),
    readFile: tool({
      description:
        "Read file content from the PR head branch, returning both content and the current blob SHA",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        const res = await fetch(
          `https://api.github.com/repos/${config.headOwner}/${config.headRepo}/contents/${encodePath(path)}?ref=${encodeURIComponent(config.branch)}`,
          { headers: githubHeaders(config.githubToken) }
        );

        if (!res.ok) throw new Error(`GitHub API ${res.status}: ${path}`);

        const data = (await res.json()) as { content: string; sha: string };
        return {
          path,
          sha: data.sha,
          content: Buffer.from(data.content, "base64").toString(),
        };
      },
    }),
    updateFile: tool({
      description:
        "Commit a small text-file update directly to the existing PR head branch. Intended for safe, minimal fixes; binary files and very large files (>1MB) are not supported because GitHub's contents API does not return their content inline, which prevents an accurate diff.",
      inputSchema: z.object({
        path: z.string(),
        content: z.string(),
        message: z.string(),
      }),
      execute: async ({ path, content, message }) => {
        const currentRes = await fetch(
          `https://api.github.com/repos/${config.headOwner}/${config.headRepo}/contents/${encodePath(path)}?ref=${encodeURIComponent(config.branch)}`,
          { headers: githubHeaders(config.githubToken) }
        );

        let sha: string | undefined;
        let previousContent: string | null = null;
        // Tracks whether we have a trustworthy previousContent. GitHub's
        // contents endpoint returns `encoding: "none"` (with `content: ""`) for
        // files larger than 1MB and may return non-base64 encodings for other
        // edge cases. In those situations we cannot honestly diff the change,
        // so we suppress the synthetic patch rather than emit a misleading
        // "previously empty" / "new file" diff.
        let previousContentKnown = false;
        if (currentRes.ok) {
          const currentData = (await currentRes.json()) as {
            content?: string;
            encoding?: string;
            sha: string;
          };
          sha = currentData.sha;
          if (
            currentData.encoding === "base64" &&
            typeof currentData.content === "string"
          ) {
            previousContent = Buffer.from(
              currentData.content,
              "base64"
            ).toString();
            previousContentKnown = true;
          }
        } else if (currentRes.status === 404) {
          // File does not exist yet — this is a genuine new-file case.
          previousContentKnown = true;
        } else {
          return { success: false, error: `GitHub API ${currentRes.status}` };
        }

        const res = await fetch(
          `https://api.github.com/repos/${config.headOwner}/${config.headRepo}/contents/${encodePath(path)}`,
          {
            method: "PUT",
            headers: {
              ...githubHeaders(config.githubToken),
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message,
              content: Buffer.from(content).toString("base64"),
              branch: config.branch,
              ...(sha ? { sha } : {}),
            }),
          }
        );

        if (!res.ok)
          return { success: false, error: `GitHub API ${res.status}` };

        const data = (await res.json()) as {
          commit?: { sha?: string; html_url?: string | null };
          content?: { path?: string };
        };

        return {
          success: true,
          branch: config.branch,
          path: data.content?.path ?? path,
          commitSha: data.commit?.sha ?? null,
          commitUrl: data.commit?.html_url ?? null,
          patch: previousContentKnown
            ? buildUpdateFilePatch(path, previousContent, content)
            : null,
        };
      },
    }),
    reportFix: tool({
      description:
        "Record the structured fix result for workflow observability. Call once before finishing.",
      inputSchema: z.object({
        applied: z.boolean(),
        summary: z.string(),
        updatedFiles: z.array(z.string()).max(20).optional(),
      }),
      execute: async (input) => input,
    }),
  };
}

export function buildSandboxPRFixTools(config: {
  githubToken: string;
  owner: string;
  repo: string;
  headOwner: string;
  headRepo: string;
  prNumber: number;
  branch: string;
  sandbox: SandboxFileAccess;
  rootDirectory?: string | null;
}) {
  const githubTools = buildPRFixTools(config);
  const targetRepoFullName = `${config.headOwner}/${config.headRepo}`;
  const sandboxCwd = config.rootDirectory || undefined;

  async function listSandboxFiles(path: string) {
    const normalizedPath = path.trim() ? normalizeRepoPath(path) : ".";
    const sandboxPath =
      normalizedPath === "."
        ? "."
        : stripSandboxRootDirectory(normalizedPath, config.rootDirectory);
    const script = [
      "const fs = require('fs');",
      "const target = process.argv[1] || '.';",
      "const entries = fs.readdirSync(target, { withFileTypes: true })",
      "  .map((entry) => ({ name: entry.name, path: target === '.' ? entry.name : target + '/' + entry.name, type: entry.isDirectory() ? 'dir' : 'file' }));",
      "console.log(JSON.stringify(entries));",
    ].join("\n");
    const result = await config.sandbox.runCommand({
      cmd: "node",
      args: ["-e", script, sandboxPath],
      cwd: sandboxCwd,
    });
    if (result.exitCode !== 0) {
      const stderr = await readCommandOutput(result, "stderr");
      throw new Error(stderr || `Failed to list ${normalizedPath}`);
    }
    const stdout = await readCommandOutput(result, "stdout");
    return JSON.parse(stdout) as Array<{
      name: string;
      path: string;
      type: string;
    }>;
  }

  async function commitSandboxFile(input: { path: string; message: string }) {
    const result = await config.sandbox.runCommand({
      cmd: "sh",
      args: [
        "-lc",
        [
          'git config user.name "Mogplex Automation"',
          'git config user.email "automation@mogplex.com"',
          'git remote set-url origin "https://x-access-token:$GITHUB_TOKEN@github.com/$GITHUB_REPOSITORY.git"',
          'git add -- "$MOGPLEX_FILE"',
          'if git diff --cached --quiet -- "$MOGPLEX_FILE"; then echo __MOGPLEX_NO_CHANGES__; exit 0; fi',
          'git commit -m "$MOGPLEX_COMMIT_MESSAGE" -- "$MOGPLEX_FILE"',
          'git push origin HEAD:"$MOGPLEX_BRANCH"',
          "git rev-parse HEAD",
        ].join("\n"),
      ],
      cwd: sandboxCwd,
      env: {
        GITHUB_TOKEN: config.githubToken,
        GITHUB_REPOSITORY: targetRepoFullName,
        MOGPLEX_BRANCH: config.branch,
        MOGPLEX_COMMIT_MESSAGE:
          input.message.trim() || `Apply PR autofix for #${config.prNumber}`,
        MOGPLEX_FILE: input.path,
      },
    });

    const stdout = await readCommandOutput(result, "stdout");
    const stderr = await readCommandOutput(result, "stderr");

    if (stdout.includes("__MOGPLEX_NO_CHANGES__")) {
      return {
        success: false as const,
        error: "No file changes to commit",
      };
    }

    if (result.exitCode !== 0) {
      return {
        success: false as const,
        error: stderr || stdout || `git exited with ${result.exitCode}`,
      };
    }

    const commitSha = extractCommitSha(stdout);
    return {
      success: true as const,
      commitSha,
      commitUrl: buildCommitUrl(targetRepoFullName, commitSha),
    };
  }

  return {
    getPullRequest: githubTools.getPullRequest,
    listChangedFiles: githubTools.listChangedFiles,
    listFiles: tool({
      description:
        "List files in a repository directory from the sandboxed PR branch checkout",
      inputSchema: z.object({ path: z.string().default("") }),
      execute: async ({ path }) => listSandboxFiles(path),
    }),
    readFile: tool({
      description: "Read file content from the sandboxed PR branch checkout",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        const normalizedPath = normalizeRepoPath(path);
        const sandboxPath = stripSandboxRootDirectory(
          normalizedPath,
          config.rootDirectory
        );
        const resolvedPath = resolveSandboxPath(
          config.rootDirectory,
          sandboxPath
        );
        const buffer = await config.sandbox.readFileToBuffer({
          path: resolvedPath,
        });
        if (!buffer) throw new Error(`File not found: ${normalizedPath}`);

        return {
          path: normalizedPath,
          sha: null,
          content: buffer.toString("utf-8"),
        };
      },
    }),
    updateFile: tool({
      description:
        "Write a small text-file update inside the sandboxed PR checkout, commit it, and push it back to the existing PR head branch. Do not use for binary files.",
      inputSchema: z.object({
        path: z.string(),
        content: z.string(),
        message: z.string(),
      }),
      execute: async ({ path, content, message }) => {
        const normalizedPath = normalizeRepoPath(path);
        const sandboxPath = stripSandboxRootDirectory(
          normalizedPath,
          config.rootDirectory
        );
        const resolvedPath = resolveSandboxPath(
          config.rootDirectory,
          sandboxPath
        );
        const previous = await config.sandbox
          .readFileToBuffer({ path: resolvedPath })
          .catch(() => null);
        const previousContent = previous ? previous.toString("utf-8") : null;
        const parent = parentDirectory(resolvedPath);

        if (parent) {
          const mkdir = await config.sandbox.runCommand({
            cmd: "mkdir",
            args: ["-p", parent],
          });
          if (mkdir.exitCode !== 0) {
            return {
              success: false,
              error:
                (await readCommandOutput(mkdir, "stderr")) ||
                `Failed to create ${parent}`,
            };
          }
        }

        await config.sandbox.writeFiles([
          { path: resolvedPath, content: Buffer.from(content) },
        ]);

        const commit = await commitSandboxFile({
          path: sandboxPath,
          message,
        });

        if (!commit.success) {
          return commit;
        }

        return {
          success: true,
          branch: config.branch,
          path: normalizedPath,
          commitSha: commit.commitSha,
          commitUrl: commit.commitUrl,
          patch: buildUpdateFilePatch(normalizedPath, previousContent, content),
        };
      },
    }),
    reportFix: githubTools.reportFix,
  };
}
