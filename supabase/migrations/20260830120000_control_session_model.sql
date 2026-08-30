-- Keep the operator's selected model attached to the durable Control session
-- so the initial mission and every follow-up use the same choice by default.
-- Deliberately no ai_models foreign key: historical sessions must retain their
-- model identity if a catalog entry is later disabled or removed.

alter table public.control_sessions
  add column if not exists model_id text;

alter table public.control_sessions
  drop constraint if exists control_sessions_model_id_valid;

alter table public.control_sessions
  add constraint control_sessions_model_id_valid
  check (
    model_id is null
    or (
      model_id = btrim(model_id)
      and length(model_id) between 1 and 255
    )
  );
