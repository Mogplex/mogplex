import { scopedHref } from "@/lib/scoped-href";

export type WorkflowRouteSearchParams = Record<
  string,
  string | string[] | undefined
>;

export function buildScopedWorkflowsHref(
  scope: string,
  searchParams: WorkflowRouteSearchParams = {}
) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      for (const item of value) query.append(key, item);
    } else if (value !== undefined) {
      query.set(key, value);
    }
  }

  const serialized = query.toString();
  const href = scopedHref(scope, "/workflows");
  return serialized ? `${href}?${serialized}` : href;
}
