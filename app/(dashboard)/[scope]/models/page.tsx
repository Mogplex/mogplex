import { redirect } from "next/navigation";
import { scopedHref } from "@/lib/scoped-href";

export default async function ModelsPage({
  params,
}: {
  params: Promise<{ scope: string }>;
}) {
  const { scope } = await params;
  redirect(scopedHref(scope, "/models/catalog"));
}
