# Push notifications

The mobile client uses Expo Notifications SDK 57. The root app must mount
`NotificationLifecycle` inside the Expo Router tree (for example beside
`OnlinePresence` in `src/app/_layout.tsx`). The component follows Supabase auth
session changes, synchronizes already-granted notification permissions, handles
notification taps, and verifies active conversation membership before routing.
Push permission is requested only when a user enables **Push notifications** in
Settings.

## Supabase setup

1. Apply `supabase/migrations/20261013060000_push_notifications.sql` after the
   chat schema migration.
2. Deploy the `chat-push` Edge Function:

   ```powershell
   npx supabase functions deploy chat-push --no-verify-jwt
   ```

3. Set a long random webhook secret and configure the function secrets:

   ```powershell
   supabase secrets set PUSH_NOTIFICATION_WEBHOOK_SECRET="<random-secret>"
   ```

   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are supplied to hosted Edge
   Functions by Supabase. Never put the service-role key or webhook secret in
   app configuration or an `EXPO_PUBLIC_` variable.

4. In the Supabase Dashboard, create a Database Webhook for `public.messages`
   on **INSERT**, targeting the `chat-push` function. Send
   `x-webhook-secret: <same-random-secret>`. Do not expose this secret to the
   mobile app.
5. Configure the EAS project’s iOS Push Notifications capability/APNs
   credentials and Android FCM v1 credentials. Build and test a development
   client or production build; remote push notifications are not available in
   Expo Go.

The function re-reads the inserted message and current conversation membership
from Supabase rather than trusting message text from the webhook payload. It
skips deleted, demo, call, system, read-only, muted, blocked, and already-read
messages, and sends only when both `push_enabled` and `notify_messages` allow
delivery. Push content omits message text. Expo `DeviceNotRegistered` responses
remove the stale token; successful deliveries are deduplicated per message,
recipient, and installation.

## Manual verification

1. Apply the migration and deploy/configure the webhook and provider credentials.
2. On a physical iOS or Android development build, sign in, enable Push
   notifications, and grant the OS permission. Confirm a row appears in
   `device_push_tokens` for the signed-in user.
3. Send a chat message from a second account. Confirm a push arrives only when
   the recipient has enabled both push and message notifications and the
   conversation is unmuted and unread.
4. Tap the notification. Confirm the app opens the corresponding chat only for
   the same signed-in recipient and an active conversation member.
5. Disable Push notifications and confirm the installation token is removed.
   Sign out and confirm the current installation token is removed before the
   auth session ends.
6. Test a blocked sender, muted/read conversation, deleted message, demo
   conversation, expired token, and duplicate webhook delivery. No message body
   should appear in the OS notification.

Expo SDK 57 reference: <https://docs.expo.dev/versions/v57.0.0/sdk/notifications/>.
