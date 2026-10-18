update storage.buckets
set allowed_mime_types = array(
  select distinct mime_type
  from unnest(coalesce(allowed_mime_types, '{}'::text[]) || array[
    'audio/mpeg',
    'audio/aac',
    'audio/3gpp',
    'audio/ogg'
  ]) as mime_type
)
where id = 'chat-media';
