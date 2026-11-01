# GitHub repository authorization

When the Mogplex GitHub App is configured, repository operations use only the
App installations attached to the acting repository's owner or the requesting
user. A stored OAuth account credential does not extend those installation
grants. Missing, revoked, or insufficient App authorization fails closed; it
must not select a broader OAuth credential after an error.

The boundary covers repository inventory, pull request search, repository
credentials supplied to agent tools and sandboxes, synchronization, and
monorepo detection. Installation IDs are checked against the owner's attached
records before minting a repository credential. Missing account metadata is
resolved using the same attached installation ID, without discovering and
attaching another account's installation.

The synchronized inventory uses the current App repository IDs. A repository
transferred outside an installation or left over from OAuth synchronization
is excluded from that inventory. Its stored workspace, drafts, and history are
retained. An empty App grant must not restore cached OAuth-only repositories.

OAuth remains available for identity and membership discovery. Reconnection
for an App-based account requests `read:org`, `read:user`, and `user:email`,
without the broad `repo` scope, and preserves App authorization mode. Existing
OAuth grants are not revoked by this code change. Repository creation through
the legacy OAuth credential is unavailable in an App deployment; adding App
repository-creation support must use explicitly granted permissions rather
than restoring the broad fallback.

Self-hosted deployments configured only for OAuth retain their existing
repository OAuth flow. An account already in App mode does not regain that
flow merely because App environment configuration is absent.

For a requested repository without authorization, use the existing GitHub
connector flow with its exact `owner/repository`. The user approves the App
installation and repository selection in GitHub. A successful connection to
one owner or repository is not proof of access to another. Replies must not
treat repository names in conversation history as current authorization.

Verification should include both approved and unapproved owners, App failures
with a usable legacy OAuth credential present, empty installation grants,
transferred repository records, and OAuth-only self-hosting compatibility.
Use metadata and harmless reads; avoid retrieving private source or making
repository mutations while checking an unapproved owner.
