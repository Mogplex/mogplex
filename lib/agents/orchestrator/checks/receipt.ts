import { z } from "zod";
import { CHECK_KINDS } from "./plan";

export const repositoryCheckResultSchema = z.object({
  kind: z.enum(CHECK_KINDS),
  command: z.string().nullable(),
  status: z.enum(["passed", "failed", "blocked", "not_run", "skipped"]),
  exitCode: z.number().int().nullable(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  reason: z.string().optional(),
});

export const repositoryCheckReceiptSchema = z.object({
  ok: z.boolean(),
  verified: z.boolean(),
  receiptVersion: z.literal(1),
  sandboxId: z.string().optional(),
  workspaceRevisionBefore: z.string().nullable(),
  workspaceRevisionAfter: z.string().nullable(),
  commandCompletion: z.enum(["confirmed", "unknown"]),
  checks: z
    .array(repositoryCheckResultSchema)
    .length(CHECK_KINDS.length)
    .refine(
      (rows) =>
        new Set(rows.map((row) => row.kind)).size === CHECK_KINDS.length,
      "Each check kind needs one result."
    ),
  error: z.string().optional(),
});

export type RepositoryCheckResult = z.infer<typeof repositoryCheckResultSchema>;
export type RepositoryCheckReceipt = z.infer<
  typeof repositoryCheckReceiptSchema
>;

export const repositoryVerificationSummarySchema = z.object({
  version: z.literal(1),
  changed: z.boolean(),
  required: z.boolean(),
  verified: z.boolean(),
  error: z.string().nullable(),
  checks: repositoryCheckReceiptSchema.shape.checks,
});
export type RepositoryVerificationSummary = z.infer<
  typeof repositoryVerificationSummarySchema
>;
