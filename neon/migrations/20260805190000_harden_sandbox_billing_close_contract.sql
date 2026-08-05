-- Intentionally Neon-only. The underlying public.sandboxes relation is part
-- of the frozen, verified Supabase structural mirror described in
-- neon/README.md; the DB tests share one explicit contract stub for the
-- columns these billing RPCs require.

-- Close requests are idempotent for every existing lifecycle state, but a
-- missing session is a caller/data-integrity error and must not be confused
-- with a terminal row by returning SQL NULL.
create or replace function public.request_sandbox_billing_session_close(
  p_session uuid,
  p_requested_at timestamptz default now()
) returns bigint language plpgsql as $$
declare
  v_session public.sandbox_billing_sessions%rowtype;
begin
  select * into v_session
  from public.sandbox_billing_sessions
  where id = p_session
  for update;

  if not found then
    raise exception 'sandbox billing session % not found', p_session;
  end if;

  if v_session.state = 'open' then
    update public.sandbox_billing_sessions
    set state = 'closing',
        close_generation = close_generation + 1,
        close_requested_at = p_requested_at,
        updated_at = now()
    where id = p_session
    returning close_generation into v_session.close_generation;
  end if;

  -- Closing and terminal calls return the established generation. This keeps
  -- retries idempotent without using NULL as an overloaded state signal.
  return v_session.close_generation;
end;
$$;
