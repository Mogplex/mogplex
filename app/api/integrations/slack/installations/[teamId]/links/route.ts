import { NextResponse } from "next/server";
import { requireUserId as defaultRequireUserId } from "@/lib/auth";
import { getOwnedRepo as defaultGetOwnedRepo } from "@/lib/repos";
import {
  createSlackChannelLink,
  getSlackInstallationByTeamId,
  isPostgresUniqueViolation,
  listSlackChannelLinks,
  type SlackInstallationRow,
} from "@/lib/slack/installations";

type SlackChannelLinksRouteDeps = {
  requireUserId: typeof defaultRequireUserId;
  getOwnedRepo: typeof defaultGetOwnedRepo;
  getSlackInstallationByTeamId: typeof getSlackInstallationByTeamId;
  listSlackChannelLinks: typeof listSlackChannelLinks;
  createSlackChannelLink: typeof createSlackChannelLink;
};

const defaultDeps: SlackChannelLinksRouteDeps = {
  requireUserId: defaultRequireUserId,
  getOwnedRepo: defaultGetOwnedRepo,
  getSlackInstallationByTeamId,
  listSlackChannelLinks,
  createSlackChannelLink,
};

async function loadOwnedInstallation(
  deps: SlackChannelLinksRouteDeps,
  teamId: string,
  userId: string
): Promise<
  { installation: SlackInstallationRow } | { error: "not_found" | "forbidden" }
> {
  const installation = await deps.getSlackInstallationByTeamId(teamId);
  if (!installation) return { error: "not_found" as const };
  if (installation.installed_by_user_id !== userId) {
    return { error: "forbidden" as const };
  }
  return { installation };
}

export function createSlackChannelLinksGetHandler(
  overrides: Partial<SlackChannelLinksRouteDeps> = {}
) {
  const deps: SlackChannelLinksRouteDeps = { ...defaultDeps, ...overrides };

  return async function GET(
    _request: Request,
    context: { params: Promise<{ teamId: string }> }
  ) {
    const userIdOrResponse = await deps.requireUserId();
    if (userIdOrResponse instanceof Response) return userIdOrResponse;

    const { teamId } = await context.params;
    const loaded = await loadOwnedInstallation(deps, teamId, userIdOrResponse);
    if ("error" in loaded) {
      const status = loaded.error === "not_found" ? 404 : 403;
      return NextResponse.json({ error: loaded.error }, { status });
    }

    const rows = await deps.listSlackChannelLinks(loaded.installation.id);
    return NextResponse.json({
      links: rows.map((row) => ({
        id: row.id,
        channelId: row.channel_id,
        channelName: row.channel_name,
        repoId: row.repo_id,
        createdAt: row.created_at,
      })),
    });
  };
}

type CreateLinkBody = {
  channelId?: unknown;
  channelName?: unknown;
  repoId?: unknown;
};

function parseCreateLinkBody(body: unknown): {
  channelId: string;
  channelName: string | null;
  repoId: string;
} | null {
  if (!body || typeof body !== "object") return null;
  const { channelId, channelName, repoId } = body as CreateLinkBody;
  if (typeof channelId !== "string" || !channelId.trim()) return null;
  if (typeof repoId !== "string" || !repoId.trim()) return null;
  const normalisedName =
    typeof channelName === "string" && channelName.trim()
      ? channelName.trim()
      : null;
  return {
    channelId: channelId.trim(),
    channelName: normalisedName,
    repoId: repoId.trim(),
  };
}

export function createSlackChannelLinksPostHandler(
  overrides: Partial<SlackChannelLinksRouteDeps> = {}
) {
  const deps: SlackChannelLinksRouteDeps = { ...defaultDeps, ...overrides };

  return async function POST(
    request: Request,
    context: { params: Promise<{ teamId: string }> }
  ) {
    const userIdOrResponse = await deps.requireUserId();
    if (userIdOrResponse instanceof Response) return userIdOrResponse;

    const { teamId } = await context.params;
    const loaded = await loadOwnedInstallation(deps, teamId, userIdOrResponse);
    if ("error" in loaded) {
      const status = loaded.error === "not_found" ? 404 : 403;
      return NextResponse.json({ error: loaded.error }, { status });
    }

    const body = await request.json().catch(() => null);
    const parsed = parseCreateLinkBody(body);
    if (!parsed) {
      return NextResponse.json(
        { error: "channelId and repoId are required" },
        { status: 400 }
      );
    }

    const repo = await deps.getOwnedRepo(parsed.repoId, userIdOrResponse);
    if (!repo) {
      return NextResponse.json({ error: "repo_not_found" }, { status: 404 });
    }

    try {
      const row = await deps.createSlackChannelLink({
        installationId: loaded.installation.id,
        channelId: parsed.channelId,
        channelName: parsed.channelName,
        repoId: parsed.repoId,
        createdByUserId: userIdOrResponse,
      });
      return NextResponse.json({
        link: {
          id: row.id,
          channelId: row.channel_id,
          channelName: row.channel_name,
          repoId: row.repo_id,
          createdAt: row.created_at,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_error";
      // The unique constraint on (installation, channel) collapses dup attempts.
      if (isPostgresUniqueViolation(error)) {
        return NextResponse.json(
          { error: "Channel already linked" },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}

export const GET = createSlackChannelLinksGetHandler();
export const POST = createSlackChannelLinksPostHandler();
