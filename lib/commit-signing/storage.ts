/**
 * Storage for per-user commit signing keys.
 *
 * One key per user. The private key is only ever stored encrypted; the
 * decrypted form is handed straight to the sandbox bootstrap that signs a
 * commit and is never returned to the browser.
 */
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  decryptCommitSigningSecret,
  encryptCommitSigningSecret,
} from "./secret-box";

const TABLE = "commit_signing_keys";

export type CommitSigningKeyRow = {
  user_id: string;
  encrypted_private_key: string;
  public_key: string;
  fingerprint: string;
  title: string | null;
  github_key_id: string | null;
  registered_at: string | null;
  created_at: string;
  updated_at: string;
};

/** The public view of a signing key. Safe to send to the browser. */
export type CommitSigningKeyView = {
  publicKey: string;
  fingerprint: string;
  title: string | null;
  githubKeyId: string | null;
  registeredAt: string | null;
  createdAt: string;
};

function toView(row: CommitSigningKeyRow): CommitSigningKeyView {
  return {
    publicKey: row.public_key,
    fingerprint: row.fingerprint,
    title: row.title,
    githubKeyId: row.github_key_id,
    registeredAt: row.registered_at,
    createdAt: row.created_at,
  };
}

export async function getCommitSigningKey(
  userId: string
): Promise<CommitSigningKeyRow | null> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select(
      "user_id, encrypted_private_key, public_key, fingerprint, title, github_key_id, registered_at, created_at, updated_at"
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load the commit signing key: ${error.message}`);
  }
  return (data as CommitSigningKeyRow | null) ?? null;
}

/** Public metadata for the settings screen. `null` when unset. */
export async function getCommitSigningKeyView(
  userId: string
): Promise<CommitSigningKeyView | null> {
  const row = await getCommitSigningKey(userId);
  return row ? toView(row) : null;
}

/**
 * Store (or replace) the signing key for a user.
 *
 * `privateKey` is the armored OpenSSH private key; it is encrypted here and
 * never written in plaintext.
 */
export async function saveCommitSigningKey(input: {
  userId: string;
  privateKey: string;
  publicKey: string;
  fingerprint: string;
  title?: string | null;
}): Promise<CommitSigningKeyView> {
  const encryptedPrivateKey = encryptCommitSigningSecret(input.privateKey);
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .upsert(
      {
        user_id: input.userId,
        encrypted_private_key: encryptedPrivateKey,
        public_key: input.publicKey,
        fingerprint: input.fingerprint,
        title: input.title ?? null,
        github_key_id: null,
        registered_at: null,
        created_at: now,
        updated_at: now,
      },
      { onConflict: "user_id" }
    )
    .select(
      "user_id, encrypted_private_key, public_key, fingerprint, title, github_key_id, registered_at, created_at, updated_at"
    )
    .single();
  if (error) {
    throw new Error(`Failed to store the commit signing key: ${error.message}`);
  }
  return toView(data as CommitSigningKeyRow);
}

/** Decrypt the stored private key. Throws when it cannot be recovered. */
export async function readCommitSigningPrivateKey(
  row: CommitSigningKeyRow
): Promise<string> {
  return decryptCommitSigningSecret(row.encrypted_private_key);
}

/** Record that the public key was accepted by GitHub. */
export async function markCommitSigningKeyRegistered(input: {
  userId: string;
  githubKeyId: string | null;
  title?: string | null;
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from(TABLE)
    .update({
      github_key_id: input.githubKeyId,
      title: input.title ?? null,
      registered_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", input.userId);
  if (error) {
    throw new Error(
      `Failed to record the GitHub signing key registration: ${error.message}`
    );
  }
}

/** Forget the GitHub registration (the key stays, the badge does not). */
export async function clearCommitSigningKeyRegistration(
  userId: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from(TABLE)
    .update({
      github_key_id: null,
      registered_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (error) {
    throw new Error(
      `Failed to clear the GitHub signing key registration: ${error.message}`
    );
  }
}

/** Delete the stored key. Commit signing is disabled for this user after. */
export async function deleteCommitSigningKey(userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from(TABLE)
    .delete()
    .eq("user_id", userId);
  if (error) {
    throw new Error(
      `Failed to delete the commit signing key: ${error.message}`
    );
  }
}
