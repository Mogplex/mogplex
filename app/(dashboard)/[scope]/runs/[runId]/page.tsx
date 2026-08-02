import { notFound, redirect } from "next/navigation";
import { requireUserId } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

import { scopedHref } from "@/lib/scoped-href";

type RunDeepLinkPageProps = {
  params: Promise<{ scope: string; runId: string }>;
};

export default async function RunDeepLinkPage({
  params,
}: RunDeepLinkPageProps) {
  const userIdOrResponse = await requireUserId();
  if (userIdOrResponse instanceof Response) redirect("/login");

  const { scope, runId } = await params;
  const { data, error } = await supabaseAdmin
    .from("external_agent_runs")
    .select("ai_call_id")
    .eq("id", runId)
    .eq("user_id", userIdOrResponse)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load run deep link: ${error.message}`);
  }
  if (!data?.ai_call_id) notFound();

  redirect(scopedHref(scope, `/observability?call_id=${encodeURIComponent(data.ai_call_id)}`));
}
