import { z } from "zod";

export const connectionOAuthQuerySchema = z.object({
  connectionId: z.string().uuid(),
});
