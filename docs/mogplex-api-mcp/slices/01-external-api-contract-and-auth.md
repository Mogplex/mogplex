# Slice 01: External API Contract and Auth

Status: Implemented

## Owner

API foundation agent.

## Goal

Create a narrow `/api/v1/mogplex/*` namespace that accepts user-owned Mogplex PATs and returns stable, structured responses for external clients and MCP tools.

This slice does not start agent execution. It establishes the contract, auth path, common helpers, and tests that later slices build on.

## Write Scope

- `lib/auth-route-policy.ts`
- `proxy.ts` only if the existing route-policy helper is not enough
- `app/api/v1/mogplex/**`
- `lib/mogplex-api/**` or similar route-local helper module
- `tests/unit/*mogplex-api*`

Do not edit sandbox launch or harness execution in this slice.

## API Contract

Initial read endpoints:

```txt
GET /api/v1/mogplex/repos
GET /api/v1/mogplex/sandboxes
```

Shared response envelope for success:

```json
{
  "ok": true,
  "data": {}
}
```

Shared response envelope for errors:

```json
{
  "ok": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Unauthorized"
  }
}
```

Use explicit error codes. Keep messages short and actionable.

## Auth Requirements

- Accept an OAuth access token bound to the canonical MCP resource, or the legacy `Authorization: Bearer mog_...` PAT fallback.
- Reuse `requireUserId()` after the proxy delegates PAT requests to the route.
- Add `/api/v1/mogplex` as a PAT-aware subtree in `lib/auth-route-policy.ts`.
- Do not accept `CRON_SECRET`, `INTERNAL_API_SECRET`, browser cookies, or GitHub tokens as the external integration contract.

## Idempotency Contract

This slice should define but not fully consume the header:

```txt
Idempotency-Key: <opaque caller-generated key>
```

Rules:

- Required for mutating `POST /runs`.
- Optional for reads.
- Maximum length 200 characters.
- Treat it as opaque; do not parse meaning out of it.

## Data Shapes

Repo summary:

```ts
type MogplexApiRepo = {
  id: string;
  full_name: string;
  default_branch: string | null;
  root_directory: string | null;
};
```

Sandbox summary:

```ts
type MogplexApiSandbox = {
  id: string;
  sandbox_id: string | null;
  repo_id: string;
  status: string;
  base_branch: string;
  working_branch: string;
  root_directory: string | null;
  preview_url: string | null;
  created_at: string;
  last_active_at: string;
};
```

## Implementation Notes

- Keep route handlers thin.
- Put shared auth/envelope helpers in a server-only module if more than one route needs them.
- Select only fields the external API actually needs.
- Filter every Supabase query by `user_id`.
- Preserve the existing browser API behavior; this namespace is additive.

## Acceptance Criteria

- PAT requests to `/api/v1/mogplex/repos` reach the route handler.
- Non-PAT requests without a browser session are rejected.
- Machine-auth routes remain hard-gated and unaffected.
- Repo and sandbox list routes return only records owned by the resolved user.
- Error responses use a stable `ok: false` envelope.

## Tests

- Extend proxy/auth route-policy tests for `/api/v1/mogplex`.
- Add unit tests for envelope helpers.
- Add route tests for list repos and list sandboxes.
- Test unauthorized, malformed auth, empty result, and owned result cases.

## Handoff

Slice 02 depends on:

- PAT allowlist merged.
- Shared response envelope available.
- Common external API type names established.
