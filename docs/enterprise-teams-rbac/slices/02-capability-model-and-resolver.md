# Slice 02: Capability Model and Resolver

Status: Proposed

## Owner

Capability resolver agent.

## Goal

Add the central role preset and per-member override resolver. Later enforcement slices must call this helper instead of reading `team_members.capabilities_override` directly.

## Write Scope

- `lib/team-capabilities.ts`
- `tests/unit/team-capabilities.test.ts`
- Minor type imports from `lib/team-context.ts`

Do not wire the resolver into model routing, tools, sandbox launch, or UI in this slice.

## Capability Contract

Use these v1 keys:

```ts
export type TeamCapabilityKey =
  | "tools.bash"
  | "tools.write_file"
  | "tools.web_search"
  | "tools.virtual_exec"
  | "tools.github_read"
  | "tools.github_write"
  | "tools.memory_write"
  | "tools.connection_runtime"
  | "connections.create"
  | "billing.manage"
  | "members.manage";

export type TeamCapabilities = {
  models: {
    allowlist: string[];
  };
  capabilities: Record<TeamCapabilityKey, boolean>;
};
```

`models.allowlist` contains concrete model IDs. Use `"*"` to mean every reachable model allowed by provider/platform access.

## Role Presets

`owner`:

- `models.allowlist = ["*"]`
- all v1 capability keys enabled

`admin`:

- `models.allowlist = ["*"]`
- all v1 capability keys enabled

`developer`:

- `models.allowlist = ["*"]`
- enabled: `tools.bash`, `tools.write_file`, `tools.web_search`, `tools.virtual_exec`, `tools.github_write`
- enabled: `tools.github_read`, `tools.memory_write`, `tools.connection_runtime`
- disabled: `connections.create`, `billing.manage`, `members.manage`

`viewer`:

- `models.allowlist = []`
- all v1 capability keys disabled

## Override Rules

`team_members.capabilities_override = null` means use the role preset exactly.

If override JSON is present:

- It may override `models.allowlist`.
- It may override any known v1 capability key.
- Unknown keys are ignored.
- Invalid shapes fail closed for the invalid section and return denied reasons.
- Overrides can only reduce or expand from the preset for that member; no separate custom role is created.

Privilege boundaries:

- Only owners may grant `members.manage` or `billing.manage`.
- Admins cannot grant a capability they do not currently have.
- Members cannot edit their own role or capability override.
- No role or override change may leave a team without one owner.
- `owner` role transfer must be a dedicated server transaction, not a normal role dropdown update.

## Server Contract

```ts
export type TeamCapabilityDecision = {
  allowed: boolean;
  reason?: string;
};

export type ResolvedTeamCapabilities = TeamCapabilities & {
  productTeamId: string;
  memberId: string;
  role: TeamRole;
  source: "role_preset" | "member_override";
  warnings: string[];
};

export async function resolveMemberCapabilities(input: {
  userId: string;
  productTeamId: string;
}): Promise<ResolvedTeamCapabilities>;

export function canUseModel(
  capabilities: ResolvedTeamCapabilities,
  modelId: string
): TeamCapabilityDecision;

export function hasTeamCapability(
  capabilities: ResolvedTeamCapabilities,
  key: TeamCapabilityKey
): TeamCapabilityDecision;
```

Failure behavior:

- Missing member, suspended team, DB error, or invalid role returns a failed closed result or throws a typed `TeamCapabilityError`.
- Enforcement slices must translate typed capability failures into stable 403 responses.

## Acceptance Criteria

- All role presets are exported and immutable.
- Resolver merges role preset plus override in one place.
- Unknown override keys do not become active permissions.
- Invalid override data cannot accidentally grant access.

## Tests

- Preset snapshots for owner/admin/developer/viewer.
- Model allowlist tests for `"*"`, concrete allowlist, empty allowlist, and missing model ID.
- Override merge tests for allow, deny, unknown key, and invalid shape.
- Fail-closed tests for missing membership and invalid role.
- Non-escalation tests for admin granting, self-editing, last-owner demotion, and owner-only capability grants.

## Handoff

Slices 03, 04, 05, and 06 must depend on this resolver, not duplicated capability logic.
