import { isUuid } from "@/lib/uuid";

/** Native chat stores the record ID as sandbox_id; harnesses also store the provider ID. */
export function callSandboxRecordId(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    return null;
  const values = metadata as Record<string, unknown>;
  const id =
    values.sandbox_record_id ??
    (typeof values.sandbox_id === "string" && isUuid(values.sandbox_id)
      ? values.sandbox_id
      : null);
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

export function sandboxCallsFilter(recordId: string) {
  if (!isUuid(recordId)) throw new Error("Invalid sandbox record ID");
  return `metadata->>sandbox_record_id.eq.${recordId},and(metadata->>sandbox_record_id.is.null,metadata->>sandbox_id.eq.${recordId})`;
}
