import { redirect } from "next/navigation"
import { scopedHref } from "@/lib/scoped-href"

export default async function AgentsPage({ params }: { params: Promise<{ scope: string }> }) {
  const { scope } = await params
  redirect(scopedHref(scope, "/agents/roster"))
}
