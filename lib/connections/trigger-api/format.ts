const MAX_JSON_CHARS = 6_000;
const MAX_TEXT_CHARS = 8_000;
const MAX_SCHEMA_CHARS = 1_500;

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json {
  return value && typeof value === "object" ? (value as Json) : {};
}

function pick(source: Json, keys: string[]): Json {
  const picked: Json = {};
  for (const key of keys) {
    if (source[key] != null) picked[key] = source[key];
  }
  return picked;
}

/** Keep a value whole when it is small; otherwise hand back a marked preview. */
export function capJson(value: unknown, maxChars = MAX_JSON_CHARS): unknown {
  const serialized = JSON.stringify(value) ?? "null";
  if (serialized.length <= maxChars) return value;
  return { truncated: true, preview: serialized.slice(0, maxChars) };
}

export function capText(text: string, maxChars = MAX_TEXT_CHARS): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[truncated]`;
}

export function summarizeProject(project: unknown): Json {
  const source = asRecord(project);
  return {
    // The API calls it externalRef; every other tool takes it as projectRef.
    projectRef: source.externalRef,
    ...pick(source, ["name", "slug"]),
    organization: pick(asRecord(source.organization), ["title", "slug"]),
  };
}

export function summarizeRun(run: unknown): Json {
  return pick(asRecord(run), [
    "id",
    "status",
    "taskIdentifier",
    "version",
    "createdAt",
    "startedAt",
    "finishedAt",
    "durationMs",
    "costInCents",
    "tags",
    "isTest",
  ]);
}

export function summarizeTask(task: unknown): Json {
  const source = asRecord(task);
  return {
    ...pick(source, ["slug", "filePath", "triggerSource"]),
    ...(source.payloadSchema == null
      ? {}
      : { payloadSchema: capJson(source.payloadSchema, MAX_SCHEMA_CHARS) }),
  };
}

export function summarizeDeployment(deployment: unknown): Json {
  const source = asRecord(deployment);
  return {
    ...pick(source, [
      "id",
      "shortCode",
      "version",
      "status",
      "createdAt",
      "deployedAt",
      "runtime",
      "runtimeVersion",
    ]),
    ...(source.git == null ? {} : { git: summarizeGit(source.git) }),
  };
}

function summarizeGit(git: unknown): Json {
  const summary = pick(asRecord(git), [
    "branch",
    "commitSha",
    "commitMessage",
    "commitAuthorName",
    "pullRequestNumber",
  ]);
  if (typeof summary.commitMessage === "string") {
    summary.commitMessage = summary.commitMessage.split("\n", 1)[0];
  }
  return summary;
}

type TraceLine = {
  depth: number;
  message: unknown;
  level?: unknown;
  durationMs?: number;
  isError?: true;
  events?: unknown;
};

const NANOSECONDS_PER_MS = 1_000_000;

function toTraceLine(span: Json, depth: number): TraceLine {
  const data = asRecord(span.data);
  const line: TraceLine = { depth, message: data.message, level: data.level };
  if (typeof data.duration === "number") {
    line.durationMs = Math.round(data.duration / NANOSECONDS_PER_MS);
  }
  if (data.isError === true) {
    line.isError = true;
    // Span events carry the exception; only errors are worth the space.
    if (Array.isArray(data.events) && data.events.length > 0) {
      line.events = capJson(data.events, MAX_SCHEMA_CHARS);
    }
  }
  return line;
}

/** Depth-first list of the span tree, cut off at `maxLines`. */
export function flattenTrace(rootSpan: unknown, maxLines: number) {
  const lines: TraceLine[] = [];
  let truncated = false;

  const visit = (span: unknown, depth: number) => {
    if (!span || typeof span !== "object") return;
    if (lines.length >= maxLines) {
      truncated = true;
      return;
    }
    const record = span as Json;
    lines.push(toTraceLine(record, depth));
    const children = Array.isArray(record.children) ? record.children : [];
    for (const child of children) visit(child, depth + 1);
  };

  visit(rootSpan, 0);
  return { lines, truncated };
}
