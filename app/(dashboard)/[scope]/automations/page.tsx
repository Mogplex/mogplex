import { redirect } from "next/navigation"
import {
  buildScopedWorkflowsHref,
  type WorkflowRouteSearchParams,
} from "@/lib/flows/workflows-route"

export default async function AutomationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ scope: string }>
  searchParams: Promise<WorkflowRouteSearchParams>
}) {
  const [{ scope }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams,
  ])
  redirect(buildScopedWorkflowsHref(scope, resolvedSearchParams))
}
