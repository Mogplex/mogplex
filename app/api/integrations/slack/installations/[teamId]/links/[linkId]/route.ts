import { NextResponse } from "next/server";
import { requireUserId as defaultRequireUserId } from "@/lib/auth";
import {
  deleteSlackChannelLink,
  getSlackInstallationByTeamId,
} from "@/lib/slack/installations";

type SlackChannelLinkRouteDeps = {
  requireUserId: typeof defaultRequireUserId;
  getSlackInstallationByTeamId: typeof getSlackInstallationByTeamId;
  deleteSlackChannelLink: typeof deleteSlackChannelLink;
};

const defaultDeps: SlackChannelLinkRouteDeps = {
  requireUserId: defaultRequireUserId,
  getSlackInstallationByTeamId,
  deleteSlackChannelLink,
};

export function createSlackChannelLinkDeleteHandler(
  overrides: Partial<SlackChannelLinkRouteDeps> = {}
) {
  const deps: SlackChannelLinkRouteDeps = { ...defaultDeps, ...overrides };

  return async function DELETE(
    _request: Request,
    context: { params: Promise<{ teamId: string; linkId: string }> }
  ) {
    const userIdOrResponse = await deps.requireUserId();
    if (userIdOrResponse instanceof Response) return userIdOrResponse;

    const { teamId, linkId } = await context.params;
    if (!teamId || !linkId) {
      return NextResponse.json(
        { error: "Missing identifiers" },
        { status: 400 }
      );
    }

    const installation = await deps.getSlackInstallationByTeamId(teamId);
    if (!installation) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (installation.installed_by_user_id !== userIdOrResponse) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    await deps.deleteSlackChannelLink({
      linkId,
      installationId: installation.id,
      createdByUserId: userIdOrResponse,
    });
    return NextResponse.json({ ok: true });
  };
}

export const DELETE = createSlackChannelLinkDeleteHandler();
