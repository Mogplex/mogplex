import { redirect } from "next/navigation"
import { scopedHref } from "@/lib/scoped-href"

type LegacyLibrarySearchParams = {
  tab?: string | string[]
}

export default async function LibraryRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ scope: string }>
  searchParams?: Promise<LegacyLibrarySearchParams>
}) {
  const { scope } = await params
  const resolved = await searchParams
  const tabValue = Array.isArray(resolved?.tab) ? resolved?.tab[0] : resolved?.tab

  if (tabValue === "models") {
    redirect(scopedHref(scope, "/settings?tab=models"))
  }

  if (tabValue === "rules") {
    redirect(scopedHref(scope, "/agents/rules"))
  }

  if (tabValue === "context") {
    redirect(scopedHref(scope, "/agents/context"))
  }

  redirect(scopedHref(scope, "/agents/skills"))
}
