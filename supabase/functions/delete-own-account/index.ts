import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const jsonHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const pageSize = 100;

async function listFolderPaths(
  adminClient: ReturnType<typeof createClient>,
  bucket: string,
  folder: string,
): Promise<string[]> {
  const paths: string[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await adminClient.storage.from(bucket).list(folder, {
      limit: pageSize,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw error;
    const entries = data ?? [];
    for (const entry of entries) {
      const path = `${folder}/${entry.name}`;
      if (entry.id) paths.push(path);
      else paths.push(...await listFolderPaths(adminClient, bucket, path));
    }
    if (entries.length < pageSize) break;
    offset += entries.length;
  }
  return paths;
}

async function removeStoragePaths(
  adminClient: ReturnType<typeof createClient>,
  bucket: string,
  paths: string[],
) {
  for (let offset = 0; offset < paths.length; offset += pageSize) {
    const { error } = await adminClient.storage.from(bucket).remove(paths.slice(offset, offset + pageSize));
    if (error) throw error;
  }
}

async function listOwnedCommunityMedia(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
): Promise<{ communityPosts: string[]; communityIcons: string[] }> {
  const communityPosts: string[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await adminClient
      .from('community_posts')
      .select('media_path')
      .eq('author_id', userId)
      .not('media_path', 'is', null)
      .order('id')
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const rows = data ?? [];
    communityPosts.push(...rows.flatMap((row) => row.media_path ? [row.media_path] : []));
    if (rows.length < pageSize) break;
  }

  const communityIcons: string[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await adminClient
      .from('communities')
      .select('icon_path')
      .eq('owner_id', userId)
      .not('icon_path', 'is', null)
      .order('id')
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const rows = data ?? [];
    communityIcons.push(...rows.flatMap((row) => row.icon_path ? [row.icon_path] : []));
    if (rows.length < pageSize) break;
  }

  return { communityPosts, communityIcons };
}

async function removeOwnedMedia(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
) {
  for (const bucket of ['avatars', 'videos', 'thumbnails', 'captions', 'stories', 'highlights', 'chat-media']) {
    const paths = await listFolderPaths(adminClient, bucket, userId);
    await removeStoragePaths(adminClient, bucket, paths);
  }

  const { communityPosts, communityIcons } = await listOwnedCommunityMedia(adminClient, userId);
  await removeStoragePaths(adminClient, 'community-posts', communityPosts);
  await removeStoragePaths(adminClient, 'community-icons', communityIcons);
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: jsonHeaders });
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed.' }), {
      status: 405,
      headers: jsonHeaders,
    });
  }

  const authorization = request.headers.get('Authorization');
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    return new Response(JSON.stringify({ error: 'Authentication is required.' }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'Account deletion is not configured.' }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await callerClient.auth.getUser(token);
  if (userError || !userData.user) {
    return new Response(JSON.stringify({ error: 'The session is invalid or expired.' }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    await removeOwnedMedia(adminClient, userData.user.id);
  } catch (cleanupError) {
    console.error('Unable to remove account media before deletion.', cleanupError);
    return new Response(JSON.stringify({ error: 'Unable to remove account media.' }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(userData.user.id);
  if (deleteError) {
    console.error('Unable to delete the authenticated account.', { code: deleteError.name });
    return new Response(JSON.stringify({ error: 'Unable to delete the account.' }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  return new Response(JSON.stringify({ deleted: true }), {
    status: 200,
    headers: jsonHeaders,
  });
});
