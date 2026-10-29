-- Keep the delayed Trigger run separate from recurring schedule IDs so old
-- application releases continue to interpret trigger_schedule_id unchanged.
ALTER TABLE public.flows ADD COLUMN trigger_once_run_id text;
