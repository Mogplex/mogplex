/**
 * Sandbox-backed file tools for the workspace agent. Every operation runs
 * against the live checkout through /api/sandbox/{id}/files, so the agent
 * sees its own uncommitted edits, and every mutation returns a unified diff
 * for the transcript.
 */
import { z } from "zod";
import { buildUnifiedDiff } from "@/lib/diffs/unified";
import { defineTool, resolveAppBaseUrl } from "./shared";
import { getSandboxRequestHeaders } from "./sandbox-resolution";
import {
  readSelectedSandboxId,
  type SandboxSelection,
} from "./sandbox-binding";

const READ_CHAR_LIMIT = 60_000;
const DEFAULT_READ_LINES = 2_000;

type FileToolFailure = {
  error: string;
  reason:
    | "sandbox_pending"
    | "sandbox_not_selected"
    | "auth_unavailable"
    | "operation_failed"
    | "file_not_found";
  path?: string;
};

type SandboxFileTarget = { sandboxId: string; headers: HeadersInit };
type HeadersResult = ReturnType<typeof getSandboxRequestHeaders>;

function isHeadersFailure(
  result: HeadersResult
): result is Extract<HeadersResult, { reason: "auth_unavailable" }> {
  return "error" in result;
}

function resolveTarget(
  userId: string | undefined,
  selection: SandboxSelection
): SandboxFileTarget | FileToolFailure {
  if (typeof selection === "object" && selection.status === "pending") {
    return {
      error: "Sandbox startup is still in progress.",
      reason: "sandbox_pending",
    };
  }
  const sandboxId = readSelectedSandboxId(selection);
  if (!sandboxId) {
    return { error: "Select a sandbox first.", reason: "sandbox_not_selected" };
  }
  const requestHeaders = getSandboxRequestHeaders(userId);
  if (isHeadersFailure(requestHeaders)) {
    return { error: requestHeaders.error, reason: requestHeaders.reason };
  }
  return { sandboxId, headers: requestHeaders.headers };
}

function filesUrl(sandboxId: string) {
  return `${resolveAppBaseUrl()}/api/sandbox/${sandboxId}/files`;
}

async function readErrorMessage(res: Response, fallback: string) {
  const data = (await res.json().catch(() => ({}))) as { error?: unknown };
  return typeof data.error === "string" ? data.error : fallback;
}

export async function readSandboxFile(
  target: SandboxFileTarget,
  path: string
): Promise<{ content: string } | { notFound: true } | { error: string }> {
  const res = await fetch(
    `${filesUrl(target.sandboxId)}?path=${encodeURIComponent(path)}`,
    { headers: target.headers }
  );
  if (res.status === 404) return { notFound: true };
  if (!res.ok) return { error: await readErrorMessage(res, "Read failed") };
  const data = (await res.json()) as { content?: unknown };
  return { content: typeof data.content === "string" ? data.content : "" };
}

async function writeSandboxFile(
  target: SandboxFileTarget,
  path: string,
  content: string
): Promise<{ error: string } | null> {
  const res = await fetch(filesUrl(target.sandboxId), {
    method: "PUT",
    headers: target.headers,
    body: JSON.stringify({ path, content }),
  });
  if (res.ok) return null;
  return { error: await readErrorMessage(res, "Write failed") };
}

function normalizePath(path: string) {
  return path
    .trim()
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
}

const readFileParams = z.object({
  path: z.string().describe("File path relative to the repository root"),
  offset: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("First line to return (1-based). Defaults to 1."),
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(`Maximum lines to return. Defaults to ${DEFAULT_READ_LINES}.`),
});

export function createSandboxReadFile(
  userId?: string,
  selection?: SandboxSelection
) {
  return defineTool({
    description:
      "Read a file from the live sandbox checkout, including uncommitted edits. Output is line-numbered (number, tab, text). Use offset and limit to page through large files.",
    inputSchema: readFileParams,
    execute: async ({
      path,
      offset,
      limit,
    }: z.infer<typeof readFileParams>) => {
      const target = resolveTarget(userId, selection);
      if ("error" in target) return target;
      const normalized = normalizePath(path);
      const read = await readSandboxFile(target, normalized);
      if ("notFound" in read) {
        return {
          error: `File not found: ${normalized}`,
          reason: "file_not_found" as const,
          path: normalized,
        };
      }
      if ("error" in read) {
        return { error: read.error, reason: "operation_failed" as const };
      }
      const allLines = read.content.split("\n");
      if (allLines.at(-1) === "") allLines.pop();
      const startLine = offset ?? 1;
      const maxLines = limit ?? DEFAULT_READ_LINES;
      const selected: string[] = [];
      let chars = 0;
      let endLine = startLine - 1;
      for (let index = startLine - 1; index < allLines.length; index += 1) {
        if (selected.length >= maxLines) break;
        const line = `${index + 1}\t${allLines[index]}`;
        if (chars + line.length > READ_CHAR_LIMIT) break;
        selected.push(line);
        chars += line.length + 1;
        endLine = index + 1;
      }
      return {
        path: normalized,
        content: selected.join("\n"),
        startLine,
        endLine,
        totalLines: allLines.length,
        truncated: startLine > 1 || endLine < allLines.length,
        sandboxId: target.sandboxId,
      };
    },
  });
}

const listFilesParams = z.object({
  path: z
    .string()
    .default(".")
    .describe("Directory path relative to the repository root"),
});

export function createSandboxListFiles(
  userId?: string,
  selection?: SandboxSelection
) {
  return defineTool({
    description:
      "List a directory in the live sandbox checkout. Prefer bash with find or rg for recursive searches.",
    inputSchema: listFilesParams,
    execute: async ({ path }: z.infer<typeof listFilesParams>) => {
      const target = resolveTarget(userId, selection);
      if ("error" in target) return target;
      const normalized = normalizePath(path) || ".";
      const res = await fetch(filesUrl(target.sandboxId), {
        method: "POST",
        headers: target.headers,
        body: JSON.stringify({ path: normalized }),
      });
      if (!res.ok) {
        return {
          error: await readErrorMessage(res, "List failed"),
          reason: "operation_failed" as const,
        };
      }
      const data = (await res.json()) as {
        entries?: { name: string; isDir: boolean; size: number }[];
      };
      return {
        path: normalized,
        files: (data.entries ?? []).map((entry) => ({
          name: entry.name,
          type: entry.isDir ? ("dir" as const) : ("file" as const),
          size: entry.size,
        })),
        sandboxId: target.sandboxId,
      };
    },
  });
}

const editFileParams = z.object({
  path: z.string().describe("File path relative to the repository root"),
  old_string: z
    .string()
    .min(1)
    .describe(
      "Exact text to replace. Must match once unless replace_all is true; include surrounding lines to make it unique."
    ),
  new_string: z.string().describe("Replacement text"),
  replace_all: z
    .boolean()
    .optional()
    .describe("Replace every occurrence instead of requiring a unique match"),
});

function countOccurrences(haystack: string, needle: string) {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

export function createEditFile(userId?: string, selection?: SandboxSelection) {
  return defineTool({
    description:
      "Make a targeted edit to a file in the live sandbox checkout by replacing exact text. Read the file first so old_string matches exactly. Returns the unified diff that was applied.",
    inputSchema: editFileParams,
    execute: async ({
      path,
      old_string: oldString,
      new_string: newString,
      replace_all: replaceAll,
    }: z.infer<typeof editFileParams>) => {
      const target = resolveTarget(userId, selection);
      if ("error" in target) return target;
      const normalized = normalizePath(path);
      if (oldString === newString) {
        return {
          error: "old_string and new_string are identical.",
          reason: "no_change" as const,
          path: normalized,
        };
      }
      const read = await readSandboxFile(target, normalized);
      if ("notFound" in read) {
        return {
          error: `File not found: ${normalized}. Use write_file to create it.`,
          reason: "file_not_found" as const,
          path: normalized,
        };
      }
      if ("error" in read) {
        return { error: read.error, reason: "operation_failed" as const };
      }
      const matches = countOccurrences(read.content, oldString);
      if (matches === 0) {
        return {
          error: `old_string was not found in ${normalized}. Read the file and copy the text exactly.`,
          reason: "no_match" as const,
          path: normalized,
        };
      }
      if (matches > 1 && !replaceAll) {
        return {
          error: `old_string matches ${matches} places in ${normalized}. Include more surrounding context or set replace_all.`,
          reason: "ambiguous_match" as const,
          path: normalized,
          matches,
        };
      }
      const after = replaceAll
        ? read.content.split(oldString).join(newString)
        : read.content.replace(oldString, () => newString);
      const failure = await writeSandboxFile(target, normalized, after);
      if (failure) {
        return { error: failure.error, reason: "operation_failed" as const };
      }
      return {
        ok: true as const,
        path: normalized,
        replacements: replaceAll ? matches : 1,
        diff: buildUnifiedDiff({
          path: normalized,
          before: read.content,
          after,
        }),
        sandboxId: target.sandboxId,
      };
    },
  });
}

const writeFileParams = z.object({
  path: z.string().describe("File path relative to sandbox root"),
  content: z.string().describe("File content to write"),
});

export function createWriteFile(userId?: string, selection?: SandboxSelection) {
  return defineTool({
    description:
      "Create or overwrite a whole file in the server-selected sandbox checkout; the sandbox identity follows the session and cannot be supplied by the model. For changes to an existing file prefer edit_file. Returns the unified diff that was applied.",
    inputSchema: writeFileParams,
    execute: async ({ path, content }: z.infer<typeof writeFileParams>) => {
      const target = resolveTarget(userId, selection);
      if ("error" in target) return target;
      const normalized = normalizePath(path);
      const existing = await readSandboxFile(target, normalized);
      if ("error" in existing) {
        return { error: existing.error, reason: "operation_failed" as const };
      }
      const before = "notFound" in existing ? null : existing.content;
      const failure = await writeSandboxFile(target, normalized, content);
      if (failure) {
        return { error: failure.error, reason: "operation_failed" as const };
      }
      return {
        ok: true as const,
        path: normalized,
        sandboxId: target.sandboxId,
        created: before === null,
        diff: buildUnifiedDiff({ path: normalized, before, after: content }),
      };
    },
  });
}
