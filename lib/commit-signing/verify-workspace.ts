/** Uses a temporary repository: never commits to or changes the user's checkout. */
export function buildSigningVerificationScript() {
  return [
    "set -eu",
    "umask 077",
    'expected_public_key="$1"',
    'managed_key="$HOME/.mogplex/signing/id_ed25519"',
    '[ "$(git config --get gpg.format || true)" = ssh ] || exit 10',
    '[ "$(git config --bool --get commit.gpgsign || true)" = true ] || exit 10',
    '[ "$(git config --get user.signingkey || true)" = "$managed_key" ] || exit 10',
    // A custom signing program cannot be vouched for by the standard Git probe.
    '[ -z "$(git config --get gpg.ssh.program || true)" ] || exit 10',
    'actual_public_key="$(ssh-keygen -y -P "" -f "$managed_key" 2>/dev/null)" || exit 12',
    `actual_public_key="$(printf '%s\\n' "$actual_public_key" | awk '{print $1 " " $2}')"`,
    '[ "$actual_public_key" = "$expected_public_key" ] || exit 11',
    'verification_dir="$(mktemp -d)"',
    "trap 'rm -rf \"$verification_dir\"' EXIT",
    "verification_git() {",
    'env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_CONFIG_COUNT -u GIT_CONFIG_PARAMETERS GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null git -C "$verification_dir" "$@"',
    "}",
    "verification_git init --quiet > /dev/null 2>&1 || exit 12",
    'verification_git -c core.hooksPath=/dev/null -c user.name="Mogplex signing check" -c user.email=signing-check@mogplex.invalid -c gpg.format=ssh -c user.signingkey="$managed_key" -c commit.gpgsign=true commit --allow-empty -m "Verify workspace signing" > /dev/null 2>&1 || exit 12',
    'printf "signing-check@mogplex.invalid %s\\n" "$actual_public_key" > "$verification_dir/allowed_signers"',
    'verification_git -c gpg.format=ssh -c gpg.ssh.allowedSignersFile="$verification_dir/allowed_signers" verify-commit HEAD > /dev/null 2>&1 || exit 12',
  ].join("\n");
}

export function signingVerificationResult(exitCode: number) {
  if (exitCode === 0)
    return {
      status: "verified",
      message:
        "This sandbox signed and verified a test commit with your saved key. Your repository was not changed.",
    } as const;
  if (exitCode === 10)
    return {
      status: "inactive",
      message:
        "This sandbox is not configured to use your saved signing key. Relaunch or restart it to apply the key, then verify again.",
    } as const;
  if (exitCode === 11)
    return {
      status: "different_key",
      message:
        "This sandbox has a different signing key. Relaunch or restart it to apply your saved key, then verify again.",
    } as const;
  return {
    status: "failed",
    message:
      "The sandbox could not sign and verify a test commit. Check its signing setup and try again.",
  } as const;
}
