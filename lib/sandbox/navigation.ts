import { scopedHref } from "@/lib/scoped-href";

export function buildSandboxObservabilityHref(input: {
  scope: string;
  repoId: string;
  sandboxRecordId?: string | null;
}) {
  const params = new URLSearchParams();
  params.set("repo_id", input.repoId);
  if (input.sandboxRecordId) {
    params.set("sandbox_record_id", input.sandboxRecordId);
  }
  return scopedHref(input.scope, `/observability?${params.toString()}`);
}
