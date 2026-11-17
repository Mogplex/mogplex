import { z } from "zod";

export const deliverySnapshotSchema = z.object({
  observedAt: z.string().datetime(),
  repairRevision: z.string(),
  pullRequest: z
    .object({
      number: z.number().int().positive(),
      url: z.string().url(),
      state: z.enum(["open", "closed", "merged"]),
      headSha: z.string(),
      draft: z.boolean(),
      mergeSha: z.string().nullable(),
    })
    .nullable(),
  checks: z.object({
    state: z.enum(["pending", "success", "failure", "unknown"]),
    failed: z.array(z.string()),
    pending: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    incomplete: z.boolean(),
  }),
  review: z.object({
    state: z.enum([
      "approved",
      "changes_requested",
      "required",
      "none",
      "unknown",
    ]),
    unresolved: z.number().int().nonnegative(),
    actionable: z.boolean().optional(),
    incomplete: z.boolean(),
  }),
  deployment: z.object({
    state: z.enum([
      "not_reported",
      "unavailable",
      "pending",
      "success",
      "failure",
      "inactive",
    ]),
    environment: z.string().nullable(),
    url: z.string().url().nullable(),
  }),
});
export type DeliverySnapshot = z.infer<typeof deliverySnapshotSchema>;

export function readDeliverySnapshot(metadata: Record<string, unknown>) {
  const result = deliverySnapshotSchema.safeParse(metadata.delivery_progress);
  return result.success ? result.data : null;
}

export function deliveryNeedsRepair(snapshot: DeliverySnapshot) {
  return (
    snapshot.pullRequest?.state === "open" &&
    (snapshot.checks.state === "failure" ||
      (snapshot.review.actionable ??
        (snapshot.review.state === "changes_requested" ||
          snapshot.review.unresolved > 0)))
  );
}

export function deliveryReadyForReview(snapshot: DeliverySnapshot) {
  return (
    snapshot.pullRequest?.state === "open" &&
    !snapshot.pullRequest.draft &&
    snapshot.checks.state === "success" &&
    !snapshot.checks.incomplete &&
    !snapshot.review.incomplete &&
    snapshot.review.unresolved === 0 &&
    ["approved", "none"].includes(snapshot.review.state)
  );
}

export function pinnedDeliveryPullRequest(metadata: Record<string, unknown>) {
  const value = metadata.delivery_pull_request_number;
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}
