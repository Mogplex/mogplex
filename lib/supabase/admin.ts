import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getNeonPool } from "@/lib/db/pool";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";

const supabaseUrl =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAdminKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

// MOGPLEX_DATA_BACKEND=neon routes every supabaseAdmin call through the
// pg-backed PostgREST shim against Neon instead of Supabase. Default stays
// "supabase" until the data copy lands, so this ships dark and the flip is a
// single env change (plus the one-time prod data copy).
const useNeonBackend = process.env.MOGPLEX_DATA_BACKEND === "neon";

// The shim implements the subset of the supabase-js surface this codebase
// uses (enforced by the tests/db battery); the cast erases the difference for
// the 150+ existing call sites. Once Supabase is fully retired the cast — and
// this module's Supabase branch — go away with it.
export const supabaseAdmin = useNeonBackend
  ? (createPostgrestShim(getNeonPool()) as unknown as SupabaseClient)
  : createClient(supabaseUrl!, supabaseAdminKey!);
