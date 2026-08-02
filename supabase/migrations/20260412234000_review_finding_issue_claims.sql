alter table public.review_findings
  drop constraint if exists review_findings_status_check;

alter table public.review_findings
  add constraint review_findings_status_check
  check (status in ('open', 'issue_creating', 'issue_created', 'dismissed'));
