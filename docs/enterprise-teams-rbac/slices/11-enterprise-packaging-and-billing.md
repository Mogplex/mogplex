# Slice 11: Enterprise Packaging and Billing Subject

Status: Proposed

## Owner

Enterprise packaging agent.

## Goal

Prepare enterprise team creation and billing-state controls without silently billing the wrong account.

## Write Scope

- Team creation APIs from Slice 07
- Team settings billing/status UI
- `lib/team-plans.ts`
- Sandbox billing subject integration from Slice 06 if not already complete
- Tests for plan-state and billing-subject guards

Do not replace sandbox billing attribution with WorkOS billing data in this slice.

## Plan States

```ts
type TeamPlan = "enterprise_pending" | "trial" | "enterprise";
type TeamStatus = "active" | "suspended";
```

Rules:

- `enterprise_pending`: team exists, billing not configured.
- `trial`: enabled for configured internal/beta accounts.
- `enterprise`: sales/ops enabled.
- `suspended`: team context resolves as invalid for execution and mutation routes, but remains visible for owners/admins to diagnose.

## Billing Subject Rules

Every team-context sandbox or model execution record must carry:

- `product_team_id`
- `actor_user_id`
- `billing_subject`

Allowed billing subjects for this phase:

- `personal_vercel`: actor's linked Vercel billing project.
- `platform`: existing platform entitlement.
- `team_deferred`: display-only state, never used for launch.

If team context is active and neither `personal_vercel` nor `platform` is valid for the actor, deny with `TEAM_BILLING_NOT_CONFIGURED`.

## Creation Gate

Team creation gate is introduced in Slice 01 and enforced in Slice 07. This slice owns the user-facing packaging polish and plan-state restrictions, not the first security gate.

## Billing UI

Team settings billing section shows:

- Plan.
- Status.
- Billing target state: `not_configured`, `personal_actor`, `platform`, or `future_team_billing`.
- Vercel billing target fields only when explicitly configured and valid.

## Acceptance Criteria

- Suspended team blocks execution and mutation contexts.
- Billing UI is read-only and accurately reflects the active subject.
- Team-context sandbox launch cannot silently bill another member.
- Existing personal sandbox billing tests do not regress.

## Tests

- Unit: suspended team context blocks capability resolution.
- Unit: billing presenter maps plan/status/target state.
- Unit: `TEAM_BILLING_NOT_CONFIGURED` denies before SDK calls.
- E2E: non-eligible user sees disabled/unavailable team creation.

## Handoff

Real billing needs a separate spec that decides whether team billing uses WorkOS, Stripe, Vercel teams, owner-admin Vercel credentials, or a platform-funded plan.
