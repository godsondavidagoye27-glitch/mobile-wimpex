import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const jsonHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

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

  let offset = 0;
  const pageSize = 500;
  while (true) {
    const { data: posts, error: postsError } = await adminClient
      .from('posts')
      .select('captions_path')
      .eq('author_id', userData.user.id)
      .not('captions_path', 'is', null)
      .order('id')
      .range(offset, offset + pageSize - 1);
    if (postsError) {
      console.error('Unable to list account captions before deletion.', { code: postsError.code });
      return new Response(JSON.stringify({ error: 'Unable to remove account captions.' }), {
        status: 500,
        headers: jsonHeaders,
      });
    }
    const accountPosts = posts ?? [];
    const paths = accountPosts.flatMap((post) => post.captions_path ? [post.captions_path] : []);
    if (paths.length) {
      const { error: removeError } = await adminClient.storage.from('captions').remove(paths);
      if (removeError) {
        console.error('Unable to remove account captions.', { code: removeError.name });
        return new Response(JSON.stringify({ error: 'Unable to remove account captions.' }), {
          status: 500,
          headers: jsonHeaders,
        });
      }
    }
    if (accountPosts.length < pageSize) break;
    offset += pageSize;
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
