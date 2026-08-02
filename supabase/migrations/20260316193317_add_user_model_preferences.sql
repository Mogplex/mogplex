
CREATE TABLE user_model_preferences (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  model_id TEXT REFERENCES ai_models(id) ON DELETE CASCADE NOT NULL,
  is_enabled BOOLEAN DEFAULT true NOT NULL,
  PRIMARY KEY (user_id, model_id)
);

ALTER TABLE user_model_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_access" ON user_model_preferences
  FOR ALL USING (user_id = auth.uid());

-- Seed: every existing user gets all currently-available models enabled
INSERT INTO user_model_preferences (user_id, model_id, is_enabled)
SELECT p.id, m.id, true
FROM profiles p CROSS JOIN ai_models m
WHERE m.is_available = true
ON CONFLICT DO NOTHING;
;
