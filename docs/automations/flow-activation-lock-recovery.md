# Workflow Activation Lock Recovery

Workflow pause and resume operations use `public.flow_activation_locks` to
serialize the database update with the matching Trigger.dev schedule change.
Locks do not expire by age: the external request has no timeout, so an
age-based takeover could steal ownership from a live operation.

The application normally deletes its row in `finally`. Use this procedure only
when a process was terminated before cleanup and the workflow now returns
`FLOW_ACTIVATION_IN_PROGRESS` for every pause or resume attempt.

## Inspect

Run this read-only query with the flow ID:

```sql
select flow_id, lock_token, locked_at
from public.flow_activation_locks
where flow_id = '<flow-id>';
```

Before clearing the row, use the Vercel runtime logs to confirm that the
originating pause or resume request completed or was terminated. Also confirm
that no operator or user is currently retrying the same workflow. `locked_at`
is diagnostic context only; age by itself does not prove that the holder died.

## Clear the confirmed orphan

Copy the inspected `lock_token` into this compare-and-delete query:

```sql
delete from public.flow_activation_locks
where flow_id = '<flow-id>'
  and lock_token = '<inspected-lock-token>'
returning flow_id, lock_token, locked_at;
```

Execute it through the Supabase `execute_sql` path, which does not modify the
migration ledger. Exactly one returned row confirms recovery. If no row is
returned, stop: ownership changed after inspection, so the observed token must
not be cleared.

Retry pause or resume only after the conditional delete succeeds.
