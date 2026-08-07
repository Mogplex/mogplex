import { filterVisibleModelCatalog } from "@/lib/models/catalog-visibility";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type PublicModelRate = {
  id: string;
  provider: string;
  name: string;
  inputPerMillion: number;
  outputPerMillion: number;
};

type PublicRateRow = {
  id: string;
  provider: string;
  name: string;
  pricing_input: number | null;
  pricing_output: number | null;
  is_hidden: boolean;
};

function perMillion(value: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value * 1_000_000;
}

/**
 * The public per-model token rate table for the pricing page, sourced from
 * the same gateway-synced catalog that billing reconciles against
 * (pricing-plan 01 §3: publish the full table, auto-synced, zero markup).
 *
 * Returns [] on any failure so the marketing page renders without the table
 * instead of erroring.
 */
export async function getPublicModelRates(): Promise<PublicModelRate[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from("ai_models")
      .select("id, provider, name, pricing_input, pricing_output, is_hidden")
      .eq("is_available", true)
      .order("provider")
      .order("name");

    if (error || !data) {
      // Fail-safe for the public page, but a dropped table should be visible
      // in logs — a broken gateway sync or schema drift would otherwise hide.
      if (error)
        console.warn("public model rates query failed:", error.message);
      return [];
    }

    const rates: PublicModelRate[] = [];
    for (const row of filterVisibleModelCatalog(data as PublicRateRow[])) {
      const inputPerMillion = perMillion(row.pricing_input);
      const outputPerMillion = perMillion(row.pricing_output);
      if (inputPerMillion === null || outputPerMillion === null) continue;
      rates.push({
        id: row.id,
        provider: row.provider,
        name: row.name,
        inputPerMillion,
        outputPerMillion,
      });
    }
    return rates;
  } catch (error) {
    console.warn("public model rates unavailable:", error);
    return [];
  }
}

// Two decimals ("$1.20", "$6.00"); sub-dollar rates keep a third when it is
// significant ("$0.075") so cheap models don't round to a misleading "$0.08".
export function formatPerMillion(rate: number): string {
  const fixed =
    rate >= 1 ? rate.toFixed(2) : rate.toFixed(3).replace(/(\.\d{2})0$/, "$1");
  return `$${fixed}`;
}
