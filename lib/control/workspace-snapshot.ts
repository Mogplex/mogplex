import { z } from "zod";

export const workspaceSnapshotSchema = z.object({
  sandboxId: z.string(),
  capturedAt: z.string(),
  files: z.array(
    z.object({
      path: z.string(),
      additions: z.number(),
      deletions: z.number(),
      patch: z.string().nullable(),
    })
  ),
});
export type WorkspaceSnapshot = z.infer<typeof workspaceSnapshotSchema>;
