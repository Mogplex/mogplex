import { redirect } from "next/navigation"
import { scopedHref } from "@/lib/scoped-href"
import AgentRosterPage from "./roster/page"
import { RouteErrorFixture } from "@/tests/support/route-error-fixture"

export default async function AgentsPage({ params, searchParams }: {
  params: Promise<{ scope: string }>
  searchParams: Promise<{ routeError?: string }>
}) {
  const { scope } = await params
  if (process.env.PLAYWRIGHT === "1" && (await searchParams).routeError === "1") {
    return <RouteErrorFixture><AgentRosterPage /></RouteErrorFixture>
  }
  redirect(scopedHref(scope, "/agents/roster"))
}
