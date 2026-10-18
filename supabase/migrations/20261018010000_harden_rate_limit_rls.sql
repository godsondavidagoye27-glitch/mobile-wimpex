alter table public.chat_message_rate_limits enable row level security;
alter table public.story_creation_rate_limits enable row level security;
alter table public.story_view_rate_limits enable row level security;

revoke execute on function public.set_follow_status() from public, anon, authenticated;
revoke execute on function public.update_comment_like_counter() from public, anon, authenticated;
revoke execute on function public.update_community_member_count() from public, anon, authenticated;
revoke execute on function public.update_community_post_count() from public, anon, authenticated;
revoke execute on function public.update_post_counter() from public, anon, authenticated;
