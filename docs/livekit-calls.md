# Phase 7D: LiveKit calling

The new `/call/[conversationId]` route provides an outgoing audio/video call screen and an incoming-call answer/decline screen. `src/features/calls/callService.ts` invokes the `livekit-call` Edge Function; no LiveKit API key or secret is included in the mobile app.

## Server setup

1. Create a LiveKit project and copy its WebSocket URL, API key, and API secret.
2. Set these Supabase Edge Function secrets (the URL must use `wss://` in production):

   ```powershell
   npx supabase secrets set LIVEKIT_URL=wss://YOUR_PROJECT.livekit.cloud LIVEKIT_API_KEY=YOUR_API_KEY LIVEKIT_API_SECRET=YOUR_API_SECRET
   ```

   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are supplied to deployed Supabase Edge Functions. Never add the LiveKit secret or service-role key to an `EXPO_PUBLIC_*` variable or the app bundle.

3. Apply the migration `supabase/migrations/20261013070000_livekit_calls.sql` after the existing chat migration, then deploy the function:

   ```powershell
   npx supabase db push
   npx supabase functions deploy livekit-call
   ```

   The function requires a valid Supabase user JWT (`verify_jwt = true`). It then independently verifies the user and checks direct-chat membership, adult eligibility, demo/official exclusions, block state, and the recipient's DM policy before creating or joining a room.

## Connecting the chat caller

From a chat action where the authenticated user is an active member of `conversationId`, navigate to the standalone call route:

```tsx
router.push({
  pathname: '/call/[conversationId]',
  params: { conversationId, mode: 'video' }, // use 'audio' for an audio-only call
});
```

For an incoming-call notification action, the existing `NotificationLifecycle`
handles the route. It expects the call's `call_sessions` row to exist, match the
recipient and conversation, and still be answerable. The Expo push data has this
shape:

```json
{
  "type": "incoming_call",
  "call_id": "<call-session-uuid>",
  "conversation_id": "<conversation-uuid>",
  "recipient_id": "<callee-user-uuid>",
  "media_type": "video"
}
```

The notification tap opens `/call/<conversationId>?callId=<call-session-uuid>&direction=incoming&mode=video`, where the recipient can answer or decline. Calls ring for 45 seconds. A caller screen can receive state changes while open through Supabase Realtime.

The Edge Function sends an Expo push after creating the call, only if the
recipient has `user_settings.push_enabled` enabled and has at least one
registered `device_push_tokens` destination. Expo ticket acceptance is the
delivery boundary: if push is disabled, there is no registered destination, or
Expo cannot accept any ticket, the function marks the newly created call ended
and returns a non-2xx error with a caller-visible explanation; it does not issue
a room token. If only some device tickets are accepted, the call proceeds and
the caller sees a warning. An accepted Expo ticket is not proof that the OS
displayed the notification, so push credentials and physical-device delivery
still need operational verification.

## Eligibility and lifecycle

- Only non-demo, non-official, adult users in a regular one-to-one conversation can call. Calls to groups and the read-only welcome conversation are rejected server-side.
- Existing blocks are enforced in both directions. The recipient's `dm_policy` is enforced; `friends` requires mutual accepted follows.
- Call session inserts/updates are server-only; authenticated participants can only read sessions covered by the chat membership RLS policy. The Realtime publication is enabled for the new table.
- Start creates a unique room name and a one-hour room-scoped token. Accept mints a token only for the callee. Tokens can publish camera/microphone media for video calls and microphone audio only for audio calls; data publishing is disabled.
- The client reports accepted/connected/ended/declined/missed lifecycle events. Stale ringing sessions expire after 45 seconds. LiveKit rooms close when empty according to the LiveKit project's room timeout.

## Native build

LiveKit requires a development/production native build and does not run in Expo Go. The required LiveKit Expo plugins and microphone/camera config are already in the app config. Rebuild after native configuration changes, for example:

```powershell
npx eas-cli@latest build --profile development --platform android
```
