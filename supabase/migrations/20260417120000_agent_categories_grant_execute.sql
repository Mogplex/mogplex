-- Explicitly grant execute on the delete cascade RPC to the roles that can
-- actually call it. The prior migration only REVOKEd from public; this makes
-- the policy intent explicit so a future role change cannot silently break
-- the DELETE endpoint.
grant execute on function public.delete_agent_category_cascade(uuid, uuid)
  to service_role;
