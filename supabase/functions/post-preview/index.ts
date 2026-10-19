import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const html = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[character] ?? character));

function getPublicBaseUrl() {
  const value = Deno.env.get('PUBLIC_WEB_BASE_URL') ?? 'https://wimpex.example';
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:') throw new Error('PUBLIC_WEB_BASE_URL must use HTTPS.');
  return parsed.toString().replace(/\/$/, '');
}

Deno.serve(async (request) => {
  const base = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!base || !key) return new Response('Preview unavailable.', { status: 503 });

  const id = new URL(request.url).searchParams.get('id');
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return new Response('Not found.', { status: 404 });
  const admin = createClient(base, key);
  const { data: post, error: postError } = await admin.from('posts')
    .select('id,author_id,caption,audience,status,moderation_status,thumb_path')
    .eq('id', id)
    .maybeSingle();
  if (postError) {
    console.error('Public post preview lookup failed.', { code: postError.code });
    return new Response('Preview unavailable.', { status: 503 });
  }
  if (!post || post.status !== 'published' || post.audience !== 'everyone' || post.moderation_status !== 'clear') {
    return new Response('Not found.', { status: 404 });
  }
  const { data: author, error: authorError } = await admin.from('profiles')
    .select('username,is_private,date_of_birth')
    .eq('id', post.author_id)
    .maybeSingle();
  if (authorError) {
    console.error('Public profile preview lookup failed.', { code: authorError.code });
    return new Response('Preview unavailable.', { status: 503 });
  }
  const age = author?.date_of_birth ? ageOn(new Date(), new Date(`${author.date_of_birth}T00:00:00`)) : null;
  if (!author || author.is_private || (age !== null && age < 18)) return new Response('Not found.', { status: 404 });

  let image = '';
  if (post.thumb_path) {
    const { data, error } = await admin.storage.from('thumbnails').createSignedUrl(post.thumb_path, 300);
    if (error) console.error('Post preview thumbnail could not be signed.', { code: error.name });
    else if (data?.signedUrl) image = `<meta property="og:image" content="${html(data.signedUrl)}">`;
  }
  const title = `Video by @${author.username}`;
  const description = post.caption || `Watch this video on Wimpex.`;
  const canonical = `${getPublicBaseUrl()}/post/${encodeURIComponent(post.id)}`;
  const safeTitle = html(title);
  const safeDescription = html(description);
  const safeCanonical = html(canonical);
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${safeTitle}</title><meta name="description" content="${safeDescription}"><meta property="og:type" content="video.other"><meta property="og:title" content="${safeTitle}"><meta property="og:description" content="${safeDescription}">${image}<meta property="og:url" content="${safeCanonical}"></head><body><main><h1>${safeTitle}</h1><p>${safeDescription}</p><a href="${safeCanonical}">Open in Wimpex / Get the app</a></main></body></html>`;
  return new Response(page, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, max-age=60' } });
});

function ageOn(today: Date, birthday: Date) {
  let age = today.getFullYear() - birthday.getFullYear();
  if (today.getMonth() < birthday.getMonth()
    || (today.getMonth() === birthday.getMonth() && today.getDate() < birthday.getDate())) age -= 1;
  return age;
}
