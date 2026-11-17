/**
 * Commit signing for sandbox git.
 *
 * Git signs with an SSH key through `gpg.format=ssh` (git >= 2.34), which
 * shells out to `ssh-keygen`. The platform therefore writes two things into
 * the sandbox: the user's private key (mode 0600) and a global gitconfig
 * that points git at it.
 *
 * Everything here is provider-agnostic on purpose: it only needs a sandbox
 * that can write files and run a command, so the same setup works for the
 * Vercel sandbox and any future backend.
 */
import {
  isCommitSigningEncryptionConfigured,
  CommitSigningEncryptionError,
} from "@/lib/commit-signing/secret-box";
import { signingFailureDiagnostic } from "@/lib/commit-signing/diagnostics";
import {
  getCommitSigningKey,
  readCommitSigningPrivateKey,
} from "@/lib/commit-signing/storage";

/** Staging path for the private key before it is moved into place. */
const STAGED_KEY_PATH = "/tmp/.mogplex-commit-signing-key";

/** Exit code used when the sandbox cannot support SSH commit signing. */
export const COMMIT_SIGNING_UNSUPPORTED_EXIT_CODE = 3;

export const COMMIT_SIGNING_READY_SENTINEL = "MOGPLEX_SIGNING_READY";
export const COMMIT_SIGNING_SCRUBBED_SENTINEL = "MOGPLEX_SIGNING_SCRUBBED";

/** The minimum git version that understands `gpg.format=ssh`. */
export const MINIMUM_SIGNING_GIT_VERSION = "2.34";

/**
 * The sandbox surface this module needs. Kept structural so this file never
 * imports a sandbox SDK.
 */
export type CommitSigningSandbox = {
  writeFiles: (
    files: {
      path: string;
      content: string | Uint8Array;
      mode?: number;
    }[]
  ) => Promise<unknown>;
  runCommand: (command: {
    cmd: string;
    args?: string[];
  }) => Promise<{ exitCode: number }>;
};

export type CommitSigningSetupStatus =
  | "configured"
  | "skipped"
  | "unsupported"
  | "failed";

export type CommitSigningSetupResult = {
  status: CommitSigningSetupStatus;
  /** Why the sandbox was left unsigned. Never contains key material. */
  reason?: string;
};

/**
 * The shell that installs the key and turns on signing.
 *
 * It refuses to enable signing when the sandbox cannot actually sign (git
 * too old, no `ssh-keygen`, unreadable key): a half-configured sandbox would
 * make every commit fail, which is worse than an unsigned commit.
 */
export function buildCommitSigningSetupScript(): string {
  return [
    "set -e",
    "umask 077",
    'key_dir="$HOME/.mogplex/signing"',
    'key_path="$key_dir/id_ed25519"',
    `staged_key="${STAGED_KEY_PATH}"`,
    "cleanup() {",
    "  result=$?",
    '  rm -f "$staged_key"',
    '  if [ "$result" -ne 0 ]; then',
    '    rm -f "$key_path"',
    '    if [ "$(git config --global --get user.signingkey 2>/dev/null || true)" = "$key_path" ]; then',
    "      git config --global --unset gpg.format 2>/dev/null || true",
    "      git config --global --unset user.signingkey 2>/dev/null || true",
    "      git config --global --unset commit.gpgsign 2>/dev/null || true",
    "      git config --global --unset tag.gpgsign 2>/dev/null || true",
    "    fi",
    "  fi",
    "}",
    "trap cleanup EXIT",
    "git_version=\"$(git --version 2>/dev/null | awk '{print $3}')\"",
    'major="$(echo "$git_version" | cut -d. -f1)"',
    'minor="$(echo "$git_version" | cut -d. -f2)"',
    'if [ -z "$git_version" ] || [ "$major" -lt 2 ] || { [ "$major" -eq 2 ] && [ "$minor" -lt 34 ]; }; then',
    '  echo "git $git_version cannot sign commits with an SSH key"',
    `  exit ${COMMIT_SIGNING_UNSUPPORTED_EXIT_CODE}`,
    "fi",
    "if ! command -v ssh-keygen >/dev/null 2>&1; then",
    '  echo "ssh-keygen is not available in this sandbox"',
    `  exit ${COMMIT_SIGNING_UNSUPPORTED_EXIT_CODE}`,
    "fi",
    'mkdir -p "$key_dir"',
    'install -m 600 "$staged_key" "$key_path"',
    'rm -f "$staged_key"',
    'if ! ssh-keygen -y -f "$key_path" >/dev/null 2>&1; then',
    '  rm -f "$key_path"',
    '  echo "the commit signing key could not be read"',
    `  exit ${COMMIT_SIGNING_UNSUPPORTED_EXIT_CODE}`,
    "fi",
    "git config --global gpg.format ssh",
    'git config --global user.signingkey "$key_path"',
    "git config --global commit.gpgsign true",
    "git config --global tag.gpgsign true",
    `echo "${COMMIT_SIGNING_READY_SENTINEL}"`,
  ].join("\n");
}

/**
 * The shell that removes the key and the signing config again.
 *
 * Used before a sandbox is captured into a workspace snapshot so the private
 * key never becomes part of stored snapshot state.
 */
export function buildCommitSigningScrubScript(): string {
  return [
    "set -e",
    'key_path="$HOME/.mogplex/signing/id_ed25519"',
    `rm -f "${STAGED_KEY_PATH}"`,
    'rm -f "$key_path"',
    'rmdir "$HOME/.mogplex/signing" 2>/dev/null || true',
    'rmdir "$HOME/.mogplex" 2>/dev/null || true',
    'if [ "$(git config --global --get user.signingkey 2>/dev/null || true)" = "$key_path" ]; then',
    "git config --global --unset gpg.format 2>/dev/null || true",
    "git config --global --unset user.signingkey 2>/dev/null || true",
    "git config --global --unset commit.gpgsign 2>/dev/null || true",
    "git config --global --unset tag.gpgsign 2>/dev/null || true",
    "fi",
    `echo "${COMMIT_SIGNING_SCRUBBED_SENTINEL}"`,
  ].join("\n");
}

/**
 * Install a private key in the sandbox and turn on commit signing.
 *
 * The key never appears in a command line, a log line or an error message:
 * it is written straight to a 0600 file.
 */
export async function configureSandboxCommitSigning(input: {
  sandbox: CommitSigningSandbox;
  privateKey: string;
}): Promise<CommitSigningSetupResult> {
  try {
    await input.sandbox.writeFiles([
      {
        path: STAGED_KEY_PATH,
        content: input.privateKey,
        mode: 0o600,
      },
    ]);
    const command = await input.sandbox.runCommand({
      cmd: "sh",
      args: ["-lc", buildCommitSigningSetupScript()],
    });
    if (command.exitCode === 0) return { status: "configured" };
    if (command.exitCode === COMMIT_SIGNING_UNSUPPORTED_EXIT_CODE) {
      return {
        status: "unsupported",
        reason: "this sandbox cannot sign commits with an SSH key",
      };
    }
    return {
      status: "failed",
      reason: `the signing setup command exited with code ${command.exitCode}`,
    };
  } catch (error) {
    console.warn(
      "[commit-signing] key_install failed",
      signingFailureDiagnostic(error)
    );
    return {
      status: "failed",
      reason: "the signing setup command failed",
    };
  }
}

/** Loads the decrypted private key for a user, or null when there is none. */
export type CommitSigningKeyLoader = (userId: string) => Promise<string | null>;

async function loadStoredPrivateKey(userId: string): Promise<string | null> {
  const row = await getCommitSigningKey(userId);
  if (!row) return null;
  return readCommitSigningPrivateKey(row);
}

/**
 * Set up commit signing for a user's sandbox.
 *
 * With no key configured this is a no-op: the sandbox keeps today's exact
 * behaviour (unsigned commits, no prompts, no errors).
 */
export async function setupSandboxCommitSigning(input: {
  sandbox: CommitSigningSandbox;
  userId: string;
  /** Test seam: replaces the encrypted-store lookup. */
  loadPrivateKey?: CommitSigningKeyLoader;
}): Promise<CommitSigningSetupResult> {
  if (!isCommitSigningEncryptionConfigured()) {
    return { status: "skipped", reason: "signing is not configured" };
  }

  let privateKey: string | null;
  try {
    const load = input.loadPrivateKey ?? loadStoredPrivateKey;
    privateKey = await load(input.userId);
    if (!privateKey) return { status: "skipped", reason: "no signing key" };
  } catch (error) {
    console.warn(
      "[commit-signing] key_lookup failed",
      signingFailureDiagnostic(error)
    );
    return {
      status: "failed",
      reason:
        error instanceof CommitSigningEncryptionError
          ? "the stored signing key could not be decrypted; contact your administrator"
          : "the signing key could not be loaded",
    };
  }

  return configureSandboxCommitSigning({
    sandbox: input.sandbox,
    privateKey,
  });
}

/** Remove the signing key and its gitconfig entries from a sandbox. */
export async function scrubSandboxCommitSigning(input: {
  sandbox: CommitSigningSandbox;
}): Promise<void> {
  try {
    const result = await input.sandbox.runCommand({
      cmd: "sh",
      args: ["-lc", buildCommitSigningScrubScript()],
    });
    if (result.exitCode !== 0) {
      console.warn("[commit-signing] key_scrub failed", {
        exitCode: result.exitCode,
      });
      throw Object.assign(new Error("Signing key cleanup failed"), {
        exitCode: result.exitCode,
      });
    }
  } catch (error) {
    throw new Error(
      "The signing key could not be removed; snapshot capture is blocked.",
      // Raw provider errors can contain the private key; retain only safe diagnostics.
      // eslint-disable-next-line preserve-caught-error
      { cause: signingFailureDiagnostic(error) }
    );
  }
}
