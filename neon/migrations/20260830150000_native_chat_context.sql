alter table public.conversations
  add column if not exists repo_id uuid references public.repos(id) on delete set null,
  add column if not exists workspace_session_id text;

with latest_repo as (
  select distinct on (user_id, conversation_id)
    user_id,
    conversation_id,
    repo_id
  from public.ai_calls
  where conversation_id is not null
    and repo_id is not null
  order by user_id, conversation_id, started_at desc, id desc
)
update public.conversations as conversation
set repo_id = latest_repo.repo_id
from latest_repo
where conversation.user_id = latest_repo.user_id
  and conversation.id = latest_repo.conversation_id
  and conversation.repo_id is null;

create index if not exists idx_conversations_repo
  on public.conversations (repo_id);

create index if not exists idx_conversations_user_repo_updated
  on public.conversations (user_id, repo_id, updated_at desc);
