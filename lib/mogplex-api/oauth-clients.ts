import { supabaseAdmin } from "@/lib/supabase/admin";

export type MogplexOAuthClientRegistration = {
  clientId: string;
  approvedBy: string;
  approvedAt: string;
};

export async function registerMogplexOAuthClient(input: {
  clientId: string;
  clientName: string;
  approvedBy: string;
  resourceUrl: string;
}): Promise<MogplexOAuthClientRegistration | null> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("mcp_oauth_clients")
    .insert({
      client_id: input.clientId,
      client_name: input.clientName,
      resource_url: input.resourceUrl,
      approved_by: input.approvedBy,
      approved_at: now,
      last_authorized_at: now,
      updated_at: now,
    })
    .select("client_id, approved_by, approved_at")
    .maybeSingle();

  // Another user may already have admitted the same dynamically registered
  // client. That existing admission must survive a later consent failure.
  if (error?.code === "23505") return null;
  if (error) throw error;
  if (!data) return null;

  return {
    clientId: data.client_id as string,
    approvedBy: data.approved_by as string,
    approvedAt: data.approved_at as string,
  };
}

export async function removeMogplexOAuthClientRegistration(
  registration: MogplexOAuthClientRegistration
) {
  const { error } = await supabaseAdmin
    .from("mcp_oauth_clients")
    .delete()
    .eq("client_id", registration.clientId)
    .eq("approved_by", registration.approvedBy)
    .eq("approved_at", registration.approvedAt);
  if (error) throw error;
}
