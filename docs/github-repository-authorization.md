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
New attachments require a session-bound installation callback and a verified
GitHub identity that owns the personal account or is an active organization
owner. Begin this connection in Mogplex. Accounts without an identity credential
complete identity authorization before selecting the App installation. Other
members use repositories explicitly shared through their Mogplex team. Cached
repository names, org membership discovery, and webhook sender names never
attach new installation grants. Existing stored grants are retained.

The synchronized inventory uses the current App repository IDs. A repository
transferred outside an installation or left over from OAuth synchronization
is excluded from that inventory. Its stored workspace, drafts, and history are
retained. An empty App grant must not restore cached OAuth-only repositories.
Team inventory verifies each shared row against its originating owner's
attached installation and current repository grant. Team members can use
already-shared repositories without attaching a duplicate personal installation;
this does not import teammates' personal repositories into the team.
Inventories fetched during the current sync request are reused. A revoked
installation contributes no rows; other verified team grants remain available.
Provider outages remain verification errors. PR search in an App deployment
requires an explicit organization or user owner; an omitted owner prompts for
that input without requesting a new authorization grant.

OAuth remains available for identity and membership discovery. Reconnection
for an App-based account requests `read:org`, `read:user`, and `user:email`,
without the broad `repo` scope, and preserves App authorization mode. Existing
OAuth grants are not revoked by this code change.

In an App deployment a repository is created with the installation token of
the organization that owns it, which needs the App's Administration (write)
permission, and each installation's owner must accept that permission before
creation works there. The installation token does not carry the user's own
org policy, so the user must be an active owner of the organization, read live
with their identity grant at creation time, and the installation must be
attached to them. The identity grant never writes. An organization without an
installation attached to the user is refused, and so is a member who is not
an owner. A personal account is refused until the App has user authorization,
because GitHub creates personal repositories only with a user token. The new
repository is imported alone, so creation never imports the rest of the
installation.

Self-hosted deployments configured only for OAuth retain their existing
repository OAuth flow. An account already in App mode does not regain that
flow merely because App environment configuration is absent.
An intentional migration back to OAuth-only hosting requires an operator to
explicitly change the affected profile's `github_auth_mode` to `oauth`, then
have that user reconnect and approve repository access. Configuration loss alone
does not authorize that change.

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
