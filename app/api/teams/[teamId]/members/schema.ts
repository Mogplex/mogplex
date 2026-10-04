import { z } from "zod";

// The member collection is a bodyless GET; validate its route input.
export const teamMembersParamsSchema = z.object({
  teamId: z.string().uuid(),
});
