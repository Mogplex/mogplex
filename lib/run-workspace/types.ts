import { z } from "zod";
import { MOGPLEX_API_RUN_STATUSES } from "@/lib/mogplex-api/runs-types";

export const runWorkspaceSchema = z.object({
  runId: z.string(),
  aiCallId: z.string(),
  prompt: z.string(),
  status: z.enum(MOGPLEX_API_RUN_STATUSES),
  sandboxRecordId: z.string().nullable(),
  workingBranch: z.string(),
  canGuide: z.boolean(),
  guidance: z
    .array(
      z.object({
        id: z.string(),
        body: z.string(),
        status: z.enum(["received", "delivered", "not_applied"]),
      })
    )
    .optional(),
  repo: z.object({
    id: z.string(),
    user_id: z.string(),
    full_name: z.string(),
    created_at: z.string(),
    default_branch: z.string().optional(),
    root_directory: z.string().nullable().optional(),
  }),
});
export type RunWorkspaceContext = z.infer<typeof runWorkspaceSchema>;
export const runEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  toolName: z.string().nullable(),
  message: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type RunWorkspaceEvent = z.infer<typeof runEventSchema>;
export const isRunActive = (status: string) =>
  status === "pending" || status === "streaming";
