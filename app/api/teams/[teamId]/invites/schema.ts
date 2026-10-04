import { z } from "zod";

export const inviteSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
  role: z.enum(["admin", "developer", "viewer"]),
});
