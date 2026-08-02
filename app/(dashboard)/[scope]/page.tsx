import { redirect } from "next/navigation";
import { scopedHref } from "@/lib/scoped-href";

type Params = { scope: string };

export default async function ScopeRootPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { scope } = await params;
  redirect(scopedHref(scope, "/projects/workspace"));
}
