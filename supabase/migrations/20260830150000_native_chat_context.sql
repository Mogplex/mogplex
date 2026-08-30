alter table public.conversations
  add column if not exists repo_id uuid references public.repos(id) on delete set null,
  add column if not exists workspace_session_id text,
  add column if not exists sandbox_id uuid references public.sandboxes(id) on delete set null;

with latest_context as (
  select distinct on (call.user_id, call.conversation_id)
    call.user_id,
    call.conversation_id,
    call.repo_id,
    sandbox.id as sandbox_id
  from public.ai_calls as call
  left join public.sandboxes as sandbox
    on sandbox.id::text = call.metadata->>'sandbox_id'
   and sandbox.user_id = call.user_id
   and sandbox.repo_id = call.repo_id
  where call.conversation_id is not null
    and call.repo_id is not null
  order by call.user_id, call.conversation_id, call.started_at desc, call.id desc
)
update public.conversations as conversation
set repo_id = coalesce(conversation.repo_id, latest_context.repo_id),
    sandbox_id = coalesce(conversation.sandbox_id, latest_context.sandbox_id)
from latest_context
where conversation.user_id = latest_context.user_id
  and conversation.id = latest_context.conversation_id
  and (conversation.repo_id is null or conversation.sandbox_id is null);

create index if not exists idx_conversations_repo
  on public.conversations (repo_id);

create index if not exists idx_conversations_user_repo_updated
  on public.conversations (user_id, repo_id, updated_at desc);
