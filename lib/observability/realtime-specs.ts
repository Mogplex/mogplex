import type { RealtimeRefreshSpec } from "@/hooks/use-realtime-route-refresh";

export const USER_AI_CALLS_REALTIME_SPEC = {
  table: "ai_calls",
  filter: "user_id=eq.$USER_ID",
} satisfies RealtimeRefreshSpec;

export const USER_AI_CALL_EVENTS_REALTIME_SPEC = {
  table: "ai_call_events",
  filter: "user_id=eq.$USER_ID",
} satisfies RealtimeRefreshSpec;

export const USER_AUTOMATION_DISPATCH_EVENTS_REALTIME_SPEC = {
  table: "automation_dispatch_events",
  filter: "user_id=eq.$USER_ID",
} satisfies RealtimeRefreshSpec;

export const USER_LIMIT_EVENTS_REALTIME_SPEC = {
  table: "limit_events",
  filter: "user_id=eq.$USER_ID",
} satisfies RealtimeRefreshSpec;

export const USER_SANDBOXES_REALTIME_SPEC = {
  table: "sandboxes",
  filter: "user_id=eq.$USER_ID",
} satisfies RealtimeRefreshSpec;

export const JOB_RUNS_REALTIME_SPEC = {
  table: "job_runs",
} satisfies RealtimeRefreshSpec;

export const OBSERVABILITY_STATS_REALTIME_SPECS = [
  USER_AI_CALLS_REALTIME_SPEC,
  USER_SANDBOXES_REALTIME_SPEC,
  JOB_RUNS_REALTIME_SPEC,
  USER_AUTOMATION_DISPATCH_EVENTS_REALTIME_SPEC,
  USER_LIMIT_EVENTS_REALTIME_SPEC,
] satisfies RealtimeRefreshSpec[];

export const OBSERVABILITY_JOBS_REALTIME_SPECS = [
  JOB_RUNS_REALTIME_SPEC,
  USER_AI_CALLS_REALTIME_SPEC,
  USER_AUTOMATION_DISPATCH_EVENTS_REALTIME_SPEC,
] satisfies RealtimeRefreshSpec[];

export const OBSERVABILITY_ACTIVITY_REALTIME_SPECS = [
  USER_AI_CALLS_REALTIME_SPEC,
] satisfies RealtimeRefreshSpec[];
