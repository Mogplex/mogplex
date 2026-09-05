import type { Session } from "@/hooks/session-types";
import { buildWorkspaceSession } from "@/hooks/session-helpers";
import { createWorkspaceTree } from "@/hooks/split-panes-factories";
import { collectPanes, type TreeNode } from "@/hooks/split-panes-types";
import { updatePaneNode } from "@/hooks/use-split-panes";
import type { RunWorkspaceContext } from "./types";

/** Navigation binds only. It never starts, resumes, or replaces a sandbox. */
export function bindRunWorkspace(
  sessions: Session[],
  context: RunWorkspaceContext
) {
  const existing = sessions.find(
    (session) => session.externalRunId === context.runId
  );
  if (existing) {
    const agent = collectPanes(existing.paneTree).find(
      (pane) => pane.type === "agent"
    );
    // A user may have continued in a new conversation since their last visit.
    // Following the run link must reattach the original run, not that new chat.
    const runAgent =
      agent ??
      collectPanes(createWorkspaceTree(context.repo.full_name)).find(
        (pane) => pane.type === "agent"
      )!;
    const paneTree: TreeNode = agent
      ? updatePaneNode(existing.paneTree, agent.id, {
          externalRunId: context.runId,
        })
      : {
          id: crypto.randomUUID(),
          dir: "horizontal",
          sizes: [35, 65],
          children: [
            { ...runAgent, externalRunId: context.runId },
            existing.paneTree,
          ],
        };
    return {
      activeSessionId: existing.id,
      sessions: sessions.map((session) =>
        session === existing
          ? {
              ...session,
              paneTree,
              activeId: runAgent.id,
              activeSandboxId: context.sandboxRecordId,
              pendingSandboxBranch: context.sandboxRecordId
                ? null
                : context.workingBranch,
            }
          : session
      ),
    };
  }
  const tree = createWorkspaceTree(
    context.repo.full_name,
    context.repo.root_directory
  );
  const agent = collectPanes(tree).find((pane) => pane.type === "agent")!;
  agent.externalRunId = context.runId;
  const session = buildWorkspaceSession(
    context.repo,
    sessions,
    tree,
    agent.id,
    {
      sandboxId: context.sandboxRecordId,
      pendingSandboxBranch: context.workingBranch,
    }
  );
  session.externalRunId = context.runId;
  return { sessions: [...sessions, session], activeSessionId: session.id };
}
