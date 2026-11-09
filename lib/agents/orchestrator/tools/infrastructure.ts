/**
 * Infrastructure and sandbox lifecycle tools for the orchestrator.
 */
import { z } from "zod";
import { createStartSandbox, createStopSandbox } from "@/lib/agents/tools";
import { createProjectSettingsTools } from "@/lib/agents/tools/project-settings";
import type { OrchestratorToolContext, OrchestratorToolDef } from "../types";

const projectSettingsToolsByContext = new WeakMap<
  OrchestratorToolContext,
  Record<string, import("ai").Tool>
>();

function projectSettingsToolsFor(ctx: OrchestratorToolContext) {
  if (!ctx.repoId) return null;
  const existing = projectSettingsToolsByContext.get(ctx);
  if (existing) return existing;
  const tools: Record<string, import("ai").Tool> = createProjectSettingsTools({
    userId: ctx.userId,
    repoId: ctx.repoId,
    teamId: ctx.teamId ?? null,
  });
  projectSettingsToolsByContext.set(ctx, tools);
  return tools;
}

// --- Tool definitions ---

export const INFRASTRUCTURE_TOOLS: OrchestratorToolDef[] = [
  {
    name: "sandbox_provision",
    category: "infrastructure",
    description: "Provision a new sandbox environment",
    access: "mutation",
    implemented: false,
  },
  {
    name: "sandbox_start",
    category: "infrastructure",
    description: "Start a sandbox microVM",
    access: "mutation",
    implemented: true,
    build: (ctx) => {
      if (ctx.sandboxSelectionRequired || !ctx.repoId) return null;
      return createStartSandbox(
        ctx.userId,
        ctx.repoId,
        undefined,
        ctx.sandboxBinding
      );
    },
  },
  {
    name: "sandbox_stop",
    category: "infrastructure",
    description: "Stop sandbox compute without deleting its record",
    access: "mutation",
    implemented: true,
    build: (ctx) =>
      ctx.sandboxSelectionRequired
        ? null
        : createStopSandbox(
            ctx.userId,
            ctx.sandboxBinding,
            ctx.sandboxExecution
          ),
  },
  {
    name: "project_settings",
    category: "infrastructure",
    description:
      "Read the project's saved install/dev commands, port, root directory, and env var names",
    access: "read",
    implemented: true,
    build: (ctx) => projectSettingsToolsFor(ctx)?.project_settings ?? null,
  },
  {
    name: "project_settings_update",
    category: "infrastructure",
    description:
      "Save working install/dev commands, port, or root directory for future boots",
    access: "mutation",
    implemented: true,
    build: (ctx) =>
      projectSettingsToolsFor(ctx)?.project_settings_update ?? null,
  },
  {
    name: "project_env_request",
    category: "infrastructure",
    description:
      "Ask the operator to fill in secret environment variables in Project settings",
    access: "read",
    implemented: true,
    build: (ctx) => projectSettingsToolsFor(ctx)?.project_env_request ?? null,
  },
  {
    name: "project_env_set",
    category: "infrastructure",
    description: "Save one non-secret environment variable on the project",
    access: "mutation",
    implemented: true,
    build: (ctx) => projectSettingsToolsFor(ctx)?.project_env_set ?? null,
  },
  {
    name: "sandbox_pause",
    category: "infrastructure",
    description: "Pause a sandbox to conserve resources",
    access: "mutation",
    implemented: false,
  },
  {
    name: "sandbox_resize",
    category: "infrastructure",
    description: "Resize sandbox compute resources",
    access: "mutation",
    implemented: false,
  },
  {
    name: "sandbox_snapshot",
    category: "infrastructure",
    description: "Create a snapshot of the current sandbox state",
    access: "mutation",
    implemented: false,
  },
  {
    name: "secrets_read",
    category: "infrastructure",
    description: "Read a secret for use in commands (requires approval)",
    access: "approval",
    implemented: false,
  },
  {
    name: "artifact_store",
    category: "infrastructure",
    description: "Store an artifact (file, log, output) for later retrieval",
    access: "mutation",
    implemented: false,
  },
  {
    name: "artifact_fetch",
    category: "infrastructure",
    description: "Fetch a previously stored artifact",
    access: "read",
    implemented: false,
  },
  {
    name: "container_logs",
    category: "infrastructure",
    description: "Stream or retrieve container logs",
    access: "read",
    implemented: false,
  },
];

// --- Schemas ---

export const sandboxProvisionSchema = z.object({
  repoId: z.string().describe("Repository ID"),
  branch: z.string().optional().describe("Branch to checkout"),
  rootDirectory: z.string().optional().describe("Root directory"),
});

export const sandboxPauseSchema = z.object({
  sandboxId: z.string().describe("Sandbox ID to pause"),
});

export const sandboxResizeSchema = z.object({
  sandboxId: z.string().describe("Sandbox ID"),
  cpu: z.number().optional().describe("CPU cores"),
  memory: z.number().optional().describe("Memory in MB"),
});

export const sandboxSnapshotSchema = z.object({
  sandboxId: z.string().describe("Sandbox ID"),
  name: z.string().optional().describe("Snapshot name"),
});

export const secretsReadSchema = z.object({
  name: z.string().describe("Secret name"),
  reason: z.string().describe("Reason for access (for approval)"),
});

export const artifactStoreSchema = z.object({
  key: z.string().describe("Artifact key"),
  content: z.string().describe("Artifact content"),
  contentType: z.string().optional().describe("MIME type"),
});

export const artifactFetchSchema = z.object({
  key: z.string().describe("Artifact key"),
});

export const containerLogsSchema = z.object({
  sandboxId: z.string().describe("Sandbox ID"),
  tail: z.number().optional().describe("Number of lines"),
  since: z.string().optional().describe("Start time"),
});
