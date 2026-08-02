alter table public.agents
  alter column model set default 'minimax/minimax-m2.7';

alter table public.conversations
  alter column model set default 'minimax/minimax-m2.7';

alter table public.skills
  alter column model set default 'minimax/minimax-m2.7';
