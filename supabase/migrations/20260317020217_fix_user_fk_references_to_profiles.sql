-- Repoint user_id FKs from auth.users to profiles for tables used by
-- Vercel OAuth users who don't have an auth.users entry.

ALTER TABLE user_model_preferences
  DROP CONSTRAINT user_model_preferences_user_id_fkey,
  ADD CONSTRAINT user_model_preferences_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE ai_calls
  DROP CONSTRAINT ai_calls_user_id_fkey,
  ADD CONSTRAINT ai_calls_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE connections
  DROP CONSTRAINT connections_user_id_fkey,
  ADD CONSTRAINT connections_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;;
