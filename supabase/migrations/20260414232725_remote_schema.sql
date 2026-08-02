drop extension if exists "pg_net";

alter table "public"."profiles" add column "default_model" text default 'minimax/minimax-m2.5'::text;

alter table "public"."profiles" add column "theme" text default 'dark'::text;

alter table "public"."repos" add column "is_monorepo" boolean not null default false;

alter table "public"."repos" add column "parent_repo_id" uuid;

alter table "public"."repos" add column "runtime" text;

alter table "public"."sandboxes" add column "runtime" text;

CREATE INDEX repos_parent_repo_idx ON public.repos USING btree (parent_repo_id) WHERE (parent_repo_id IS NOT NULL);

CREATE UNIQUE INDEX repos_user_github_root_idx ON public.repos USING btree (user_id, github_id, COALESCE(root_directory, ''::text));

alter table "public"."repos" add constraint "repos_parent_repo_id_fkey" FOREIGN KEY (parent_repo_id) REFERENCES public.repos(id) ON DELETE SET NULL not valid;

alter table "public"."repos" validate constraint "repos_parent_repo_id_fkey";

alter table "public"."repos" add constraint "repos_runtime_check" CHECK (((runtime IS NULL) OR (runtime = ANY (ARRAY['node22'::text, 'node24'::text, 'python3.13'::text])))) not valid;

alter table "public"."repos" validate constraint "repos_runtime_check";

alter table "public"."sandboxes" add constraint "sandboxes_runtime_check" CHECK (((runtime IS NULL) OR (runtime = ANY (ARRAY['node22'::text, 'node24'::text, 'python3.13'::text])))) not valid;

alter table "public"."sandboxes" validate constraint "sandboxes_runtime_check";


