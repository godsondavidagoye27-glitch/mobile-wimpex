# Calling and push deployment checklist

## Android FCM and iOS APNs

- In Firebase, create an Android app using `app.wimpex.mobile` and download its `google-services.json`.
- Upload that file to the EAS `development`, `preview`, and/or `production` environment as a **file** variable named `GOOGLE_SERVICES_JSON`. Do not commit it. `app.config.js` consumes the EAS-provided file path as `android.googleServicesFile`.
- In Expo/EAS credentials, upload Firebase Cloud Messaging v1 service-account credentials for the matching Android application. A local `google-services.json` file alone does not configure Expo's hosted push service.
- Configure APNs credentials for the iOS bundle identifier `app.wimpex.mobile` in EAS credentials. Confirm the Apple Push Notifications entitlement is enabled for the App ID.
- Set the non-secret `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and Google OAuth client values in each EAS environment referenced by `eas.json`. Production config validation fails early if the required public values are absent.
- Apply `supabase/migrations/20261018020000_call_lifecycle_reliability.sql` and deploy `livekit-call` and `chat-push`. No migration was applied to a remote Supabase project as part of the code changes.
- Confirm Android channels named `default` and `calls` exist after install. Android 13+ notification permission is requested after sign-in; people can open system settings from the notification warning.

Native configuration changes require a new build; an OTA update cannot add the FCM file, notification icon/channel manifest configuration, or Android Bluetooth permission:

```powershell
npx eas-cli@latest build --profile preview --platform android
npx eas-cli@latest build --profile preview --platform ios
```

## Stale call cleanup

The new migration schedules `reap-stale-call-sessions` every minute when `pg_cron` is already installed. If it is not installed, enable `pg_cron` in the Supabase Dashboard and schedule:

```sql
select cron.schedule(
  'reap-stale-call-sessions',
  '* * * * *',
  'select public.reap_stale_call_sessions();'
);
```

Verify the job in `cron.job` and its executions in `cron.job_run_details`. The cleanup marks expired ringing sessions `missed`, connecting sessions without activity for 60 seconds `ended`, and active sessions without a heartbeat for 90 seconds `ended`. A connected client sends activity heartbeats every 20 seconds.

## Background-call limitation and OTA recovery

Wimpex does not currently configure a LiveKit foreground service or iOS audio background mode. Calls and live streams may pause or disconnect when the app is backgrounded or terminated; users should keep the app in the foreground for a reliable call. A server-side stale-session reaper ensures abandoned calls do not block a later call.

EAS build profiles map to `development`, `preview`, and `production` update channels and use the app-version runtime policy. Keep OTA updates compatible with the installed native build. Native permission, plugin, or dependency changes require a new binary. If an OTA update causes a startup regression, roll back to the previous update from EAS Update or publish a corrected update on the same channel; keep the native binary available because OTA rollback cannot alter native configuration.

## Manual call checks

- Caller and callee foreground: call rings without push; answer; hang up from either side; confirm both screens leave the active state.
- Callee foreground with push disabled or no token: call still starts, the caller sees the notification limitation, and the in-app incoming call route opens.
- Push-enabled Android/iOS device: confirm a call notification is delivered and tapping it opens the matching incoming call once.
- Deny microphone/camera permissions: confirm a clear explanation and an Open settings action.
- Leave the call with Android Back, navigate away, or disconnect LiveKit: confirm the session ends, and a new call can start after the stale window.
- Confirm a terminal call is reflected by the polling fallback if Realtime is unavailable.

Push delivery and foreground incoming-call routing require a real device and the deployed Supabase/EAS credentials to validate; local unit tests do not prove provider delivery.
