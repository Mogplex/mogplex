import { notFound, redirect } from "next/navigation";
import { requireUserId } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

import { runDeepLinkDestination } from "@/lib/run-workspace/navigation";

type RunDeepLinkPageProps = {
  params: Promise<{ scope: string; runId: string }>;
  searchParams: Promise<{ view?: string }>;
};

export default async function RunDeepLinkPage({
  params,
  searchParams,
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

  redirect(runDeepLinkDestination(scope, runId, data.ai_call_id, (await searchParams).view));
}
