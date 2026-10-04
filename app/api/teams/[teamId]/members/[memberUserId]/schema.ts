import { z } from "zod";

export const memberRoleSchema = z.object({
  role: z.enum(["owner", "admin", "developer", "viewer"]),
});
