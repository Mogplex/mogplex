import { z } from "zod";

export const teamModelParamsSchema = z.object({
  teamId: z.string().uuid(),
});

export const teamModelsSchema = z.object({
  model_allowlist: z
    .array(z.string().trim().min(1))
    .nullable()
    .transform((value) => (value === null ? null : [...new Set(value)].sort())),
});
