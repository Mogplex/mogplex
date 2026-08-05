# User-owned Vercel compute

User-owned Vercel sandbox billing and Vercel-project environment import are not currently available. Mogplex's existing **Sign in with Vercel** connection is an identity grant (`openid email profile offline_access`); it is not an API-capable integration authorization and must not be used to call project, environment-variable, team, or Sandbox APIs.

The historical `user_vercel_project` billing value and `vercel-project` env sync value remain in types and database rows for backward compatibility only. Runtime resolution and settings writes fail closed to Mogplex platform billing and manual environment variables. There is no environment-variable switch that can reactivate these paths.

## Requirements before implementation

A future implementation needs a Vercel REST API integration installed by the user with explicit, least-privilege access to:

- projects and the selected project;
- project environment variables, including encrypted-value access where required;
- Sandbox creation and lifecycle operations;
- the selected personal or team scope.

The integration grant must be stored separately from the Sign in with Vercel identity token. Mogplex must validate the selected team/project against that grant before saving settings, show grant health and reconnect state, and test revocation and scope changes end to end. Only after those controls exist should the settings options and runtime branches be re-enabled.
