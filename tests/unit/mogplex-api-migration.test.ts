import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../supabase/migrations/20260428100000_external_agent_runs.sql",
  import.meta.url
);
const followupMigrationUrl = new URL(
  "../../supabase/migrations/20260428180000_external_agent_run_safety_followup.sql",
  import.meta.url
);
const admissionScanFollowupMigrationUrl = new URL(
  "../../supabase/migrations/20260428201000_external_agent_run_admission_scan_followup.sql",
  import.meta.url
);
const teamOwnerTransferMigrationUrl = new URL(
  "../../supabase/migrations/20260518170000_team_owner_transfer.sql",
  import.meta.url
);
const securityDefinerLockdownMigrationUrl = new URL(
  "../../supabase/migrations/20260623180000_lockdown_security_definer_rpcs.sql",
  import.meta.url
);
const migrationsDir = new URL("../../supabase/migrations/", import.meta.url);
let allMigrationSqlPromise: Promise<string> | null = null;

async function readAllMigrationSql() {
  if (allMigrationSqlPromise) return allMigrationSqlPromise;

  const entries = (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  allMigrationSqlPromise = Promise.all(
    entries.map((name) => readFile(new URL(name, migrationsDir), "utf8"))
  ).then((contents) => contents.join("\n\n"));

  return allMigrationSqlPromise;
}

function extractLockdownTargetNames(sql: string) {
  return extractLockdownTextArray(sql, "target_names");
}

function extractLockdownAllowedExposedNames(sql: string) {
  return extractLockdownTextArray(sql, "allowed_exposed_names");
}

function extractLockdownTextArray(sql: string, variableName: string) {
  const targetArray = sql.match(
    new RegExp(
      `${variableName}\\s+text\\[\\]\\s*:=\\s*ARRAY\\[([\\s\\S]*?)\\];`,
      "i"
    )
  )?.[1];
  assert.ok(targetArray, `${variableName} array should be present`);
  return [...targetArray.matchAll(/'([a-z0-9_]+)'/g)].map(([, name]) => name);
}

function maskSqlFragment(fragment: string) {
  return fragment.replace(/[^\n]/g, " ");
}

function findSingleQuotedEnd(sql: string, start: number) {
  let end = start + 1;
  while (end < sql.length) {
    if (sql[end] === "'" && sql[end + 1] === "'") {
      end += 2;
      continue;
    }
    if (sql[end] === "'") return end + 1;
    end += 1;
  }
  return end;
}

function findDollarQuotedEnd(sql: string, start: number) {
  const tag = sql.slice(start).match(/^\$[a-zA-Z_]\w*\$|^\$\$/)?.[0];
  if (!tag) return null;

  const closing = sql.indexOf(tag, start + tag.length);
  return closing === -1 ? null : closing + tag.length;
}

function findMaskedSqlTokenEnd(sql: string, start: number) {
  const char = sql[start];
  const nextChar = sql[start + 1];

  if (char === "-" && nextChar === "-") {
    const lineEnd = sql.indexOf("\n", start + 2);
    return lineEnd === -1 ? sql.length : lineEnd;
  }

  if (char === "/" && nextChar === "*") {
    const commentEnd = sql.indexOf("*/", start + 2);
    return commentEnd === -1 ? sql.length : commentEnd + 2;
  }

  if (char === "'") return findSingleQuotedEnd(sql, start);
  if (char === "$") return findDollarQuotedEnd(sql, start);

  return null;
}

function maskSqlNonCode(sql: string) {
  let masked = "";
  let index = 0;

  while (index < sql.length) {
    const maskedEnd = findMaskedSqlTokenEnd(sql, index);
    if (maskedEnd !== null) {
      masked += maskSqlFragment(sql.slice(index, maskedEnd));
      index = maskedEnd;
      continue;
    }

    masked += sql[index];
    index += 1;
  }

  return masked;
}

function extractPublicSecurityDefinerFunctions(sql: string) {
  const functions = new Map<string, { returnsTrigger: boolean }>();
  const codeOnlySql = maskSqlNonCode(sql);
  const fnPattern =
    /create(?:\s+or\s+replace)?\s+function\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi;
  const headers = [...codeOnlySql.matchAll(fnPattern)].map((match) => ({
    index: match.index,
    name: match[1],
  }));

  for (const [index, header] of headers.entries()) {
    const nextHeader = headers[index + 1]?.index ?? codeOnlySql.length;
    const block = codeOnlySql.slice(header.index, nextHeader);
    if (/security\s+definer/i.test(block)) {
      functions.set(header.name, {
        returnsTrigger: /returns\s+trigger/i.test(block),
      });
    }
  }
  return functions;
}

function splitSqlStatements(sql: string) {
  const codeOnlySql = maskSqlNonCode(sql);
  const statements: string[] = [];
  let start = 0;

  for (let index = 0; index < codeOnlySql.length; index += 1) {
    if (codeOnlySql[index] !== ";") continue;

    statements.push(sql.slice(start, index));
    start = index + 1;
  }

  statements.push(sql.slice(start));
  return statements;
}

function hasDirectAnonAuthenticatedRevoke(sql: string, name: string) {
  const namePattern = new RegExp(
    `revoke\\s+(?:all|execute)\\s+on\\s+function\\s+(?:public\\.)?${name}\\b`,
    "i"
  );
  return splitSqlStatements(sql).some((statement) => {
    if (!namePattern.test(statement)) return false;

    const roleList = statement.match(/\bfrom\s+([\s\S]*)/i)?.[1] ?? "";
    const roles = new Set(
      roleList
        .split(",")
        .map((role) => role.trim().replace(/"/g, "").toLowerCase())
        .filter(Boolean)
    );

    return (
      roles.has("public") && roles.has("anon") && roles.has("authenticated")
    );
  });
}

// Shared by the predecessor migration and the re-apply migration. Keep this
// limited to invariants both SQL files must carry in lockstep.
function assertCorrectedExternalAgentRunAdmissionRpc(sql: string) {
  assert.match(
    sql,
    /create or replace function public\.claim_external_agent_run_limit_admission/i
  );
  assert.match(
    sql,
    /pg_advisory_xact_lock\(\s*hashtext\('limit:external_agent_run:'/i
  );
  assert.match(
    sql,
    /hashtext is 32-bit; unrelated user\/key pairs can theoretically\s+-- share lock contention \(~1 in 2\^31 per pair\), but never corrupt counts\.\s+-- user_api_keys\.id is a uuid, so ':' cannot alias lock-key components\./i
  );
  assert.match(
    sql,
    /v_effective_now timestamptz := greatest\(p_now, now\(\)\)/i
  );
  assert.match(
    sql,
    /count\(\*\) filter \(\s*where le\.created_at >= v_effective_now - make_interval\(secs => p_minutely_window_seconds\)\s*\)/i
  );
  assert.match(
    sql,
    /count\(\*\) filter \(\s*where le\.created_at >= v_effective_now - make_interval\(secs => p_hourly_window_seconds\)\s*\)/i
  );
  assert.match(
    sql,
    /count\(\*\) filter \(\s*where le\.created_at >= v_effective_now - make_interval\(secs => p_daily_window_seconds\)\s*\)/i
  );
  assert.match(
    sql,
    /le\.created_at <= v_effective_now\s+and le\.created_at >= v_effective_now - make_interval\(secs => greatest\(\s*p_minutely_window_seconds,\s*p_hourly_window_seconds,\s*p_daily_window_seconds\s*\)\)/i
  );
}

test("external_agent_runs migration enforces owned RLS writes and prompt bounds", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(
    sql,
    /prompt\s+text\s+not\s+null\s+check\s*\(\s*char_length\(prompt\)\s*<=\s*100000\s*\)/i
  );
  assert.match(
    sql,
    /create policy "owner_select" on public\.external_agent_runs\s+for select using \(user_id = public\.current_profile_id\(\)\)/i
  );
  assert.match(
    sql,
    /create policy "owner_insert" on public\.external_agent_runs\s+for insert with check \(user_id = public\.current_profile_id\(\)\)/i
  );
  assert.match(
    sql,
    /create policy "owner_update" on public\.external_agent_runs\s+for update\s+using \(user_id = public\.current_profile_id\(\)\)\s+with check \(user_id = public\.current_profile_id\(\)\)/i
  );
  assert.match(
    sql,
    /create policy "owner_delete" on public\.external_agent_runs\s+for delete using \(user_id = public\.current_profile_id\(\)\)/i
  );
  assert.match(
    sql,
    /add constraint limit_events_route_key_check check\s*\([\s\S]*external_agent_run/i
  );
});

test("external agent run follow-up migration adds atomic limits and metadata merge support", async () => {
  const sql = await readFile(followupMigrationUrl, "utf8");

  assert.match(
    sql,
    /alter table public\.limit_events\s+add column if not exists resource_id text/i
  );
  assert.match(
    sql,
    /create index if not exists idx_limit_events_external_agent_run_resource_created/i
  );
  assertCorrectedExternalAgentRunAdmissionRpc(sql);
  assert.match(sql, /v_claim_id uuid := p_claim_id/i);
  assert.match(
    sql,
    /create or replace function public\.merge_ai_call_metadata/i
  );
  const mergeAiCallMetadataBlock =
    sql.match(
      /create or replace function public\.merge_ai_call_metadata[\s\S]*?\$\$;/i
    )?.[0] ?? "";
  assert.match(mergeAiCallMetadataBlock, /security definer/i);
  assert.match(
    sql,
    /set metadata = coalesce\(ac\.metadata, '\{\}'::jsonb\) \|\| coalesce\(p_metadata_patch, '\{\}'::jsonb\)/i
  );
  assert.match(
    sql,
    /revoke all on function public\.merge_ai_call_metadata\(uuid, uuid, jsonb\) from public/i
  );
  assert.match(
    sql,
    /grant execute on function public\.merge_ai_call_metadata\(uuid, uuid, jsonb\) to service_role/i
  );
});

test("external agent run admission scan follow-up reapplies the corrected RPC", async () => {
  const sql = await readFile(admissionScanFollowupMigrationUrl, "utf8");

  assert.match(
    sql,
    /already ran[\s-]+20260428180000_external_agent_run_safety_followup/i
  );
  assertCorrectedExternalAgentRunAdmissionRpc(sql);
  assert.match(
    sql,
    /revoke all on function public\.claim_external_agent_run_limit_admission/i
  );
  assert.match(
    sql,
    /grant execute on function public\.claim_external_agent_run_limit_admission[\s\S]*to service_role/i
  );
});

test("team owner transfer migration rejects missing owner membership and resets RPC grants", async () => {
  const sql = await readFile(teamOwnerTransferMigrationUrl, "utf8");

  assert.match(
    sql,
    /drop function if exists public\.transfer_team_ownership\(uuid,\s*uuid,\s*uuid\) cascade/i
  );
  assert.doesNotMatch(
    sql,
    /create or replace function public\.transfer_team_ownership/i
  );
  assert.match(sql, /create function public\.transfer_team_ownership/i);
  assert.match(
    sql,
    /if v_current_owner_role is null or v_current_owner_role <> 'owner' then/i
  );
  assert.match(
    sql,
    /raise exception 'current owner membership not found'\s+using errcode = 'raise_exception'/i
  );
  assert.match(
    sql,
    /raise exception 'ownership can only transfer to an admin'\s+using errcode = 'check_violation'/i
  );
  assert.match(
    sql,
    /revoke all on function public\.transfer_team_ownership\(uuid,\s*uuid,\s*uuid\) from public/i
  );
  assert.match(
    sql,
    /grant execute on function public\.transfer_team_ownership\(uuid,\s*uuid,\s*uuid\) to service_role/i
  );
});

test("security definer migration parser ignores quoted function text", () => {
  const quotedSql = `
    -- create function public.comment_only() returns void
    create or replace function public.real_target()
    returns void
    language plpgsql
    security definer
    as $$
    begin
      perform 'create function public.quoted_only() returns void; revoke execute on function public.quoted_only() from public, anon, authenticated;';
    end;
    $$;

    revoke execute on function public.real_target()
      from authenticated, public, anon, maintenance_role;
  `;

  assert.deepEqual(
    [...extractPublicSecurityDefinerFunctions(quotedSql).keys()],
    ["real_target"]
  );
  assert.equal(
    hasDirectAnonAuthenticatedRevoke(quotedSql, "real_target"),
    true
  );
  assert.equal(
    hasDirectAnonAuthenticatedRevoke(quotedSql, "quoted_only"),
    false
  );
});

test("security definer lockdown migration codifies service-role-only RPC grants", async () => {
  const [lockdownSql, allSql] = await Promise.all([
    readFile(securityDefinerLockdownMigrationUrl, "utf8"),
    readAllMigrationSql(),
  ]);
  const targetNames = extractLockdownTargetNames(lockdownSql);
  const allowedExposedNames = extractLockdownAllowedExposedNames(lockdownSql);
  const securityDefiners = extractPublicSecurityDefinerFunctions(allSql);
  const expectedAllowedExposedNames = [
    "assert_slug_available",
    "current_profile_id",
    "is_team_admin",
    "is_team_member",
    "user_team_role",
  ];

  assert.ok(targetNames.includes("delete_slack_bot_token"));
  assert.ok(targetNames.includes("redeem_waitlist_code"));
  assert.ok(!targetNames.includes("assert_slug_available"));
  assert.deepEqual(allowedExposedNames, expectedAllowedExposedNames);
  assert.match(lockdownSql, /AND p\.prosecdef = true/i);
  assert.match(lockdownSql, /p\.prorettype <> 'trigger'::regtype/i);
  assert.match(
    lockdownSql,
    /format\('%I\.%s', n\.nspname, p\.oid::regprocedure::text\)/i
  );
  assert.match(
    lockdownSql,
    /has_function_privilege\('anon', p\.oid, 'EXECUTE'\)/i
  );
  assert.match(
    lockdownSql,
    /has_function_privilege\('authenticated', p\.oid, 'EXECUTE'\)/i
  );

  const nonDefinerTargets = targetNames.filter(
    (name) => !securityDefiners.has(name)
  );
  assert.deepEqual(nonDefinerTargets, []);

  const uncoveredDefiners = [...securityDefiners.keys()]
    .sort()
    .filter((name) => {
      if (targetNames.includes(name)) return false;
      if (allowedExposedNames.includes(name)) return false;
      if (securityDefiners.get(name)?.returnsTrigger) return false;
      return !hasDirectAnonAuthenticatedRevoke(allSql, name);
    });
  assert.deepEqual(uncoveredDefiners, []);
});
