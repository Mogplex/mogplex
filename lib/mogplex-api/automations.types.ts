import type { FlowGraph } from "@/lib/types";

export type MogplexApiAutomation = {
  id: string;
  installationId: number;
  name: string;
  description: string | null;
  notes: string | null;
  status: "active" | "inactive";
  draftGraph: FlowGraph;
  publishedVersion: {
    id: string;
    versionNumber: number;
    graph: FlowGraph;
    createdAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
  runSummary: {
    lastRunId: string | null;
    lastRunStatus: string | null;
    runningCount: number;
    pendingCount: number;
    failed24h: number;
  };
};

export const MOGPLEX_API_DEFAULT_AUTOMATIONS_LIMIT = 50;
export const MOGPLEX_API_MAX_AUTOMATIONS_LIMIT = 100;

export type MogplexApiAutomationSummary = {
  id: string;
  installationId: number;
  name: string;
  description: string | null;
  status: "active" | "inactive";
  publishedVersionId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MogplexApiAutomationCursor = {
  createdAt: string;
  id: string;
};

export type ListMogplexApiAutomationsOptions = {
  limit?: number;
  cursor?: MogplexApiAutomationCursor | null;
};

export type ListMogplexApiAutomationsResult = {
  automations: MogplexApiAutomationSummary[];
  nextCursor: string | null;
};

export type MogplexApiAutomationSummaryRow = {
  id: string;
  installation_id: number;
  name: string;
  description: string | null;
  status: "active" | "inactive";
  published_version_id: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateMogplexApiAutomationInput = {
  installationId: number;
  name?: string | null;
  description?: string | null;
  notes?: string | null;
  graph?: FlowGraph;
  publish?: boolean;
};

export type UpdateMogplexApiAutomationInput = {
  name?: string;
  description?: string | null;
  notes?: string | null;
  installationId?: number;
  graph?: FlowGraph;
};

export type TriggerMogplexApiAutomationInput = {
  userId: string;
  automationId: string;
  repoId: string;
  idempotencyKey: string;
  input?: Record<string, unknown>;
};

export class MogplexApiAutomationError extends Error {
  constructor(
    public readonly code:
      | "AUTOMATION_INACTIVE"
      | "AUTOMATION_NOT_FOUND"
      | "AUTOMATION_NOT_PUBLISHED"
      | "AUTOMATION_NODE_NOT_FOUND"
      | "AUTOMATION_NODE_NOT_AGENT"
      | "MODEL_NOT_AVAILABLE"
      | "REPO_NOT_FOUND"
      | "REPO_SCOPE_MISMATCH",
    message: string,
    public readonly status: 400 | 404 | 409 = 400
  ) {
    super(message);
    this.name = "MogplexApiAutomationError";
  }
}

const ISO_CURSOR_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const UUID_CURSOR_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function isValidAutomationCursorDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ISO_CURSOR_DATE_PATTERN.test(value) &&
    !Number.isNaN(new Date(value).getTime())
  );
}

function isValidAutomationCursorId(value: unknown): value is string {
  return typeof value === "string" && UUID_CURSOR_PATTERN.test(value);
}

export function encodeMogplexApiAutomationCursor(
  row: Pick<MogplexApiAutomationSummaryRow, "created_at" | "id">
) {
  return Buffer.from(
    JSON.stringify({ createdAt: row.created_at, id: row.id }),
    "utf8"
  ).toString("base64url");
}

export function parseMogplexApiAutomationCursor(
  raw: string | null
): MogplexApiAutomationCursor | null | undefined {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8")
    ) as { createdAt?: unknown; id?: unknown };
    if (
      isValidAutomationCursorDate(parsed.createdAt) &&
      isValidAutomationCursorId(parsed.id)
    ) {
      return { createdAt: parsed.createdAt, id: parsed.id };
    }
  } catch {
    // Invalid opaque cursors are rejected by the route before querying.
  }

  return undefined;
}

export function presentMogplexApiAutomationSummary(
  row: MogplexApiAutomationSummaryRow
): MogplexApiAutomationSummary {
  return {
    id: row.id,
    installationId: row.installation_id,
    name: row.name,
    description: row.description,
    status: row.status,
    publishedVersionId: row.published_version_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
