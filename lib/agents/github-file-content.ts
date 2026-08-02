import { isUtf8 } from "node:buffer";

// Shared guards for returning GitHub Contents API responses to a model:
// validate the response shape, detect binary payloads, and bound how much
// text a single run can consume. Originally inline in the PR reviewer;
// extracted so every file-reading toolset applies the same safeguards.

export const GITHUB_FILE_CONTENT_CHAR_LIMIT = 20_000;
export const GITHUB_TEXT_CONTEXT_CHAR_LIMIT = 80_000;
const BINARY_DETECTION_SAMPLE_BYTES = 8_192;

export type GitHubFileContent = {
  content?: string;
  encoding?: string;
  size?: number;
  type?: string;
};

export type PreparedGitHubFile =
  | { kind: "message"; content: string }
  | { kind: "text"; content: string };

export type BoundedText = {
  content: string;
  exhausted: boolean;
  originalLength: number;
  truncated: boolean;
};

// Per-run text budget: each consume() call returns at most perItemLimit
// characters and the total across calls never exceeds totalLimit, so one
// oversized file cannot exhaust the model context.
export function createTextContextBudget(totalLimit: number) {
  let consumed = 0;
  return {
    consume(content: string, perItemLimit: number): BoundedText {
      const remaining = Math.max(totalLimit - consumed, 0);
      const returned = content.slice(0, Math.min(perItemLimit, remaining));
      consumed += returned.length;
      return {
        content: returned,
        exhausted: returned.length === 0 && content.length > 0,
        originalLength: content.length,
        truncated: returned.length < content.length,
      };
    },
  };
}

// Rejects dot segments outright: encodeURIComponent leaves "." and ".."
// untouched, and URL normalization would resolve them out of the /contents/
// prefix (path traversal into other API endpoints).
export function encodeGitHubContentPath(path: string) {
  const segments = path.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`Invalid repository path: ${path}`);
  }
  return segments.map((segment) => encodeURIComponent(segment)).join("/");
}

function isProbablyBinaryFile(content: Buffer) {
  if (content.length === 0) return false;

  if (!isUtf8(content) || content.includes(0)) return true;

  const sample = content.subarray(
    0,
    Math.min(content.length, BINARY_DETECTION_SAMPLE_BYTES)
  );

  let controlCharacters = 0;
  for (const byte of sample) {
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
      controlCharacters += 1;
    }
  }

  return controlCharacters / sample.length > 0.1;
}

function formatFileSize(size: number | null) {
  return size == null ? "unknown size" : `${size} bytes`;
}

function normalizeFileSize(size: unknown) {
  if (typeof size !== "number") return null;
  return size >= 0 ? size : null;
}

// One-call guard for read-only file tools: validate the response, then bound
// it against the run's shared budget. Writer toolsets must NOT use this —
// truncated content written back through an update tool silently destroys the
// file's tail; they should refuse oversized files instead.
export function readBoundedGitHubTextFile(
  budget: ReturnType<typeof createTextContextBudget>,
  data: GitHubFileContent | GitHubFileContent[],
  path: string
): string {
  const prepared = prepareGitHubTextFile(data, path);
  if (prepared.kind === "message") return prepared.content;

  const bounded = budget.consume(
    prepared.content,
    GITHUB_FILE_CONTENT_CHAR_LIMIT
  );
  if (bounded.exhausted) {
    return `File content omitted: the ${GITHUB_TEXT_CONTEXT_CHAR_LIMIT}-character text-context budget is exhausted.`;
  }
  if (!bounded.truncated) return bounded.content;

  return `${bounded.content}\n\n[Truncated ${path}: returned ${bounded.content.length} of ${bounded.originalLength} characters. The text-context budget is ${GITHUB_TEXT_CONTEXT_CHAR_LIMIT} characters.]`;
}

export function prepareGitHubTextFile(
  data: GitHubFileContent | GitHubFileContent[],
  path: string
): PreparedGitHubFile {
  if (Array.isArray(data)) {
    return {
      kind: "message",
      content: `File content omitted from text review: ${path} is a directory. Fetch a specific file path instead.`,
    };
  }

  const declaredSize = normalizeFileSize(data.size);

  if (data.type && data.type !== "file") {
    return {
      kind: "message",
      content: `File content omitted from text review: ${path} is a ${data.type}, not a file.`,
    };
  }

  if (typeof data.content !== "string") {
    return {
      kind: "message",
      content: `File content unavailable for text review: ${path} (${formatFileSize(declaredSize)}; GitHub encoding: ${data.encoding ?? "unknown"}).`,
    };
  }

  if (data.encoding != null && data.encoding !== "base64") {
    return {
      kind: "message",
      content: `File content unavailable for text review: ${path} (${formatFileSize(declaredSize)}; GitHub encoding: ${data.encoding}).`,
    };
  }

  const bytes = Buffer.from(data.content, "base64");
  const fileSize = declaredSize ?? bytes.length;

  if (isProbablyBinaryFile(bytes)) {
    return {
      kind: "message",
      content: `Binary file omitted from text review: ${path} (${formatFileSize(fileSize)}). Use a binary-aware image or asset inspection path instead.`,
    };
  }

  return { kind: "text", content: bytes.toString("utf8") };
}
