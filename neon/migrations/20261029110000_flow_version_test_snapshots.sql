-- Preserve existing version identities and their shared sequence. New draft
-- tests are immutable snapshots, but are never publication-repair candidates.
ALTER TABLE public.flow_versions
  ADD COLUMN is_test boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.flow_versions.is_test IS
  'Immutable draft-test snapshot; excluded from automatic publication repair.';

-- Retained app releases do not know the marker. Their repair queries may still
-- choose the newest row, so enforce the publication boundary in Postgres too.
CREATE FUNCTION public.prevent_test_snapshot_publication()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.published_version_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.flow_versions
    WHERE id = NEW.published_version_id AND is_test
  ) THEN
    RAISE EXCEPTION 'Draft-test snapshots cannot be published'
      USING ERRCODE = '23514', CONSTRAINT = 'flows_published_version_not_test';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER flows_published_version_not_test
BEFORE INSERT OR UPDATE OF published_version_id ON public.flows
FOR EACH ROW EXECUTE FUNCTION public.prevent_test_snapshot_publication();

REVOKE ALL ON FUNCTION public.prevent_test_snapshot_publication() FROM PUBLIC;
