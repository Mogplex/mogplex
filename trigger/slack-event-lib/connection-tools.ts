import { tool, type Tool } from "ai";
import { z } from "zod";
import { getAllUserConnections } from "@/lib/connections/service";
import { connectionRecoveryTargetSchema } from "@/lib/slack/connection-recovery/presentation";
import {
  loadSlackVercelProjects,
  SlackVercelAccessError,
} from "@/lib/slack/connection-recovery/vercel";
import { canRecoverConnection } from "@/lib/slack/connection-recovery/access";
import type { RequestSlackConnectionInput } from "@/lib/slack/connection-recovery/request";
import type { SlackEventTaskDeps } from "./types";

export function createSlackConnectionTools(
  input: Omit<RequestSlackConnectionInput, "target" | "resumeText"> & {
    deps: Pick<SlackEventTaskDeps, "requestConnectionRecovery">;
    repoFullName?: string;
  },
  overrides: Partial<{
    canRecover: typeof canRecoverConnection;
    loadProjects: typeof loadSlackVercelProjects;
  }> = {}
): Record<string, Tool> {
  const canRecover = overrides.canRecover ?? canRecoverConnection;
  const loadProjects = overrides.loadProjects ?? loadSlackVercelProjects;
  const request = input.deps.requestConnectionRecovery;
  if (!request) return {};
  const requests = new Map<string, ReturnType<typeof request>>();
  const requestOnce = (
    target: Parameters<typeof request>[0]["target"],
    resumeText: string,
    repoId: string | null | undefined
  ) => {
    const key = JSON.stringify(
      connectionRecoveryTargetSchema.parse(target)
    ).toLowerCase();
    let pending = requests.get(key);
    if (!pending) {
      pending = request({ ...input, target, resumeText, repoId });
      requests.set(key, pending);
      void pending.catch(() => requests.delete(key));
    }
    return pending;
  };
  return {
    request_connection: tool({
      description:
        "Propose a connector with its icon in Slack and open an authorization dialog when the user clicks it. Use for missing, expired or insufficient GitHub/Vercel access, or an existing connection that needs reauthorization. Never ask users to paste credentials into Slack. Save the complete pending task in resumeText so they can continue from the dialog.",
      inputSchema: z.object({
        target: connectionRecoveryTargetSchema,
        resumeText: z.string().trim().min(1),
      }),
      execute: async ({ target, resumeText }) =>
        requestOnce(
          target,
          resumeText,
          target.provider === "github" &&
            target.repository?.toLowerCase() !==
              input.repoFullName?.toLowerCase()
            ? undefined
            : input.repoId
        ),
    }),
    list_connections: tool({
      description:
        "List your connection names, IDs, authorization and project scope to choose a connector to authorize. Does not expose credentials.",
      inputSchema: z.object({}),
      execute: async () => {
        if (
          !(await canRecover(
            input.userId,
            input.productTeamId ?? null,
            "connection"
          ))
        )
          return { error: "Your team role does not allow connection access." };
        return (await getAllUserConnections(input.userId)).map((conn) => ({
          id: conn.id,
          name: conn.name,
          provider: conn.source_preset,
          enabled: conn.is_enabled,
          authType: conn.auth_type,
          authorized: Boolean(conn.oauth_authorized_at),
          health: conn.health_status,
          scope: conn.scope,
          repoId: conn.repo_id,
          approvalMode: conn.approval_mode,
        }));
      },
    }),
    find_vercel_projects: tool({
      description:
        "Find Vercel projects and their linked GitHub repositories using the user's connection. Pass the exact team slug from the user (or personal), and optionally a project name. Reports missing authorization without posting a connection card. Request a connection only if Vercel is needed for the user's task.",
      inputSchema: z.object({
        team: z
          .string()
          .regex(/^[A-Za-z0-9_-]+$/)
          .optional(),
        query: z.string().optional(),
      }),
      execute: async ({ team, query }) => {
        if (
          !(await canRecover(
            input.userId,
            input.productTeamId ?? null,
            "vercel"
          ))
        )
          return { error: "Your team role does not allow connection access." };
        try {
          const projects = await loadProjects(input.userId, team);
          return {
            ok: true,
            projects: query
              ? projects.filter((project) =>
                  `${project.name} ${project.repository ?? ""}`
                    .toLowerCase()
                    .includes(query.toLowerCase())
                )
              : projects,
          };
        } catch (error) {
          if (
            !(error instanceof SlackVercelAccessError) ||
            !error.needsAuthorization
          )
            return {
              ok: false,
              error:
                "Vercel could not load projects right now. Try again shortly.",
            };
          return {
            ok: false,
            authorizationRequired: true,
            target: { provider: "vercel", team },
            error:
              "Vercel project access requires authorization. Only request it if the user's task needs Vercel.",
          };
        }
      },
    }),
  };
}
