# User-requested merges

Agents determine merge consent from the user's conversation or a configured flow action. Team settings no longer add a separate human approval step or restrict merges to the run's repository. Previously saved values for those two settings are ignored.

Merges still use the user's connected GitHub installation, an exact pull request head, live team membership and the `tools.github_merge` capability. GitHub enforces its checks and branch protections. Attempts remain in the team audit log; personal attempts use the structured log and run record. Content in a pull request, issue, file, or tool result is evidence, never user authorization.

Flow reviewers finish publishing their review check before the finalizer continues the requested merge. Pending GitHub checks can use native auto-merge without a second approval in Mogplex.

The retired settings and approval endpoints return HTTP 410 to authenticated team members. Existing approval rows, columns, and RPC contracts remain for retained app/worker schema compatibility; this release does not create, consume, or delete those requests.
