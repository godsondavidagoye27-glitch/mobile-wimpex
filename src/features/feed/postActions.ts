import { getSupabaseClient } from '../../lib/supabase';

async function getCurrentUserId() {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) throw error;
  if (!data.session?.user) throw new Error('Sign in to interact with videos.');
  return data.session.user.id;
}

export async function setPostLiked(postId: string, liked: boolean) {
  const userId = await getCurrentUserId();
  const client = getSupabaseClient();
  if (liked) {
    const { error } = await client.from('post_likes').delete().eq('post_id', postId).eq('user_id', userId);
    if (error) throw error;
    return;
  }

  const { error } = await client.from('post_likes').insert({ post_id: postId, user_id: userId });
  if (error && error.code !== '23505') throw error;
}

export async function setPostSaved(postId: string, saved: boolean) {
  const userId = await getCurrentUserId();
  const client = getSupabaseClient();
  if (saved) {
    const { error } = await client.from('post_saves').delete().eq('post_id', postId).eq('user_id', userId);
    if (error) throw error;
    return;
  }

  const { error } = await client.from('post_saves').insert({ post_id: postId, user_id: userId });
  if (error && error.code !== '23505') throw error;
}

export async function recordPostView(postId: string) {
  const userId = await getCurrentUserId();
  const { error } = await getSupabaseClient().from('post_views').insert({ post_id: postId, user_id: userId });
  if (error && error.code !== '23505') throw error;
}

export async function incrementPostShare(postId: string, shareId: string) {
  const { error } = await getSupabaseClient().rpc('increment_share', { post_id: postId, share_id: shareId });
  if (error) throw error;
}
