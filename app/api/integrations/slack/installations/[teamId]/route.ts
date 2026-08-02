import { NextResponse } from "next/server";
import { requireUserId as defaultRequireUserId } from "@/lib/auth";
import {
  deleteSlackInstallation,
  updateSlackInstallationPolicy,
} from "@/lib/slack/installations";

type PatchBody = {
  repoAgentEnabled?: unknown;
  allowedSlackUserIds?: unknown;
  monthlyRepoRunLimit?: unknown;
};

type AllowedSlackUserIdsParseResult =
  | { ok: true; value: string[] | null }
  | { ok: false; error: string };

type SlackInstallationRouteDeps = {
  requireUserId: typeof defaultRequireUserId;
  deleteSlackInstallation: typeof deleteSlackInstallation;
  updateSlackInstallationPolicy: typeof updateSlackInstallationPolicy;
};

const defaultDeps: SlackInstallationRouteDeps = {
  requireUserId: defaultRequireUserId,
  deleteSlackInstallation,
  updateSlackInstallationPolicy,
};

function parseAllowedSlackUserIds(
  value: unknown
): AllowedSlackUserIdsParseResult {
  if (value === null) return { ok: true, value: null };
  if (!Array.isArray(value)) {
    return {
      ok: false,
      error: "allowedSlackUserIds must be an array of strings or null",
    };
  }
  // Count submitted entries before trimming so blank padding cannot bypass the
  // limit. An explicit [] is still a valid "allow nobody" policy.
  if (value.length > 100) {
    return {
      ok: false,
      error: "allowedSlackUserIds must contain at most 100 entries",
    };
  }
  const ids = value
    .map((candidate) => (typeof candidate === "string" ? candidate.trim() : ""))
    .filter(Boolean);
  return { ok: true, value: Array.from(new Set(ids)) };
}

function parseMonthlyRepoRunLimit(value: unknown) {
  if (value === null) return null;
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= 10000
  ) {
    return value;
  }
  return undefined;
}

export function createSlackInstallationDeleteHandler(
  overrides: Partial<SlackInstallationRouteDeps> = {}
) {
  const deps: SlackInstallationRouteDeps = { ...defaultDeps, ...overrides };

  return async function DELETE(
    _request: Request,
    context: { params: Promise<{ teamId: string }> }
  ) {
    const userIdOrResponse = await deps.requireUserId();
    if (userIdOrResponse instanceof Response) return userIdOrResponse;

    const { teamId } = await context.params;
    if (!teamId) {
      return NextResponse.json({ error: "Missing teamId" }, { status: 400 });
    }

    await deps.deleteSlackInstallation({ teamId, userId: userIdOrResponse });
    return NextResponse.json({ ok: true });
  };
}

export function createSlackInstallationPatchHandler(
  overrides: Partial<SlackInstallationRouteDeps> = {}
) {
  const deps: SlackInstallationRouteDeps = { ...defaultDeps, ...overrides };

  return async function PATCH(
    request: Request,
    context: { params: Promise<{ teamId: string }> }
  ) {
    const userIdOrResponse = await deps.requireUserId();
    if (userIdOrResponse instanceof Response) return userIdOrResponse;

    const { teamId } = await context.params;
    if (!teamId) {
      return NextResponse.json({ error: "Missing teamId" }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as PatchBody | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const update: {
      repoAgentEnabled?: boolean;
      allowedSlackUserIds?: string[] | null;
      monthlyRepoRunLimit?: number | null;
    } = {};
    let recognizedFields = 0;

    if ("repoAgentEnabled" in body) {
      recognizedFields += 1;
      if (typeof body.repoAgentEnabled !== "boolean") {
        return NextResponse.json(
          { error: "repoAgentEnabled must be boolean" },
          { status: 400 }
        );
      }
      update.repoAgentEnabled = body.repoAgentEnabled;
    }

    if ("allowedSlackUserIds" in body) {
      recognizedFields += 1;
      const parsed = parseAllowedSlackUserIds(body.allowedSlackUserIds);
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      update.allowedSlackUserIds = parsed.value;
    }

    if ("monthlyRepoRunLimit" in body) {
      recognizedFields += 1;
      const parsed = parseMonthlyRepoRunLimit(body.monthlyRepoRunLimit);
      if (parsed === undefined) {
        return NextResponse.json(
          { error: "monthlyRepoRunLimit must be a positive integer or null" },
          { status: 400 }
        );
      }
      update.monthlyRepoRunLimit = parsed;
    }

    if (recognizedFields === 0) {
      return NextResponse.json(
        { error: "No supported Slack policy fields provided" },
        { status: 400 }
      );
    }

    // Slack policy ownership follows the current installer. Reinstalling a
    // workspace deliberately transfers this management surface with the install.
    const row = await deps.updateSlackInstallationPolicy({
      teamId,
      userId: userIdOrResponse,
      ...update,
    });
    if (!row) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    return NextResponse.json({
      installation: {
        teamId: row.team_id,
        teamName: row.team_name,
        botUserId: row.bot_user_id,
        scopes: row.scopes,
        installedAt: row.created_at,
        repoAgentEnabled: row.repo_agent_enabled !== false,
        // [] means allow nobody; null means any explicitly mapped user.
        allowedSlackUserIds: row.allowed_slack_user_ids ?? null,
        monthlyRepoRunLimit: row.monthly_repo_run_limit ?? null,
      },
    });
  };
}

export const DELETE = createSlackInstallationDeleteHandler();
export const PATCH = createSlackInstallationPatchHandler();
