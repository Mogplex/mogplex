import { z } from "zod";
import { requireUserId } from "@/lib/auth";
import { loadWorkspaceRun } from "@/lib/run-workspace/context";
import { queueResumeExternalAgentRun } from "@/lib/mogplex-api/run-resume";
import {
  approvalSteer,
  checkpointResumeKey,
} from "@/lib/slack/run-checkpoint-presentation";

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), aiCallId: z.string().uuid() }),
  z.object({
    action: z.literal("revise"),
    aiCallId: z.string().uuid(),
    feedback: z.string().trim().min(1),
  }),
]);
const defaults = {
  requireUserId,
  loadRun: loadWorkspaceRun,
  queueResume: queueResumeExternalAgentRun,
};

export function createRunCheckpointPostHandler(deps = defaults) {
  return async function POST(
    request: Request,
    { params }: { params: Promise<{ runId: string }> }
  ) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;
    const { runId } = await params;
    const input = inputSchema.safeParse(await request.json().catch(() => null));
    if (!z.string().uuid().safeParse(runId).success || !input.success)
      return Response.json(
        { error: "Invalid checkpoint response" },
        { status: 400 }
      );
    try {
      const run = await deps.loadRun(userId, runId);
      if (!run)
        return Response.json({ error: "Run not found" }, { status: 404 });
      // A browser left open on an earlier plan cannot approve a later pass.
      if (
        run.status !== "awaiting_input" ||
        run.ai_call_id !== input.data.aiCallId
      )
        return Response.json(
          {
            error:
              "This checkpoint has changed. Refresh the run before responding.",
          },
          { status: 409 }
        );
      const kind = run.metadata.checkpoint_kind === "plan" ? "plan" : "review";
      await deps.queueResume({
        runId: run.id,
        userId,
        repoId: run.repo_id,
        steer:
          input.data.action === "approve"
            ? approvalSteer(kind)
            : input.data.feedback,
        mode:
          input.data.action === "revise" && kind === "plan" ? "plan" : "review",
        // Share the key with Slack so retries and answers from either surface
        // enqueue at most one continuation for this particular pause.
        idempotencyKey: checkpointResumeKey(run),
      });
      return Response.json({ status: "queued" }, { status: 202 });
    } catch {
      return Response.json(
        { error: "Could not confirm your response. Try again." },
        { status: 500 }
      );
    }
  };
}

export const POST = createRunCheckpointPostHandler();
