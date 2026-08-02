ALTER TABLE agents ADD COLUMN IF NOT EXISTS slug TEXT;

UPDATE agents SET slug = LOWER(REGEXP_REPLACE(name, '[^a-z0-9]+', '-', 'gi'))
  WHERE slug IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_user_slug
  ON agents(user_id, slug) WHERE slug IS NOT NULL;;
