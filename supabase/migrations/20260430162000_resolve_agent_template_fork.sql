create or replace function public.resolve_agent_template_fork(
  p_user_id uuid,
  p_source_template text,
  p_name text,
  p_model text,
  p_system_prompt text,
  p_description text,
  p_category text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
-- INPUT VALIDATION CONTRACT (SECURITY DEFINER)
-- -----------------------------------------------
-- This function runs with elevated privileges (service_role effective rights).
-- It does NOT sanitize p_name, p_model, p_system_prompt, p_description, or
-- p_category beyond the length guards below and the underlying column constraints.
--
-- These parameters MUST always originate from the static PRECONFIGURED_AGENTS
-- array in lib/agents/templates.ts.  They must NEVER be derived from
-- user-supplied request body fields or any other untrusted source.
-- If a new call site is added in the future, the caller is responsible for
-- ensuring the values come exclusively from that same trusted static array.
--
-- The char_length() guards below mirror the agents table column constraints.
-- They exist as a belt-and-suspenders defence against accidental misuse;
-- they are not a substitute for validating at the call site.
declare
  v_agent_id uuid;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  if p_source_template is null or btrim(p_source_template) = '' then
    raise exception 'source_template is required';
  end if;

  -- Input length guards — mirror the agents table column constraints.
  -- Values must always originate from PRECONFIGURED_AGENTS (see contract above).
  --
  -- NOTE: char_length(NULL) evaluates to NULL in PL/pgSQL, which is falsy in
  -- IF conditions. Each guard therefore checks IS NULL explicitly so that a
  -- NULL argument is rejected with a clear error rather than silently bypassing
  -- the guard and reaching the INSERT (where it would hit a NOT NULL column
  -- constraint with an opaque Postgres error instead of this message).
  if p_name is null or char_length(p_name) > 255 then
    raise exception 'p_name is required and must not exceed 255 characters';
  end if;
  if p_model is null or char_length(p_model) > 255 then
    raise exception 'p_model is required and must not exceed 255 characters';
  end if;
  if p_category is null or char_length(p_category) > 255 then
    raise exception 'p_category is required and must not exceed 255 characters';
  end if;
  if p_description is null or char_length(p_description) > 1000 then
    raise exception 'p_description is required and must not exceed 1000 characters';
  end if;
  if p_system_prompt is null or char_length(p_system_prompt) > 16000 then
    raise exception 'p_system_prompt is required and must not exceed 16000 characters';
  end if;

  -- Advisory lock seed 8106 is reserved exclusively for resolve_agent_template_fork.
  -- All future pg_advisory_xact_lock calls in this codebase must use a different seed
  -- to avoid aliasing. Update this comment when adding new advisory locks.
  --
  -- This advisory lock is the SOLE serialiser for the insert path (i.e. when no
  -- fork row exists yet for this user+template combination). It prevents two
  -- concurrent transactions from both finding v_agent_id IS NULL and both
  -- attempting to INSERT, which would violate uniqueness or produce duplicate rows.
  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || p_source_template, 8106)
  );

  -- NOTE ON FOR UPDATE: this lock clause only affects rows that already exist.
  -- PostgreSQL cannot lock a non-existent row with FOR UPDATE, so it provides
  -- no protection on the first-fork creation path (when no row is present yet).
  -- The advisory lock above is the sole serialiser for that path.
  -- FOR UPDATE here is belt-and-suspenders for the existing-row path only:
  -- it prevents a concurrent UPDATE/DELETE on the row between this SELECT and
  -- the RETURNING id below, which is otherwise benign given freeze-on-fork
  -- semantics (the row is never updated after creation).
  -- Do NOT remove the advisory lock above on the assumption that FOR UPDATE is
  -- sufficient — it is not sufficient for the insert path.
  select id into v_agent_id
  from public.agents
  where user_id = p_user_id and source_template = p_source_template
  order by created_at, id
  limit 1
  for update;

  if v_agent_id is null then
    -- FREEZE-ON-FORK SEMANTICS: the INSERT branch runs only once — when the
    -- user's fork does not yet exist. p_name, p_model, p_system_prompt,
    -- p_description, and p_category are copied from PRECONFIGURED_AGENTS at
    -- the moment the fork is created and are NEVER updated afterwards.
    --
    -- Consequences for callers and future maintainers:
    --   1. If a template definition changes in PRECONFIGURED_AGENTS (e.g. a
    --      revised system prompt or a new default model), users whose forks
    --      predate the change will NOT receive the update automatically.
    --   2. This is intentional: user forks are treated as owned copies. Users
    --      may have modified their forked agent after creation; overwriting on
    --      every resolve call would silently destroy those edits.
    --   3. If propagating template updates to existing forks is ever required,
    --      a separate migration / backfill job must be written explicitly —
    --      do NOT change the SELECT branch of this function to UPDATE, as that
    --      would lose user edits and change semantics for all callers.
    --
    -- The same freeze semantics apply in resolveAgentTemplateFork (TypeScript)
    -- and in the assignments route's resolveTemplateAgentFork dep.
    insert into public.agents (
      user_id,
      name,
      model,
      system_prompt,
      description,
      category,
      source_template
    ) values (
      p_user_id,
      p_name,
      p_model,
      p_system_prompt,
      p_description,
      p_category,
      p_source_template
    )
    returning id into v_agent_id;

    -- Guard against a silent INSERT suppression (e.g. a trigger or RLS policy
    -- that aborts the row without raising). Without this check the function
    -- would return NULL, PostgREST would surface { data: null, error: null },
    -- and the caller would receive a generic 500 with no actionable context.
    if v_agent_id is null then
      raise exception 'agent insert did not return an id for template %', p_source_template;
    end if;
  end if;

  return v_agent_id;
end;
$$;

revoke all on function public.resolve_agent_template_fork(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text
) from public;

grant execute on function public.resolve_agent_template_fork(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text
) to service_role;

-- Index to support the SELECT … WHERE user_id = $1 AND source_template = $2
-- inside resolve_agent_template_fork. Without this, each fork resolution
-- performs a sequential scan of the agents table, which degrades linearly
-- with the number of agent rows per user.
-- The partial filter (WHERE source_template IS NOT NULL) keeps the index
-- lean: non-template agents are excluded and never participate in the scan.
create index if not exists agents_user_id_source_template_idx
  on public.agents (user_id, source_template)
  where source_template is not null;
