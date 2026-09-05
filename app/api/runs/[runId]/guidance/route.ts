import { z } from "zod";
import { requireUserId } from "@/lib/auth";
import { canGuideRun, loadWorkspaceRun } from "@/lib/run-workspace/context";
import { submitSlackRunGuidance } from "@/lib/slack/run-guidance-store";
import { readSlackRunControlsMetadata } from "@/lib/slack/run-controls";

const inputSchema = z.object({
  id: z.string().uuid(),
  text: z.string().trim().min(1),
});

const defaultDeps = {
  requireUserId,
  loadRun: loadWorkspaceRun,
  submit: submitSlackRunGuidance,
};
export function createRunGuidancePostHandler(deps = defaultDeps) {
  return async function POST(
    request: Request,
    { params }: { params: Promise<{ runId: string }> }
  ) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;
    const input = inputSchema.safeParse(await request.json().catch(() => null));
    const { runId } = await params;
    if (!input.success || !z.string().uuid().safeParse(runId).success)
      return Response.json({ error: "Invalid guidance" }, { status: 400 });
    try {
      const run = await deps.loadRun(userId, runId);
      if (!run)
        return Response.json({ error: "Run not found" }, { status: 404 });
      const controls = readSlackRunControlsMetadata(run.metadata);
      if (!canGuideRun(run) || !controls)
        return Response.json(
          { error: "This run cannot receive live guidance" },
          { status: 409 }
        );
      const receipt = await deps.submit({
        userId,
        runId,
        aiCallId: run.ai_call_id,
        teamId: controls.teamId,
        channelId: controls.channelId,
        threadTs:
          typeof run.metadata.slack_thread_ts === "string"
            ? run.metadata.slack_thread_ts
            : controls.messageTs,
        slackUserId: String(run.metadata.slack_user_id),
        eventId: `workspace:${input.data.id}`,
        messageTs: `workspace:${input.data.id}`,
        body: input.data.text,
        attachments: null,
      });
      if (!receipt)
        return Response.json(
          {
            error:
              "Run changed before guidance was saved. Reload and try again.",
          },
          { status: 409 }
        );
      return Response.json(receipt);
    } catch {
      return Response.json(
        { error: "Could not save guidance. Your message was not confirmed." },
        { status: 500 }
      );
    }
  };
}
export const POST = createRunGuidancePostHandler();
