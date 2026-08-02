# Slice 09: Capability and Model Admin UI

Status: Proposed

## Owner

Capability admin UI agent.

## Goal

Expose per-member capability overrides and model allowlists in settings using the resolver and non-escalation rules from Slice 02.

## Write Scope

- `app/api/teams/[productTeamId]/members/[memberId]/capabilities/route.ts`
- Team settings tab components under `components/teams/**` or `components/settings/**`
- `app/(dashboard)/settings/settings-page-client.tsx` tab registration only as needed
- Focused route tests and Playwright settings tests

Avoid expanding the settings client more than necessary; extract team settings components.

## UI Contract

Add `team` to `SETTINGS_TABS`.

Team settings sections in this slice:

- Team summary.
- Member list with role badges from Slice 08.
- Capability overrides with preset role summary.
- Model allowlist picker per member.
- Read-only billing placeholder.
- Audit placeholder/link.

No raw JSON editor.

## Mutation Rules

- Only owners can grant `members.manage` or `billing.manage`.
- Admins can edit lower-member capabilities only up to their own allowed capability set.
- Members cannot edit their own overrides.
- Unknown capability keys are rejected by the API.
- Model allowlist accepts concrete model IDs or `"*"`.

## Acceptance Criteria

- Owner can edit a developer's model allowlist and tool capabilities.
- Admin cannot grant owner/admin-equivalent powers.
- Developer/viewer see read-only state.
- UI explains inherited role preset versus explicit override.
- Changes take effect in model/tool availability without reload when practical; otherwise reloads the affected SWR keys.

## Tests

- Unit route tests for allowed edit, self-edit denied, admin over-grant denied, unknown key denied.
- E2E: owner disables `tools.bash` for developer and sees updated member state.
- E2E: model allowlist change affects model picker in active team.

## Handoff

Slice 10 should audit capability and model allowlist mutations from this route.
