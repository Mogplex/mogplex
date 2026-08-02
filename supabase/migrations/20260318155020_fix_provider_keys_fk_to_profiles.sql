ALTER TABLE provider_keys DROP CONSTRAINT provider_keys_user_id_fkey;
ALTER TABLE provider_keys ADD CONSTRAINT provider_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;;
