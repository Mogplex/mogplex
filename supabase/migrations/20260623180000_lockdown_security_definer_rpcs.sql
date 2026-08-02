-- Lock down SECURITY DEFINER RPCs to service_role only (P0 security fix).
--
-- Root cause (same class as #671/#673's sum_ai_call_costs leak): PostgreSQL
-- grants EXECUTE to PUBLIC by default, and Supabase's default privileges
-- additionally grant EXECUTE to `anon` and `authenticated` on every new
-- function in `public`. Our service-role-only RPCs were created with only an
-- explicit `GRANT ... TO service_role` and never revoked the defaults, so they
-- stayed callable by anon/authenticated PostgREST clients (/rpc/<name>).
--
-- Because these functions are SECURITY DEFINER and take the acting identity as
-- a parameter (p_user_id / p_team_id) with NO caller authorization check, the
-- exposure was critical:
--   * get_provider_key / get_oauth_token / get_slack_bot_token /
--     get_team_provider_key returned DECRYPTED vault secrets for an arbitrary
--     p_user_id/p_team_id — full API-key & OAuth/Slack-token exfiltration via
--     the public anon key.
--   * store_/delete_/upsert_ secret & connection handlers let an attacker
--     write secrets/connections for arbitrary users.
--   * transfer_team_ownership / delete_agent_category_cascade /
--     merge_ai_call_metadata / claim_* / enqueue_* / *_admission /
--     reserve_/release_slack_repo_agent_monthly_run / resolve_agent_template_fork
--     allowed integrity violations, destructive deletes, and rate-limit bypass.
--
-- This was remediated on prod out-of-band (execute_sql) at the time of
-- discovery. This migration codifies that lockdown for fresh deploys and the
-- current schema state. Existing signatures preserve privileges across
-- CREATE OR REPLACE, but new overloads and drop/recreate paths can receive
-- default grants; any migration that touches service-role-only RPCs must ship
-- its own explicit REVOKE/GRANT block.
--
-- NOT included (intentionally remain executable by anon/authenticated):
--   * RLS helpers: current_profile_id, is_team_member, is_team_admin,
--     user_team_role — required by RLS policies.
--   * functions returning trigger — EXECUTE grant is inert for triggers, and
--     the post-condition filters these with prorettype = 'trigger'::regtype.
--   * assert_slug_available — used by profile/team slug guard triggers during
--     authenticated writes; leave callable unless that trigger path is changed.
--
-- Idempotent and safe to re-run. Handles overloaded signatures (e.g.
-- enqueue_automation_job_run) via oid::regprocedure.

DO $$
DECLARE
  fn text;
  exposed_security_definers text[];
  missing_roles text[];
  allowed_exposed_names text[] := ARRAY[
    'assert_slug_available',
    'current_profile_id',
    'is_team_admin',
    'is_team_member',
    'user_team_role'
  ];
  required_roles text[] := ARRAY['anon','authenticated','service_role'];
  target_names text[] := ARRAY[
    -- secret / token / credential handlers
    'get_oauth_token','has_oauth_token','store_oauth_token','delete_oauth_token',
    'get_provider_key','store_provider_key','delete_provider_key',
    'get_team_provider_key','store_team_provider_key','delete_team_provider_key',
    'get_slack_bot_token','store_slack_bot_token','delete_slack_bot_token',
    'upsert_slack_installation','delete_slack_installation','consume_slack_user_link_token',
    'create_user_mcp_server_secret','update_user_mcp_server_secret','delete_user_mcp_server_secret',
    'count_user_mcp_server_secrets','cleanup_user_mcp_server_secrets',
    'upsert_connection_by_source_preset',
    -- integrity / destructive / rate-limit / job-queue handlers
    'transfer_team_ownership','delete_agent_category_cascade','merge_ai_call_metadata',
    'claim_automation_job_run','claim_chat_limit_admission',
    'claim_external_agent_run_limit_admission','claim_sandbox_boot_limit_admission',
    'enqueue_automation_job_run','record_job_run_start_attempt',
    'reserve_slack_repo_agent_monthly_run','release_slack_repo_agent_monthly_run',
    'resolve_agent_template_fork',
    -- waitlist handlers called through supabaseAdmin/server routes
    'redeem_waitlist_code',
    -- spend RPC (also covered by #673; idempotent overlap)
    'sum_ai_call_costs'
  ];
BEGIN
  SELECT ARRAY(
    SELECT required_role
    FROM unnest(required_roles) AS roles(required_role)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_roles
      WHERE rolname = required_role
    )
    -- Keep the exception text deterministic for review and CI output.
    ORDER BY required_role
  )
  INTO missing_roles;

  IF cardinality(missing_roles) > 0 THEN
    RAISE EXCEPTION 'Missing expected Supabase roles: %', missing_roles;
  END IF;

  FOR fn IN
    SELECT format('%I.%s', n.nspname, p.oid::regprocedure::text)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY(target_names)
      AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated;', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role;', fn);
    RAISE DEBUG 'locked down %', fn;
  END LOOP;

  SELECT COALESCE(
    array_agg(
      format('%s (%s)', p.proname, p.oid::regprocedure::text)
      ORDER BY p.oid::regprocedure::text
    ),
    ARRAY[]::text[]
  )
  INTO exposed_security_definers
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  -- Intentional public-schema scope: these are PostgREST-exposed RPCs. Add a
  -- separate guard if future SECURITY DEFINER RPCs are exposed from another
  -- schema.
  WHERE n.nspname = 'public'
    AND p.prosecdef = true
    AND p.prorettype <> 'trigger'::regtype
    AND p.proname <> ALL(allowed_exposed_names)
    AND (
      has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
    );

  IF cardinality(exposed_security_definers) > 0 THEN
    RAISE EXCEPTION
      'Unexpected SECURITY DEFINER functions executable by anon/authenticated: %',
      exposed_security_definers;
  END IF;
END $$;
