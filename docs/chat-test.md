# Chat manual test checklist

Run this checklist against a development build after applying migrations. Rebuild the native development client when native packages or Expo plugins change:

```powershell
npx eas-cli@latest build --profile development --platform android
```

## Setup

- [ ] Create `.env.seed` using [demo-data.md](./demo-data.md), apply migrations, and seed with `npm run seed -- --me <your-account-email>`.
- [ ] In the Dashboard, configure the `public.messages` INSERT webhook and set `DEMO_MODE=true` only in the development project.
- [ ] Sign in as the seeded real account and open **Chats**.

## Chats and threads

- [ ] Confirm Ada, Tobi, Zee, and Kemi are mutual follows and appear as eligible contacts.
- [ ] Confirm Sade has no seeded follow relationship, Dayo refuses DMs, and the under-18 profile cannot be messaged without a mutual accepted follow.
- [ ] Open both seeded direct threads and the **Weekend crew** group. Confirm messages are ordered oldest-to-newest visually, unread counts are present, and a message becomes read when its newest item is visible.
- [ ] Send a message while online; confirm it appears immediately, sends once, and a retry after a temporary failure reconciles by client ID.
- [ ] Add and remove a reaction; confirm reaction counts update without duplicate reactions.
- [ ] Reply to a message, copy its text, and report or block a participant.
- [ ] Verify the official welcome conversation is read-only; its mute control remains available.

## Chat media

- [ ] Pick a photo; confirm it is resized/normalized, appears in the thread, and opens for recipients in the same active conversation.
- [ ] Send an MP4 video up to 60 seconds and 25 MB; confirm tapping it opens Expo Video playback controls.
- [ ] Record and send a voice message up to 2 minutes; confirm it plays, pauses, and reports its duration.
- [ ] Confirm files larger than 25 MB, non-MP4 video, unsupported file types, unknown sizes, and overlong/missing-duration media are rejected with a visible explanation.
- [ ] Confirm microphone denial is explained and does not block text chat; cancel a selected attachment without sending it.
- [ ] With a second signed-in account outside the conversation, verify media cannot be read or signed. Confirm active members can read it only while they remain in the conversation.
- [ ] Delete an attachment message and confirm its private object is removed; simulate an upload failure and confirm the local attachment remains available to retry.

## Realtime and lifecycle

- [ ] With a second client signed in, confirm messages arrive without refreshing and typing indicators expire when typing stops.
- [ ] Confirm online presence is visible only while allowed by the account's online-status setting and only for permitted chat peers.
- [ ] Navigate away from a thread and background the app; confirm typing/presence subscriptions stop and no stale online or typing state remains.
- [ ] Disable online status and message notifications in Settings, restart the app, and confirm settings persist.

## Policy, cleanup and failure states

- [ ] Run `npx supabase test db` and confirm the chat policy tests pass.
- [ ] Test blocked direct/group participants, group-size limits, restricted message media, and a rate-limited sender.
- [ ] Temporarily disconnect network access; confirm the chat list/thread shows an offline or retry state instead of an indefinite spinner.
- [ ] Run `npm run seed:clean`, confirm only tagged demo records/accounts and their owned assets are removed, then rerun the seed command.
- [ ] Confirm chat media uploads use the private `chat-media` bucket and message attachments are delivered through short-lived signed URLs, not public URLs.
