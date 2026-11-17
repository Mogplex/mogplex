# Run delivery follow-through

Approving an implementation in Control or Slack authorizes opening its PR and fixing CI failures and actionable review findings within the original task. It does not authorize merging. The agent retains any explicit merge authority from the user's original request.

Approval is bound to the current checkpoint. A successful agent pass is shown separately from PR, CI/review, merge, and production deployment evidence. Production status requires a GitHub production deployment for the exact merge commit; a preview, green CI, or agent claim is not deployment proof. Missing deployment access leaves that status unavailable without hiding PR evidence.

Verified GitHub events refresh owned runs on the matching branch or commit. The existing resume task rechecks the current PR head and failure/review revision before atomically binding its worker and AI call. It resumes the saved workspace. Duplicate deliveries do not create duplicate repairs; unchanged failures already attempted remain visible as needing attention. Cancelled runs never restart from delivery events. Manual status refresh never starts an agent.

The GitHub App must subscribe to `check_run`, `workflow_run`, `status`, `pull_request`, `pull_request_review`, `pull_request_review_thread`, `pull_request_review_comment`, and `deployment_status`. It needs read access to Actions, checks/statuses, pull requests, and deployments. The checked-in app manifest includes these for new installations; existing apps must update subscriptions/permissions in GitHub App settings. Both the verified HTTP webhook path and hosted Trigger webhook source dispatch these events.

Receipts and authorization use existing `external_agent_runs.metadata` fields: `delivery_progress`, `delivery_follow_through`, `delivery_authorized_at`, and `delivery_last_repair_revision`. Monotonic timestamps and the active AI call fence stale status writes. No database migration or polling task is needed.
