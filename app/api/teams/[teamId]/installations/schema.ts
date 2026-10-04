import { z } from "zod";

export const teamInstallationParamsSchema = z.object({
  teamId: z.string().uuid(),
});

export const attachInstallationSchema = z.object({
  installation_id: z
    .union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
    .pipe(z.number().int().positive().safe()),
});
