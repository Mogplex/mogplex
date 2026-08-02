import { redirect } from "next/navigation"
import { scopedHref } from "@/lib/scoped-href"

export default async function PrimitivesRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ scope: string }>
  searchParams?: Promise<{ tab?: string | string[] }>
}) {
  const { scope } = await params
  const resolved = await searchParams
  const tab = Array.isArray(resolved?.tab) ? resolved?.tab[0] : resolved?.tab

  if (tab === "rules") redirect(scopedHref(scope, "/agents/rules"))
  if (tab === "context") redirect(scopedHref(scope, "/agents/context"))
  redirect(scopedHref(scope, "/agents/skills"))
}
