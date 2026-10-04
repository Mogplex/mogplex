import { z } from "zod";

export const connectionOAuthCallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});
export const connectionOAuthStateSchema = z.object({
  connectionId: z.string().uuid(),
  nonce: z.string().uuid(),
  userId: z.string().min(1),
});
