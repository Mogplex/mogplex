# Enterprise Teams and RBAC Program

Status: Proposed
Created: 2026-05-16
Tracking issue: https://github.com/webrenew/mogplex/issues/431
Scope: Mogplex teams, shared resource ownership, member roles, per-member capability controls, team admin UI, audit logging, enterprise packaging placeholders, and WorkOS-compatible organization design.

## Summary

Build enterprise teams as a multi-session program. Each slice should be one focused PR that can be implemented by a separate session without requiring the implementer to re-decide schema, interfaces, or rollout order.

The first implementation keeps Supabase Auth and Mogplex `profiles.id` as runtime identity. Team tables and APIs must include nullable WorkOS external identifiers so a later WorkOS migration can map organizations and memberships without a destructive remodel.

The initial release layers team RBAC on top of existing profile-level platform access and introduces an explicit team resource boundary:

- `allow_platform_ai` and `allow_platform_sandbox` stay as platform entitlements.
- Team capabilities decide what a member may do inside an active team context.
- Missing or ambiguous team context or capability data fails closed.
- Personal mode keeps current behavior only when no team context was requested or stored.
- Shared team resources must carry both the product team id and the acting user id.

## Source References

- WorkOS user management and organizations: https://workos.com/docs/user-management/users-organizations
- WorkOS roles and permissions: https://workos.com/docs/authkit/roles-and-permissions
- WorkOS organization roles: https://workos.com/docs/rbac/organization-roles
- Supabase third-party WorkOS auth: https://supabase.com/docs/guides/auth/third-party/workos

## Current Mogplex Seams

- Auth identity: `lib/auth.ts`, `proxy.ts`, `app/api/auth/user/route.ts`.
- Platform entitlements: `lib/platform-access.ts`.
- Model resolution and model picker: `lib/ai-model-resolver.ts`, `app/api/models/route.ts`, `lib/models/default-model.ts`.
- Agent tools: `lib/agents/tools.ts`, `lib/agents/run-chat.ts`.
- Settings UI: `app/(dashboard)/settings/settings-page-client.tsx`.
- Repo grouping: `workspaces` and `lib/workspaces.ts`; do not reuse this table for enterprise teams, but later slices may add explicit team ownership to workspace/repo records.

## Program Invariants

1. Teams are product organizations, not Vercel teams, Slack teams, or repo workspaces.
2. Use `productTeamId` or `mogplexTeamId` in TypeScript and request contracts. Database tables may use `team_id`.
3. Personal mode remains supported and keeps current model/tool/platform behavior.
4. Team context is discriminated: `personal`, `team`, or `invalid`. Invalid requested/stored teams return 403, not personal fallback.
5. WorkOS is not the initial runtime auth provider; local schema is WorkOS-compatible.
6. Sensitive mutations go through server helpers using service-role access; RLS remains defense-in-depth.
7. Capability enforcement must cover browser routes, CLI/PAT routes, internal delegated calls, background jobs, Slack-triggered runs, external API/MCP runs, and direct sandbox routes.
8. Each PR must add focused unit tests. UI slices also need at least one user-visible Playwright regression.

## Slice Execution Order

1. [Program Charter and Issue Breakdown](./slices/00-program-charter-and-issues.md)
2. [Team Schema and Server Context](./slices/01-team-schema-and-server-context.md)
3. [Capability Model and Resolver](./slices/02-capability-model-and-resolver.md)
4. [Team Context Propagation](./slices/03-team-context-propagation.md)
5. [Resource Boundary and Shared Ownership](./slices/04-resource-boundary-and-shared-ownership.md)
6. [Model Access Context and Enforcement](./slices/05-model-access-context-and-enforcement.md)
7. [Tool Inventory and Sandbox Authorization](./slices/06-tool-inventory-and-sandbox-authorization.md)
8. [Team API Foundation and Active Switcher](./slices/07-team-api-foundation-and-active-switcher.md)
9. [Member, Invite, and Role Management](./slices/08-member-invite-and-role-management.md)
10. [Capability and Model Admin UI](./slices/09-capability-and-model-admin-ui.md)
11. [Team Audit Log](./slices/10-team-audit-log.md)
12. [Enterprise Packaging and Billing Subject](./slices/11-enterprise-packaging-and-billing.md)
13. [WorkOS Migration Spike](./slices/12-workos-migration-spike.md)

## Non-Goals For The First Release

- Do not replace Supabase Auth with WorkOS in the initial implementation.
- Do not enforce real team billing until product and provider-account ownership are decided.
- Do not introduce fully custom roles in v1. Use preset roles plus per-member overrides.
- Do not expose raw capability JSON editing to end users.
- Do not silently treat invalid team context as personal mode.

## Rollout

Ship hidden by default behind a server-side feature flag or bootstrap allowlist until slices 1 through 10 are complete. After enforcement and audit are in place, enable team creation only for configured enterprise/bootstrap accounts. WorkOS migration remains a separate decision record before any production auth change.
