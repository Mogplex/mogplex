import { z } from "zod";
import { MAX_BULK_INVITE_EMAILS } from "@/lib/team-bulk-invite";

export const bulkInviteSchema = z.object({
  // Invalid individual entries remain per-address skipped results.
  emails: z.array(z.unknown()).min(1).max(MAX_BULK_INVITE_EMAILS),
  role: z.enum(["admin", "developer", "viewer"]),
});
