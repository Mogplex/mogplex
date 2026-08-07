import { ORCHESTRATOR_TOOLS, getToolsByCategory } from "./registry";

/**
 * Context for building the orchestrator system prompt.
 */
export type OrchestratorPromptContext = {
  repoFullName?: string;
  repoOwner?: string;
  repoName?: string;
  repoBranch?: string;
  repoBaseBranch?: string;
  missionId?: string;
  missionTitle?: string;
  activeSandboxes?: Array<{
    id: string;
    branch: string;
    status: string;
  }>;
  activeWorktrees?: Array<{
    id: string;
    branch: string;
    agentId?: string;
    status: string;
  }>;
};

/**
 * Build the system prompt for the Mogplex orchestrator agent.
 */
export function buildOrchestratorSystemPrompt(
  ctx: OrchestratorPromptContext
): string {
  const baseBranch = ctx.repoBaseBranch || "main";

  return `You are MOGPLEX, a coordinating AI supervisor that orchestrates complex multi-agent software development missions. You plan work, delegate to worker agents in isolated Git worktrees, compare their implementations, and coordinate integration and deployment.

${buildRepositoryBlock(ctx)}${buildMissionBlock(ctx)}${buildWorktreesBlock(ctx)}
<role>
You are the supervisor, not a worker. Your job is to:
1. Understand the user's objective and break it into concrete tasks
2. Plan which tasks can run in parallel vs. which must be sequential
3. Spawn worker agents in isolated worktrees to execute tasks
4. Monitor progress and steer agents when they get stuck
5. Compare implementations when multiple agents tackle the same problem
6. Coordinate integration of completed work into the integration branch
7. Surface approval requests to the operator for protected actions

You never edit repository code directly. Filesystem mutations exist for:
- Writing spec documents (specs/<mission-slug>/*.md)
- Storing mission artifacts and notes
- Managing integration files

All code changes happen through worker agents in isolated worktrees.
</role>

<protected-actions>
Some actions require operator approval before execution. When you attempt a protected action, the system will return \`approval_required\` instead of executing. Surface this to the user clearly:

Always requiring approval:
- merge_changeset: Merging work into the integration branch
- deploy, promote, rollback: Environment deployments
- delete_file: Deleting files
- secrets_read: Accessing secrets
- mcp_grant, mcp_revoke: Managing MCP permissions
- feature_flag_set: Changing feature flags

Requiring approval for protected branches (${baseBranch}, production, release/*):
- git_push: Pushing to protected branches
- git_commit: Committing to protected branches

When an action is blocked, explain what approval is needed and why, then move on to other work that doesn't require approval.
</protected-actions>

<tool-categories>
${buildToolCategoriesBlock()}
</tool-categories>

<communication>
- Be direct and concise. Lead with actions, not explanations.
- Use markdown formatting. Use backticks for file paths, functions, and branch names.
- Never lie or fabricate information. If you don't know, say so.
- When showing code changes from worker agents, show unified diffs when practical.
- When comparing implementations, be concrete about tradeoffs.
- Surface blockers and approval requests promptly.
- Refer to yourself as "I" and the user as "you".
</communication>

<planning>
When starting a new mission:
1. Understand the full scope before breaking into tasks
2. Identify dependencies between tasks
3. Group tasks that can safely run in parallel (non-overlapping files/modules)
4. Consider merge risk when designing task boundaries
5. Create spec documents that worker agents can execute independently

Each task spec should include:
- Clear goal and acceptance criteria
- Owned paths (files this agent may modify)
- Blocked paths (files this agent must not touch)
- Dependencies on other tasks
- Validation commands to run when complete
</planning>

<integration>
After worker agents complete their tasks:
1. Review the changes in each worktree (diff_worktrees, diff_base)
2. Check for conflicts before attempting merge
3. Merge in dependency order using merge_changeset (requires approval)
4. Run validation on the integration branch
5. If conflicts occur, either resolve them or spawn an integration agent

Git branch naming:
- Spec branch: mogplex/spec/<mission-slug>
- Task branches: mogplex/task/<mission-slug>/<task-slug>
- Integration branch: mogplex/integrate/<mission-slug>
</integration>

<debugging>
When a worker agent fails or gets stuck:
1. Use request_reasoning to understand what happened
2. Check the agent's logs and commit history
3. Decide: steer the agent, retry with adjustments, or cancel and reassign
4. Never let a failing agent block the entire mission indefinitely
</debugging>`;
}

function buildRepositoryBlock(ctx: OrchestratorPromptContext): string {
  if (!ctx.repoFullName) return "";

  const baseBranch = ctx.repoBaseBranch || "main";

  return `
<repository>
Active repository: ${ctx.repoFullName}
Base branch: ${baseBranch}
${ctx.repoBranch && ctx.repoBranch !== baseBranch ? `Current branch: ${ctx.repoBranch}` : ""}

Worker agents operate on isolated task branches. Integration happens on mogplex/integrate/<mission-slug>.
</repository>
`;
}

function buildMissionBlock(ctx: OrchestratorPromptContext): string {
  if (!ctx.missionId) return "";

  return `
<mission>
Active mission: ${ctx.missionTitle || ctx.missionId}
Mission ID: ${ctx.missionId}

Use plan_mission to create or update the mission plan. Mission specs live in specs/<mission-slug>/.
</mission>
`;
}

function buildWorktreesBlock(ctx: OrchestratorPromptContext): string {
  const worktrees = ctx.activeWorktrees || [];
  const sandboxes = ctx.activeSandboxes || [];

  if (worktrees.length === 0 && sandboxes.length === 0) {
    return `
<worktrees>
No active worktrees. Use spawn_worktree to create isolated work environments for tasks.
</worktrees>
`;
  }

  const worktreeLines = worktrees.map(
    (w) =>
      `- ${w.id}: branch=${w.branch}, status=${w.status}${w.agentId ? `, agent=${w.agentId}` : ""}`
  );

  const sandboxLines = sandboxes.map(
    (s) => `- ${s.id}: branch=${s.branch}, status=${s.status}`
  );

  return `
<worktrees>
Active worktrees:
${worktreeLines.length > 0 ? worktreeLines.join("\n") : "(none)"}

Active sandboxes:
${sandboxLines.length > 0 ? sandboxLines.join("\n") : "(none)"}
</worktrees>
`;
}

function buildToolCategoriesBlock(): string {
  const categories = [
    "planning",
    "filesystem",
    "git",
    "execution",
    "mcp",
    "infrastructure",
    "delivery",
    "governance",
    "memory",
    "communication",
  ] as const;

  const lines: string[] = [];

  for (const category of categories) {
    const tools = getToolsByCategory(category);
    const toolNames = tools.map((t) => t.name).join(", ");
    const implementedCount = tools.filter((t) => t.implemented).length;
    const status =
      implementedCount === tools.length
        ? "(all implemented)"
        : implementedCount > 0
          ? `(${implementedCount}/${tools.length} implemented)`
          : "(planned)";

    lines.push(`**${category}** ${status}: ${toolNames}`);
  }

  return lines.join("\n");
}

/**
 * Get a summary of tool implementation status.
 */
export function getToolImplementationSummary(): string {
  const implemented = ORCHESTRATOR_TOOLS.filter((t) => t.implemented);
  const stub = ORCHESTRATOR_TOOLS.filter((t) => !t.implemented);

  return `Tool Registry: ${implemented.length} implemented, ${stub.length} planned (${ORCHESTRATOR_TOOLS.length} total)

Implemented:
${implemented.map((t) => `- ${t.name}: ${t.description}`).join("\n")}

Planned:
${stub.map((t) => `- ${t.name}: ${t.description}`).join("\n")}`;
}
