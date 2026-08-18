-- Agent tool output is retained for user-visible transcripts and observability.
-- Remove credentials from existing JSON payloads before they can be replayed.
-- The Neon migration runner owns this file's transaction.

create or replace function public.redact_persisted_agent_secrets(value jsonb)
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $$
  select regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              value::text,
              '(?i)https://x-access-token:[^@[:space:]]+@github\\.com',
              'https://x-access-token:[redacted]@github.com',
              'g'
            ),
            '(?i)\\mgh[oprsu]_[A-Za-z0-9_]+\\M', '[redacted]', 'g'
          ),
          '(?i)\\mgithub_pat_[A-Za-z0-9_]+\\M', '[redacted]', 'g'
        ),
        '(?i)(bearer[[:space:]]+)[A-Za-z0-9._~+/=-]+', '\\1[redacted]', 'g'
      ),
      '(?i)\\msk-[A-Za-z0-9_-]{8,}\\M', '[redacted]', 'g'
    ),
    '(?i)\\msb_secret_[A-Za-z0-9_-]+\\M', '[redacted]', 'g'
  )::jsonb;
$$;

update public.control_sessions set messages = public.redact_persisted_agent_secrets(messages)
where messages::text ~ '(gh[oprsu]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{8,}|sb_secret_[A-Za-z0-9_-]+|x-access-token:|[Bb]earer[[:space:]])';

update public.conversations set messages = public.redact_persisted_agent_secrets(messages)
where messages::text ~ '(gh[oprsu]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{8,}|sb_secret_[A-Za-z0-9_-]+|x-access-token:|[Bb]earer[[:space:]])';

update public.conversations set local_msgs = public.redact_persisted_agent_secrets(local_msgs)
where local_msgs::text ~ '(gh[oprsu]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{8,}|sb_secret_[A-Za-z0-9_-]+|x-access-token:|[Bb]earer[[:space:]])';

update public.ai_calls set tool_calls = public.redact_persisted_agent_secrets(tool_calls)
where tool_calls::text ~ '(gh[oprsu]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{8,}|sb_secret_[A-Za-z0-9_-]+|x-access-token:|[Bb]earer[[:space:]])';

update public.ai_calls set error = public.redact_persisted_agent_secrets(to_jsonb(error)) #>> '{}'
where error ~ '(gh[oprsu]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{8,}|sb_secret_[A-Za-z0-9_-]+|x-access-token:|[Bb]earer[[:space:]])';

update public.ai_call_events set payload = public.redact_persisted_agent_secrets(payload)
where payload::text ~ '(gh[oprsu]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{8,}|sb_secret_[A-Za-z0-9_-]+|x-access-token:|[Bb]earer[[:space:]])';

update public.ai_call_events set message = public.redact_persisted_agent_secrets(to_jsonb(message)) #>> '{}'
where message ~ '(gh[oprsu]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{8,}|sb_secret_[A-Za-z0-9_-]+|x-access-token:|[Bb]earer[[:space:]])';

drop function public.redact_persisted_agent_secrets(jsonb);
