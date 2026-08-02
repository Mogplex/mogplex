# Rotating `CONNECTIONS_ENCRYPTION_KEY`

Why this runbook exists: the production value of `CONNECTIONS_ENCRYPTION_KEY` was
committed to this repository in `tests/unit/connections-encryption.test.ts`
(commit `8b6b85cd`, PR #79). The fixture now uses a dummy value, but the real key
remains in git history, so the key must be rotated **before the repository is made
public**, and the old value must be treated as compromised.

## What the key protects

`lib/connections/encryption.ts` uses this key (AES) to encrypt user connection
credentials (OAuth tokens, API keys) at rest in Postgres. Anyone holding the key
plus a database leak can decrypt every stored connection secret.

## Rotation procedure

1. **Generate a new key** (same shape as the old one — 32-byte hex):

   ```sh
   openssl rand -hex 32
   ```

2. **Re-encrypt stored ciphertexts** with the ready-made script:

   ```sh
   OLD_CONNECTIONS_ENCRYPTION_KEY=<old> \
   NEW_CONNECTIONS_ENCRYPTION_KEY=<new> \
   NEXT_PUBLIC_SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> \
     npx tsx scripts/rotate-connections-encryption-key.ts            # dry run
   # review counts, then re-run with --execute
   ```

   The script backs up all original ciphertexts to a gitignored JSON file,
   verifies each round-trip before writing, skips rows already on the new key
   (safe to re-run), and refuses to overwrite rows whose ciphertext changed
   mid-run (optimistic concurrency — re-run to pick those up). Take a DB
   snapshot first anyway. Run during low traffic — writes made with the old key
   between re-encryption and the env flip (step 3) would become undecryptable,
   so prefer a brief maintenance window, then re-run the script once after the
   flip to catch stragglers.

3. **Update the environment**: set the new value in Vercel (Production + Preview),
   `.env.local` for local dev, and anywhere else the key is configured
   (`vercel env rm/add CONNECTIONS_ENCRYPTION_KEY`). Redeploy.

4. **Verify**: exercise a flow that reads an existing connection (e.g. test a
   stored connection in Settings) and one that writes a new one.

5. **Purge the old value from git history** before the repo goes public:

   ```sh
   # replacements.txt contains: <old-key-value>==>REDACTED
   git filter-repo --replace-text replacements.txt
   ```

   This rewrites all history (new commit SHAs, force-push, all clones must
   re-clone). Alternatively, start the public repo from a fresh history cut at
   transfer time. If neither is done, the rotated (now dead) key stays visible in
   public history and will generate scanner noise indefinitely.

## Status checklist

- [ ] New key generated
- [ ] Stored connection credentials re-encrypted
- [ ] Vercel env updated + redeployed
- [ ] Old key confirmed non-functional
- [ ] History purged (or fresh-history cut decided)
