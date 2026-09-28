# Project environment variables

Local agents can set variables for Mogplex sandboxes without a Vercel connection. These variables use the same settings as the repository's environment editor.

- `mogplex_list_env_vars({ repoId })` returns names and metadata. It never returns values.
- `mogplex_set_env_var({ repoId, key, value })` creates or updates one variable. Other keys stay unchanged.
- `mogplex_delete_env_var({ repoId, key })` removes one variable. Other keys stay unchanged.

The REST endpoint is `/api/v1/mogplex/repos/:repoId/env-vars`. Use GET to list, POST to set, and DELETE to remove a key. Reads need the `read` scope. Changes need the `write` scope. Each operation checks that the authenticated user owns the repository.

New sandbox launches use the saved settings. Active processes keep their current environment. Setting a variable does not restart a sandbox or interrupt its run.

Lists label the variable's target and type as `sandbox`. Mogplex does not change Vercel deployment variables through these tools. Legacy `target` and `type` options return an error. Omit them.

If settings change during an operation, the API returns `409 CONFLICT`. The newer settings stay intact. Retry the operation after that conflict. Values stay in the repository settings. The tools do not introduce a separate secret store.
