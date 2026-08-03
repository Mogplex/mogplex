// Browser-bundle stand-in for `pg` (see turbopack.resolveAlias in
// next.config.mjs). Client-reachable modules like lib/team-capabilities lazily
// import lib/supabase/admin, which statically imports the pg-backed shim; this
// stub keeps pg's node-builtin requires (dns, fs, net) out of browser chunk
// resolution. Nothing browser-side may ever construct a Pool — throwing beats
// silently returning empty rows.
export function Pool(): never {
  throw new Error("pg is server-only; a browser bundle constructed a Pool");
}
