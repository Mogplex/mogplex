import { z } from "zod";

export const teamKeyParamsSchema = z.object({ teamId: z.string().uuid() });
const providerSchema = z.enum([
  "ai_gateway",
  "anthropic",
  "openai",
  "openrouter",
]);
export const storeTeamKeySchema = z.object({
  provider: providerSchema,
  key: z.string().trim().min(1),
});
export const deleteTeamKeySchema = z.object({ provider: providerSchema });
