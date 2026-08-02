CREATE OR REPLACE FUNCTION public.enforce_assignment_agent_ownership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  repo_owner uuid;
  agent_owner uuid;
BEGIN
  IF NEW.repo_id IS NULL OR NEW.agent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT user_id INTO repo_owner
  FROM public.repos
  WHERE id = NEW.repo_id;

  SELECT user_id INTO agent_owner
  FROM public.agents
  WHERE id = NEW.agent_id;

  IF repo_owner IS NULL OR agent_owner IS NULL THEN
    RETURN NEW;
  END IF;

  IF repo_owner <> agent_owner THEN
    RAISE EXCEPTION 'Assignment agent must belong to the same user as the repo'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assignments_enforce_agent_ownership ON public.assignments;
CREATE TRIGGER assignments_enforce_agent_ownership
BEFORE INSERT OR UPDATE OF repo_id, agent_id
ON public.assignments
FOR EACH ROW
EXECUTE FUNCTION public.enforce_assignment_agent_ownership();

CREATE OR REPLACE FUNCTION public.enforce_trigger_agent_ownership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  agent_owner uuid;
BEGIN
  IF NEW.user_id IS NULL OR NEW.agent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT user_id INTO agent_owner
  FROM public.agents
  WHERE id = NEW.agent_id;

  IF agent_owner IS NULL THEN
    RETURN NEW;
  END IF;

  IF agent_owner <> NEW.user_id THEN
    RAISE EXCEPTION 'Trigger agent must belong to the same user as the trigger owner'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS triggers_enforce_agent_ownership ON public.triggers;
CREATE TRIGGER triggers_enforce_agent_ownership
BEFORE INSERT OR UPDATE OF user_id, agent_id
ON public.triggers
FOR EACH ROW
EXECUTE FUNCTION public.enforce_trigger_agent_ownership();
