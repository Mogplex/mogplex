import { z } from "zod";
import { flowGraphPayloadSchema } from "@/lib/mogplex-api/automation-request";

export const limitSchema = z.number().int().min(1).max(200).optional();

export const listReposArgsSchema = z
  .object({
    query: z.string().trim().min(1).optional(),
    limit: limitSchema,
  })
  .strict();

export const listSandboxesArgsSchema = z
  .object({
    repoId: z.string().trim().min(1).optional(),
    status: z.string().trim().min(1).optional(),
    limit: limitSchema,
  })
  .strict();

export const createSandboxArgsSchema = z
  .object({
    repoId: z.string().trim().min(1),
    baseBranch: z.string().trim().min(1).optional(),
    workingBranch: z.string().trim().min(1).optional(),
    createBranch: z.boolean().optional(),
    rootDirectory: z.string().trim().min(1).nullable().optional(),
  })
  .strict();

export const envVarTargetSchema = z.enum([
  "production",
  "preview",
  "development",
]);

export const repoIdArgsSchema = z
  .object({ repoId: z.string().trim().min(1) })
  .strict();

export const setEnvVarArgsSchema = z
  .object({
    repoId: z.string().trim().min(1),
    key: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .regex(
        /^[A-Za-z_]\w*$/,
        "key must contain only letters, digits, and underscores and not start with a digit"
      ),
    value: z.string().max(65_536),
    target: z.array(envVarTargetSchema).min(1).optional(),
    type: z.enum(["encrypted", "plain", "sensitive"]).optional(),
  })
  .strict();

export const deleteEnvVarArgsSchema = z
  .object({
    repoId: z.string().trim().min(1),
    key: z.string().trim().min(1).max(256),
  })
  .strict();

export const sandboxIdArgsSchema = z
  .object({ sandboxId: z.string().trim().min(1) })
  .strict();

export const automationIdArgsSchema = z
  .object({ automationId: z.string().trim().min(1) })
  .strict();

export const listAutomationsArgsSchema = z
  .object({
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().trim().min(1).optional(),
  })
  .strict();

export const createAutomationArgsSchema = z
  .object({
    installationId: z.number().int().positive(),
    name: z.string().trim().min(1).optional(),
    description: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    graph: flowGraphPayloadSchema.optional(),
    publish: z.boolean().optional(),
  })
  .strict();

export const updateAutomationArgsSchema = z
  .object({
    automationId: z.string().trim().min(1),
    name: z.string().trim().min(1).optional(),
    description: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    installationId: z.number().int().positive().optional(),
    graph: flowGraphPayloadSchema.optional(),
  })
  .strict();

export const setAutomationModelArgsSchema = z
  .object({
    automationId: z.string().trim().min(1),
    nodeId: z.string().trim().min(1),
    modelId: z.string().trim().min(1).nullable(),
    publish: z.boolean().optional(),
  })
  .strict();

export const triggerAutomationArgsSchema = z
  .object({
    automationId: z.string().trim().min(1),
    repoId: z.string().trim().min(1),
    input: z.record(z.string(), z.unknown()).optional(),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const automationRunsArgsSchema = automationIdArgsSchema.extend({
  limit: z.number().int().min(1).max(50).optional(),
});

export const automationRunLogsArgsSchema = automationIdArgsSchema.extend({
  runId: z.string().trim().min(1),
});

export const rerunPrReviewArgsSchema = z
  .object({
    repoId: z.string().trim().min(1),
    prNumber: z.number().int().positive(),
  })
  .strict();

export const startAgentRunArgsSchema = z
  .object({
    repoId: z.string().trim().min(1),
    prompt: z.string().trim().min(1).max(100_000),
    harness: z.enum(["mogplex", "codex", "claude-code"]).optional(),
    baseBranch: z.string().trim().min(1).optional(),
    workingBranch: z.string().trim().min(1).optional(),
    createBranch: z.boolean().optional(),
    rootDirectory: z.string().trim().min(1).nullable().optional(),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const runIdArgsSchema = z
  .object({
    runId: z.string().trim().min(1),
  })
  .strict();

export const runEventsArgsSchema = runIdArgsSchema.extend({
  limit: limitSchema,
});

export const emptyObjectSchema = {
  type: "object",
  additionalProperties: false,
} as const;

export function objectSchema(input: {
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
}) {
  return {
    type: "object",
    properties: input.properties,
    required: input.required,
    additionalProperties: false,
  };
}

export const runIdProperty = {
  type: "string",
  description: "Mogplex external run id returned by mogplex_start_agent_run.",
};
