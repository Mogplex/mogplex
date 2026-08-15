-- Better Auth credential passwords are salted scrypt hashes encoded as
-- 32 lowercase hex salt characters, a colon, and 128 lowercase hex key
-- characters. Remove any legacy value that does not match that format and
-- invalidate its sessions before enforcing the storage invariant.

with scrubbed_credentials as (
  update "account"
  set
    "password" = null,
    "updatedAt" = now()
  where "providerId" = 'credential'
    and "password" is not null
    and "password" !~ '^[0-9a-f]{32}:[0-9a-f]{128}$'
  returning "userId"
)
delete from "session"
where "userId" in (select "userId" from scrubbed_credentials);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = '"account"'::regclass
      and conname = 'account_credential_password_hash_check'
  ) then
    alter table "account"
      add constraint account_credential_password_hash_check
      check (
        "providerId" <> 'credential'
        or "password" is null
        or "password" ~ '^[0-9a-f]{32}:[0-9a-f]{128}$'
      );
  end if;
end
$$;
