import { z } from "zod";

// Resend and revoke are bodyless actions; their input is the route IDs.
export const inviteActionParamsSchema = z.object({
  teamId: z.string().uuid(),
  inviteId: z.string().uuid(),
});
