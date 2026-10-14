# Stories manual test

The story flow uses the installed Expo SDK 57 modules `expo-image-picker`, `expo-image-manipulator`, `expo-file-system`, `expo-video`, and `expo-crypto`. It uses React Native `Image` for display because `expo-image` is not installed. No native package was added.

## Database

Apply the story migrations, then run the focused SQL test:

```powershell
npx supabase db reset
npx supabase test db supabase/tests/stories_phase_9a.sql
npx supabase test db supabase/tests/stories_phase_9b.sql
```

The migration creates a private `stories` bucket and RLS policies. A story is readable only if its active database row references the object and `can_view_story` allows the current account. Stories expire 24 hours after database insertion. The database rejects client writes to the expiry and creation timestamps.

## Expired story cleanup

The cleanup function removes media for stories expired for more than one hour, then deletes the story row and its view rows. Deploy the function and set a random shared secret:

```powershell
npx supabase functions deploy purge-expired-stories
npx supabase secrets set STORY_PURGE_SECRET="<random-shared-secret>"
```

The Supabase Edge Function runtime supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The shared secret is checked in the `x-story-purge-secret` header. Never put any of these values in app configuration or source control.

To schedule the hourly request, enable `pg_cron` and `pg_net` in the Supabase Dashboard under **Database > Extensions**. Enable Vault if it is not already available. In the SQL editor, store the project URL, service role key, and the same shared secret in Vault. Replace the example values locally and do not commit them:

```sql
select vault.create_secret('https://<project-ref>.supabase.co', 'wimpex_project_url');
select vault.create_secret('<service-role-key>', 'story_purge_service_role_key');
select vault.create_secret('<random-shared-secret>', 'story_purge_secret');
```

Create the hourly job:

```sql
select cron.schedule(
  'purge-expired-stories',
  '0 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'wimpex_project_url')
      || '/functions/v1/purge-expired-stories',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'story_purge_service_role_key'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'story_purge_service_role_key'),
      'x-story-purge-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'story_purge_secret')
    ),
    body := '{}'::jsonb
  );
  $job$
);
```

Confirm the job is listed in `cron.job`, then inspect `cron.job_run_details` after the next hour. Confirm function logs show a successful response. If your project does not expose Vault, `pg_cron`, or `pg_net`, configure the same authenticated hourly HTTP request with an external scheduler and keep the shared secret in that scheduler's secret store.

## Device checklist

Use two real accounts. Include an accepted follower, an account that does not follow, a private account, a close friend, a blocked account, and an under-18 account.

1. Open Home and confirm the rail loads, the owner row is first, unseen stories appear before seen stories, and the rail refreshes after returning to Home and after one minute.
2. Create an image story from the camera and gallery. Confirm a large photo is resized to fit 1080 by 1920, is saved as JPEG, the caption limit is 120, and the selected caption background persists in the viewer.
3. Create videos at 15 seconds and 25 MB. Confirm a longer video shows `Stories can be up to 15 seconds. Choose a shorter video.` and an oversized video shows `This video is too large. Choose a video under 25 MB.`
4. Check Everyone, Followers, and Close friends visibility, including a private author. Block each account in turn and confirm neither direction can read their stories or storage media.
5. Open a story. Confirm a photo progress segment lasts five seconds, videos use their recorded duration, tap zones move backward or forward, holding pauses, swiping down closes, and changing the app or route pauses playback.
6. Confirm a story is marked viewed after it has been visible for one second, own views are not counted, and refreshing does not increment an existing view.
7. As the author, open the viewer list and paginate through viewers. Confirm other accounts cannot read that list.
8. Reply to stories with Everyone and Followers permissions. Confirm the reply opens a direct chat, obeys DM policy, blocks, and the mutual-follow restriction for minors.
9. Confirm a reply contains a story thumbnail and caption in chat, including after the story expires or is deleted. Confirm unreferenced media is purged.
10. Open a deleted, expired, or hidden story deep link. Confirm it shows `This story is no longer available.` with a Close button.
11. Turn on airplane mode during upload and close the app while uploading. Confirm failures are visible and no orphaned story is shown in the rail.

## Current environment limitations

The Supabase Cron schedule is not provisioned by the migration because it needs project-specific URL and secret values. The Dashboard extension, Vault secret, and Cron job setup above are required deployment steps. Story media referenced by a chat reply is retained after story expiry/deletion and remains private to active members of that direct conversation.
