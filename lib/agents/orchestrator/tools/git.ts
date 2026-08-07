/**
 * Git tools for the orchestrator.
 */
import { z } from "zod";
import type { OrchestratorToolDef } from "../types";

// --- Tool definitions ---

export const GIT_TOOLS: OrchestratorToolDef[] = [
  {
    name: "git_status",
    category: "git",
    description: "Show working tree status and staged changes",
    access: "read",
    implemented: false,
  },
  {
    name: "git_commit",
    category: "git",
    description: "Create a commit with the current staged changes",
    access: "mutation",
    implemented: false,
  },
  {
    name: "git_push",
    category: "git",
    description:
      "Push commits to remote (requires approval for protected branches)",
    access: "mutation",
    implemented: false,
  },
  {
    name: "create_branch",
    category: "git",
    description: "Create a new branch from a base ref",
    access: "mutation",
    implemented: false,
  },
  {
    name: "rebase_worktree",
    category: "git",
    description: "Rebase a worktree branch onto the latest base",
    access: "mutation",
    implemented: false,
  },
  {
    name: "cherry_pick",
    category: "git",
    description: "Cherry-pick a commit from another branch",
    access: "mutation",
    implemented: false,
  },
  {
    name: "diff_worktrees",
    category: "git",
    description: "Compare changes between two worktrees",
    access: "read",
    implemented: false,
  },
  {
    name: "diff_base",
    category: "git",
    description: "Show diff between current branch and base branch",
    access: "read",
    implemented: false,
  },
  {
    name: "merge_changeset",
    category: "git",
    description:
      "Merge a changeset into the integration branch (requires approval)",
    access: "approval",
    implemented: false,
  },
  {
    name: "resolve_conflict",
    category: "git",
    description: "Resolve a merge conflict with specified resolution strategy",
    access: "mutation",
    implemented: false,
  },
  {
    name: "open_pr",
    category: "git",
    description: "Open a pull request for the current branch",
    access: "mutation",
    implemented: true,
  },
  {
    name: "comment_inline",
    category: "git",
    description: "Add an inline comment to a PR or commit",
    access: "mutation",
    implemented: false,
  },
  {
    name: "request_review",
    category: "git",
    description: "Request a review on a pull request",
    access: "mutation",
    implemented: false,
  },
];

// --- Schemas ---

export const gitStatusSchema = z.object({
  worktreeId: z.string().optional().describe("Worktree to check"),
});

export const gitCommitSchema = z.object({
  message: z.string().describe("Commit message"),
  files: z.array(z.string()).optional().describe("Specific files to commit"),
});

export const gitPushSchema = z.object({
  branch: z.string().optional().describe("Branch to push"),
  force: z.boolean().optional().describe("Force push"),
});

export const createBranchSchema = z.object({
  name: z.string().describe("Branch name"),
  base: z.string().optional().describe("Base ref"),
});

export const rebaseWorktreeSchema = z.object({
  worktreeId: z.string().describe("Worktree to rebase"),
  onto: z.string().optional().describe("Branch to rebase onto"),
});

export const cherryPickSchema = z.object({
  commitSha: z.string().describe("Commit SHA to cherry-pick"),
  targetBranch: z.string().optional().describe("Target branch"),
});

export const diffWorktreesSchema = z.object({
  worktreeA: z.string().describe("First worktree ID"),
  worktreeB: z.string().describe("Second worktree ID"),
});

export const diffBaseSchema = z.object({
  branch: z.string().optional().describe("Branch to diff"),
});

export const mergeChangesetSchema = z.object({
  changesetId: z.string().describe("Changeset to merge"),
  strategy: z
    .enum(["merge", "squash", "rebase"])
    .optional()
    .describe("Merge strategy"),
});

export const resolveConflictSchema = z.object({
  path: z.string().describe("Conflicted file path"),
  resolution: z
    .enum(["ours", "theirs", "manual"])
    .describe("Resolution strategy"),
  content: z.string().optional().describe("Manual resolution content"),
});

export const commentInlineSchema = z.object({
  prNumber: z.number().describe("PR number"),
  path: z.string().describe("File path"),
  line: z.number().describe("Line number"),
  body: z.string().describe("Comment body"),
});

export const requestReviewSchema = z.object({
  prNumber: z.number().describe("PR number"),
  reviewers: z.array(z.string()).describe("GitHub usernames"),
});

// --- Schema map for stub tools ---

export const GIT_SCHEMAS: Record<string, z.ZodType> = {
  git_status: gitStatusSchema,
  git_commit: gitCommitSchema,
  git_push: gitPushSchema,
  create_branch: createBranchSchema,
  rebase_worktree: rebaseWorktreeSchema,
  cherry_pick: cherryPickSchema,
  diff_worktrees: diffWorktreesSchema,
  diff_base: diffBaseSchema,
  merge_changeset: mergeChangesetSchema,
  resolve_conflict: resolveConflictSchema,
  comment_inline: commentInlineSchema,
  request_review: requestReviewSchema,
};
