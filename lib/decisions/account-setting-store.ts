import { supabaseAdmin } from "@/lib/supabase/admin";
import type { DecisionChecksOwner } from "./account-setting";

type SettingRow = { decision_checks_enabled: boolean | null };

/** Read the stored choice. `null` means the team or profile does not exist. */
export async function readDecisionChecksSetting(
  owner: DecisionChecksOwner
): Promise<boolean | null> {
  const { data, error } = await supabaseAdmin
    .from(owner.table)
    .select("decision_checks_enabled")
    .eq("id", owner.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return (data as SettingRow).decision_checks_enabled !== false;
}

/** Store the choice. Returns false when the team or profile does not exist. */
export async function writeDecisionChecksSetting(
  owner: DecisionChecksOwner,
  enabled: boolean
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from(owner.table)
    .update({ decision_checks_enabled: enabled })
    .eq("id", owner.id)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}
