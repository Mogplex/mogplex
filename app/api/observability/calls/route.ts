import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/auth";
import { AI_CALL_TYPE_SET } from "@/lib/ai-call-types";
import { isStaleLiveInteractiveCall } from "@/lib/interactive-runs";
import type { NextRequest } from "next/server";
import type { SandboxBillingMode } from "@/lib/sandbox/billing";
import type { AiCall, SandboxCallContext } from "@/lib/types";
import { sanitizeObservabilityPayload } from "@/lib/observability/user-facing-errors";

type AiCallRow = Record<string, unknown>;
type QueryResult = {
  data: AiCallRow[] | null;
  count?: number | null;
  error: { message: string } | null;
};

type QueryLike = {
  eq: (...args: unknown[]) => QueryLike;
  not: (...args: unknown[]) => QueryLike;
  is: (...args: unknown[]) => QueryLike;
  or: (...args: unknown[]) => QueryLike;
  order: (...args: unknown[]) => QueryLike;
  range: (...args: unknown[]) => QueryLike;
  in: (...args: unknown[]) => QueryLike;
  filter: (...args: unknown[]) => QueryLike;
  gte: (...args: unknown[]) => QueryLike;
  lte: (...args: unknown[]) => QueryLike;
  then: PromiseLike<QueryResult>["then"];
};

type ObservabilityCallsGetDeps = {
  requireUserId: typeof requireUserId;
  buildQuery: (
    userId: string,
    page: number,
    limit: number,
    sortCol: string,
    order: boolean
  ) => QueryLike;
  isStaleLiveInteractiveCall: typeof isStaleLiveInteractiveCall;
  loadSandboxRecords: (
    userId: string,
    sandboxRecordIds: string[]
  ) => Promise<SandboxContextRow[]>;
  findRepoIdsByName: (userId: string, namePattern: string) => Promise<string[]>;
};

type SandboxContextRow = {
  id: string;
  sandbox_id: string;
  billing_source?: SandboxBillingMode | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
  vercel_team_id?: string | null;
  vercel_project_id?: string | null;
  preview_url?: string | null;
};

const defaultObservabilityCallsGetDeps: ObservabilityCallsGetDeps = {
  requireUserId,
  buildQuery(userId, page, limit, sortCol, order) {
    let query = supabaseAdmin
      .from("ai_calls")
      .select("*", { count: "exact" })
      .eq("user_id", userId)
      .order(sortCol, { ascending: order }) as unknown as QueryLike;

    if (limit > 0) {
      query = query.range((page - 1) * limit, page * limit - 1);
    }

    return query as QueryLike;
  },
  isStaleLiveInteractiveCall,
  async loadSandboxRecords(userId, sandboxRecordIds) {
    if (sandboxRecordIds.length === 0) return [];
    const { data, error } = await supabaseAdmin
      .from("sandboxes")
      .select(
        "id, sandbox_id, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id, preview_url"
      )
      .eq("user_id", userId)
      .in("id", sandboxRecordIds);

    if (error) {
      console.error("sandbox context query error:", error.message);
      return [];
    }

    return (data as SandboxContextRow[] | null) ?? [];
  },
  async findRepoIdsByName(userId, namePattern) {
    const { data, error } = await supabaseAdmin
      .from("repos")
      .select("id")
      .eq("user_id", userId)
      .ilike("full_name", namePattern)
      .limit(50);

    if (error) {
      console.error("repos search query error:", error.message);
      return [];
    }
    return ((data as { id: string }[] | null) ?? []).map((row) => row.id);
  },
};

// Supabase/PostgREST v14.4 accepts JSON accessors inside inline `or()`
// predicates. Keep the DB smoke coverage in observability-calls-route.test.ts
// if these strings change.
export const OBSERVABILITY_SURFACE_OR_FILTERS = {
  // runtime_command_id IS NOT NULL OR metadata->>'source' = 'cli'
  cliSurface: "runtime_command_id.not.is.null,metadata->>source.eq.cli",
  // metadata->>'source' IS NULL OR metadata->>'source' != 'cli'
  nonCliMetadataSource: "metadata->>source.is.null,metadata->>source.neq.cli",
} as const;

function normalizeOptionalText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Free-text search input. Applied to user input before it lands in a
// PostgREST `.or()` clause, so the output needs to be safe inside that
// grammar. Strategy: allowlist the chars users actually search for
// (alphanumerics, slash, hyphen, dot, underscore, hash, at, colon, space),
// reject anything below a meaningful length, escape ilike wildcards, then
// hand the caller two forms:
//   - `inner` for ilike (with %s and escaped wildcards)
//   - `quoted` ready to drop into a PostgREST or() fragment (wrapped in
//     double quotes; backslashes doubled per PostgREST quoted-string rules)
// Minimum length 2 keeps single-keystroke inputs from triggering a wide
// scan across model/conversation_id/metadata->>pr_number plus a repos
// pre-query.
const SEARCH_MIN_LENGTH = 2;
const SEARCH_ALLOWED_CHARS = /[^A-Za-z0-9\s\-_./#@:]/g;

function buildSearchPattern(
  raw: string | null
): { inner: string; quoted: string } | null {
  if (!raw) return null;
  const cleaned = raw.replace(SEARCH_ALLOWED_CHARS, "").trim();
  if (cleaned.length < SEARCH_MIN_LENGTH) return null;
  const ilikeEscaped = cleaned.replace(/[\\%_]/g, (match) => `\\${match}`);
  const inner = `%${ilikeEscaped}%`;
  // PostgREST quoted-string values escape `\` and `"` with a backslash. The
  // allowlist already filtered out `"`, so only `\` needs doubling here.
  const quoted = `"${inner.replace(/\\/g, "\\\\")}"`;
  return { inner, quoted };
}

function readSandboxRecordId(call: AiCallRow): string | null {
  const { metadata } = call;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    return null;
  const sandboxRecordId = (metadata as Record<string, unknown>)
    .sandbox_record_id;
  return normalizeOptionalText(sandboxRecordId);
}

function buildSandboxContext(row: SandboxContextRow): SandboxCallContext {
  return {
    sandbox_record_id: row.id,
    sandbox_id: row.sandbox_id,
    compute_billing_source:
      row.billing_source === "user_vercel_project"
        ? "user_vercel_project"
        : "platform",
    billing_project_id:
      normalizeOptionalText(row.billing_project_id) ??
      normalizeOptionalText(row.vercel_project_id),
    billing_team_id:
      normalizeOptionalText(row.billing_team_id) ??
      normalizeOptionalText(row.vercel_team_id),
    preview_url: normalizeOptionalText(row.preview_url),
  };
}

async function attachSandboxContexts(
  userId: string,
  calls: AiCallRow[],
  deps: Pick<ObservabilityCallsGetDeps, "loadSandboxRecords">
): Promise<AiCall[]> {
  const sandboxRecordIds = Array.from(
    new Set(
      calls
        .map((call) => readSandboxRecordId(call))
        .filter(
          (sandboxRecordId): sandboxRecordId is string =>
            typeof sandboxRecordId === "string"
        )
    )
  );

  if (sandboxRecordIds.length === 0) {
    return calls as AiCall[];
  }

  const sandboxRecords = await deps.loadSandboxRecords(
    userId,
    sandboxRecordIds
  );
  const sandboxContextById = new Map(
    sandboxRecords.map((row) => [row.id, buildSandboxContext(row)])
  );

  return calls.map((call) => {
    const sandboxRecordId = readSandboxRecordId(call);
    if (!sandboxRecordId) {
      return call as AiCall;
    }

    return {
      ...(call as AiCall),
      sandbox_context: sandboxContextById.get(sandboxRecordId) ?? null,
    } satisfies AiCall;
  });
}

function applySharedFilters(
  query: QueryLike,
  input: {
    surface: string | null;
    type: string | null;
    model: string | null;
    status: string | null;
    repoId: string | null;
    sandboxRecordId: string | null;
    conversationId: string | null;
    agentId: string | null;
    slackAttributionMode: string | null;
    from: string | null;
    to: string | null;
  }
) {
  let nextQuery = query;
  const validStatuses = new Set([
    "pending",
    "streaming",
    "success",
    "failed",
    "cancelled",
  ]);

  switch (input.surface) {
    case "live": {
      nextQuery = nextQuery.in("status", ["pending", "streaming"]);

      break;
    }
    case "cli": {
      // CLI surface covers two recording paths: harness exec runs (which set
      // runtime_command_id) and the OpenAI-compat CLI inference shim (which
      // only stamps metadata.source = "cli"). Either marker counts.
      // Exclude job-backed automation rows first so this SQL filter preserves
      // deriveSurface's automation-before-CLI precedence.
      nextQuery = nextQuery
        .is("job_run_id", null)
        .or(OBSERVABILITY_SURFACE_OR_FILTERS.cliSurface);

      break;
    }
    case "cloud": {
      nextQuery = nextQuery
        .is("job_run_id", null)
        .is("runtime_command_id", null)
        .or(OBSERVABILITY_SURFACE_OR_FILTERS.nonCliMetadataSource)
        .not("status", "in", "(pending,streaming)");

      break;
    }
    case "automation": {
      nextQuery = nextQuery.not("job_run_id", "is", null);

      break;
    }
    // No default
  }

  if (input.type && AI_CALL_TYPE_SET.has(input.type))
    nextQuery = nextQuery.eq("type", input.type);
  if (input.model) nextQuery = nextQuery.eq("model", input.model);
  if (input.status && validStatuses.has(input.status))
    nextQuery = nextQuery.eq("status", input.status);
  if (input.repoId) nextQuery = nextQuery.eq("repo_id", input.repoId);
  if (input.sandboxRecordId)
    nextQuery = nextQuery.filter(
      "metadata->>sandbox_record_id",
      "eq",
      input.sandboxRecordId
    );
  if (input.conversationId)
    nextQuery = nextQuery.eq("conversation_id", input.conversationId);
  if (input.agentId)
    nextQuery = nextQuery.filter("metadata->>agent_id", "eq", input.agentId);
  if (
    input.slackAttributionMode &&
    [
      "mapped_profile",
      "legacy_email",
      "installer_fallback",
      "unmapped",
    ].includes(input.slackAttributionMode)
  ) {
    nextQuery = nextQuery.filter(
      "metadata->>slack_attribution_mode",
      "eq",
      input.slackAttributionMode
    );
  }
  if (input.from) nextQuery = nextQuery.gte("started_at", input.from);
  if (input.to) nextQuery = nextQuery.lte("started_at", input.to);

  return nextQuery;
}

export function createObservabilityCallsGetHandler(
  overrides: Partial<ObservabilityCallsGetDeps> = {}
) {
  const deps: ObservabilityCallsGetDeps = {
    ...defaultObservabilityCallsGetDeps,
    ...overrides,
  };

  return async function GET(req: NextRequest) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const params = req.nextUrl.searchParams;
    const page = Math.max(1, Number.parseInt(params.get("page") || "1"));
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(params.get("limit") || "50"))
    );
    const sort = params.get("sort") || "started_at";
    const order = params.get("order") === "asc";
    const surface = params.get("surface");
    const type = params.get("type");
    const model = params.get("model");
    const status = params.get("status");
    const repoId = params.get("repo_id");
    const sandboxRecordId = params.get("sandbox_record_id");
    const liveOnly = params.get("live_only") === "true";
    const from = params.get("from");
    const to = params.get("to");
    const conversationId = params.get("conversation_id");
    const agentId = params.get("agent_id");
    const slackAttributionMode = params.get("slack_attribution_mode");
    const searchPattern = buildSearchPattern(params.get("q"));
    const searchRepoIds = searchPattern
      ? await deps.findRepoIdsByName(userId, searchPattern.inner)
      : [];
    const searchOrClauses = searchPattern
      ? [
          `model.ilike.${searchPattern.quoted}`,
          `conversation_id.ilike.${searchPattern.quoted}`,
          `metadata->>pr_number.ilike.${searchPattern.quoted}`,
          searchRepoIds.length > 0
            ? `repo_id.in.(${searchRepoIds.join(",")})`
            : null,
        ].filter((clause): clause is string => clause !== null)
      : [];
    // Never pass "" to PostgREST's .or() — collapse to null so the call site
    // can skip the filter entirely. (Today the three ilike entries guarantee
    // non-empty when searchPattern is set; this keeps the invariant explicit.)
    const searchOrClause =
      searchOrClauses.length > 0 ? searchOrClauses.join(",") : null;

    const allowedSorts = new Set([
      "started_at",
      "model",
      "type",
      "duration_ms",
      "status",
    ]);
    const sortCol = allowedSorts.has(sort) ? sort : "started_at";

    const filterInput = {
      surface,
      type,
      model,
      status,
      repoId,
      sandboxRecordId,
      conversationId,
      agentId,
      slackAttributionMode,
      from,
      to,
    };

    if (liveOnly) {
      let liveQuery = deps
        .buildQuery(userId, 1, 0, sortCol, order)
        .in("type", ["chat", "agent"])
        .in("status", ["pending", "streaming"]);
      liveQuery = applySharedFilters(liveQuery, filterInput);
      if (searchOrClause) liveQuery = liveQuery.or(searchOrClause);

      const { data, error } = await liveQuery;
      if (error) {
        console.error("ai_calls query error:", error.message);
        return NextResponse.json(
          { error: "Failed to fetch calls" },
          { status: 500 }
        );
      }

      const filteredLiveCalls = ((data as AiCallRow[] | null) ?? []).filter(
        (call) => !deps.isStaleLiveInteractiveCall(call as never)
      );
      const pagedCalls = filteredLiveCalls.slice(
        (page - 1) * limit,
        page * limit
      );
      const calls = (await attachSandboxContexts(userId, pagedCalls, deps)).map(
        (call) => sanitizeObservabilityPayload(call, "CALL", call.id)
      );

      return NextResponse.json({
        calls,
        total: filteredLiveCalls.length,
        page,
        limit,
      });
    }

    let query = deps.buildQuery(userId, page, limit, sortCol, order);
    query = applySharedFilters(query, filterInput);
    if (searchOrClause) query = query.or(searchOrClause);

    const { data, count, error } = await query;

    if (error) {
      console.error("ai_calls query error:", error.message);
      return NextResponse.json(
        { error: "Failed to fetch calls" },
        { status: 500 }
      );
    }

    const calls = (
      await attachSandboxContexts(
        userId,
        (data as AiCallRow[] | null) ?? [],
        deps
      )
    ).map((call) => sanitizeObservabilityPayload(call, "CALL", call.id));

    return NextResponse.json({
      calls,
      total: count || 0,
      page,
      limit,
    });
  };
}

export const GET = createObservabilityCallsGetHandler();
