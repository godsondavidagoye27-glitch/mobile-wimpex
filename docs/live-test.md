# Live streaming test

The live flow uses the installed LiveKit SDK and existing Expo native integration. No native packages were added.

## App flow

Open the **Live** tab to see active streams, or use **Go live** to start hosting. The database enforces adult-only hosting. Hosts connect with camera and microphone publishing grants; viewers receive subscribe-only grants. The Home feed shows active live rooms above the story rail.

The live room pauses its connection when the screen loses focus or the app backgrounds. Hosts should end the stream before leaving; abandoned sessions are marked ended by the stale-stream reaper. Live streams are not recorded or replayed.

Manual checks:

1. Host from an adult account and confirm the preview appears before the stream becomes visible. Confirm a minor or demo account cannot host.
2. Open the stream from Home and the Live tab as an accepted follower. Confirm a private host is hidden from non-followers.
3. Confirm viewers can hear and see the host but cannot publish camera, microphone, or data.
4. Send live chat from two viewers and confirm messages arrive over Realtime and are limited to 500 characters.
5. As host, mute a viewer, ban a viewer, and delete a message. Confirm mute prevents new chat messages and a ban prevents rejoining.
6. End the stream as host and confirm viewers are disconnected and returned to the Live list.
7. Turn off `notify_live` for a follower and confirm no live notification is created for that follower.

## Apply and test the database

Use a local Supabase project with the CLI and Docker available:

```powershell
supabase start
supabase db reset
supabase test db supabase/tests/live_streams_security.sql
```

The migration creates `live_streams`, `live_messages`, `live_mutes`, and `live_bans`. Only authenticated users can read streams they host or can view, and messages for streams they can view. Writes and moderation use the RPCs instead of direct table access.

## Configure the LiveKit functions

Set these Edge Function secrets in the Supabase Dashboard or with the Supabase CLI:

```powershell
supabase secrets set LIVEKIT_URL=wss://your-livekit-host LIVEKIT_API_KEY=your-key LIVEKIT_API_SECRET=your-secret
```

`LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` use the same server-side names as `livekit-call`. Do not put the API key or secret in the Expo app. Deploy `live-token` and `live-moderate` with JWT verification enabled.

The authenticated host calls `start_live(title)`, invokes `live-token` with `{ "streamId": "..." }`, connects and publishes camera/microphone, then calls `mark_live_started(streamId)`. Send `live_heartbeat(streamId)` periodically while hosting and call `end_live(streamId)` when done. A viewer gets a subscribe-only token from `live-token`; viewer messages go through `send_live_message(streamId, body)`. Subscribe to Postgres Changes on `live_streams` and `live_messages` in the `public` schema. Realtime authorization uses the same row policies as table reads.

Moderation requests to `live-moderate` use `{ "action": "mute" | "ban" | "delete_message", "streamId": "...", ... }`. Mutes block chat for the selected duration. Bans block stream access and new token requests, and the function asks LiveKit to remove a connected participant. LiveKit token revocation on removal depends on the LiveKit server offering that capability. A warning in the response means the database ban was applied but the LiveKit removal did not complete.

## Schedule stale stream cleanup

The database reaper ends `starting` streams after two minutes without a successful start and `live` streams after 90 seconds without a heartbeat. It returns the number of rows ended. Supabase Cron uses `pg_cron`; enable the extension from **Database > Extensions** if it is not already enabled, then create a job from **Integrations > Cron** or run this SQL as a database administrator:

```sql
select cron.schedule(
  'reap-stale-lives',
  '* * * * *',
  $$ select public.reap_stale_lives(); $$
);
```

This schedules a database function directly, so it does not require an Edge Function secret or an HTTP call. Check job runs and failures in the Cron dashboard or `cron.job_run_details`.

To remove the schedule:

```sql
select cron.unschedule('reap-stale-lives');
```
