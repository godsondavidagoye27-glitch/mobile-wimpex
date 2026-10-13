alter table public.posts
  add column is_demo boolean not null default false;

create index posts_demo_author_idx
  on public.posts (author_id, id)
  where is_demo;
