# Scheduled posts

Scheduled video files upload immediately. After the existing `finalize_post` path verifies the uploaded object, it marks a future-dated post as `scheduled`; posts whose selected time has passed during upload go live immediately. Times are entered in the device's local time zone and stored as absolute `timestamptz` instants, so travel or a later time-zone change does not move a post's go-live instant.

The `publish-scheduled-posts` Edge Function handles due posts and sends go-live pushes to their accepted followers. It also accepts an authenticated app request to publish a scheduled post now. The function validates app sessions itself because scheduler invocations use a shared secret instead of a user JWT.

## Minute scheduler

Invoke the function with an external scheduler at least once per minute. No `pg_cron` extension or database scheduler is required. Configure the Edge Function secret `SCHEDULED_POSTS_WEBHOOK_SECRET` with a long random value, then configure the scheduler with:

- Method: `POST`
- URL: `https://<project-ref>.supabase.co/functions/v1/publish-scheduled-posts`
- Header: `x-scheduler-secret: <the configured secret>`
- Body: `{}`
- Interval: one minute

The function only processes posts still in `scheduled` status and whose `scheduled_at` is due. Concurrent or repeated invocations are safe: the database locks each row and finalizes it through `finalize_post`. Keep the secret only in the scheduler's secret store, never in the app or repository.

If both `pg_cron` and `pg_net` are already enabled, the same endpoint can be called from a cron job. Store the webhook secret in Supabase Vault first, substitute the project URL, and run this SQL only after verifying that both extensions are installed:

```sql
select cron.schedule(
  'publish-scheduled-posts-every-minute',
  '* * * * *',
  $job$
    select net.http_post(
      url := 'https://<project-ref>.supabase.co/functions/v1/publish-scheduled-posts',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-scheduler-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'scheduled_posts_webhook_secret'
          limit 1
        )
      ),
      body := '{}'::jsonb
    );
  $job$
);
```

## Recovery and deletion

Failed video uploads retain their scheduled time in the local resumable upload job and the post record. Retrying uploads the remaining file and finalizes through the same path; if its requested time has passed, the post publishes immediately. Account deletion continues to remove the user's storage files and local upload data, while the post foreign key cascades its scheduled records.

The database migration adds only the `scheduled`/`cancelled` states and `scheduled_at`, with owner-scoped scheduling RPCs. Authenticated clients receive insert permission only for the schedule timestamp; changes to a scheduled time, immediate publishing, and cancellation are checked in `SECURITY DEFINER` functions with fixed search paths.

The local date/time controls use the device's current time zone when entered, then store an absolute UTC instant. On Android and iOS the date and time are selected with the SDK 57-compatible native picker; web retains text-entry controls. A selected time must be at least 10 minutes and at most 30 days in the future.

## Manual checks

- [ ] On Android and iOS, choose a future date and time with the native controls and confirm the summary uses the device's local time.
- [ ] Confirm the app rejects a time less than 10 minutes ahead and one more than 30 days ahead; verify the server rejects the same invalid values.
- [ ] Schedule a video, close and reopen the app during upload, and confirm the upload resumes with its original schedule.
- [ ] Let an upload finish before its selected time and confirm it remains out of feeds until due; use a schedule time that passes during upload and confirm finalization publishes it immediately.
- [ ] Reschedule, publish now, and cancel a scheduled post; confirm cancelled media is removed and the schedule list refreshes.
- [ ] Change the device time zone after scheduling and confirm the absolute scheduled instant is unchanged.
- [ ] Verify accepted followers receive a go-live push only when enabled, not during teen quiet hours, and never when either account has blocked the other.
- [ ] On web, verify the date/time text-entry fallback still validates the same 10-minute/30-day window.
