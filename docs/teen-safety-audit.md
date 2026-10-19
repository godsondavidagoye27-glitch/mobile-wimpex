# Existing teen-safety audit

Reviewed migrations and client flows before proposing additional teen settings.

## Existing protections

- **Age gate and defaults:** profile creation rejects users younger than 13. The profile trigger forces accounts under 18 to private and sets their DM policy to friends (`20261013000000_signup_profiles.sql`).
- **Profile edits:** server-side profile update checks prevent minors from turning off the private-account default (`20261014030000_profiles_follows.sql`, with later hardening in `20261018050000_allow_internal_verified_flag_updates.sql`).
- **Direct messages and groups:** chat uses `chat_user_is_minor`; starting a direct conversation involving a minor requires mutual accepted follows, and group membership checks require mutual accepted follows for participants paired with a minor (`20261013030000_chat_schema.sql`).
- **Online presence:** `chat_user_shares_online` returns false for minors, and Settings disables the online-status toggle for them (`20261013030000_chat_schema.sql`, `src/app/settings.tsx`).
- **Stories:** `story_user_is_minor`, `can_view_story`, `can_reply_to_story`, story reply checks, expiration, and block checks are enforced in database functions and policies (`20261015000000_story_phase_9a.sql`, `20261015010000_story_phase_9a_completion.sql`, `20261015020000_story_replies.sql`).
- **Live hosting:** `start_live` and the hardened host path require the host to be 18 or older and reject demo/official accounts (`20261016000000_live_phase_9cd.sql`, `20261018080000_harden_start_live.sql`).
- **Adults-only communities:** community access and creation checks use the server-side birth date to exclude under-18 users from adults-only spaces (`20261014050000_communities_core.sql`).
- **Location:** the reviewed app configuration and feature routes do not request device location permissions or add location fields to profile settings.

## Teen controls added

Migration `20261025000000_teen_safety_controls.sql` adds an RLS-enabled, non-client-writable preference table and authenticated RPCs that verify the signed-in account is under 18. The Teen safety screen exposes quiet hours, the on-device daily time reminder, and the restricted-content filter. Settings are scoped to the user's own account; quiet-hours push checks run in both `chat-push` and `livekit-call`. Push evaluation fails closed if the setting cannot be read.

- Teen profiles are excluded from people search, suggestions, video search, hashtag discovery, and the For You feed. Direct profile lookup remains available when a user knows the username, and accepted followers can still use the private-account features.
- Existing direct-message creation already requires mutual accepted follows whenever either participant is under 18. The migration keeps this server-side rule and adds an assertion for it.
- Quiet hours use the saved IANA time zone and support intervals that cross midnight. Only chat and incoming-call pushes are currently sent by server code; other notification types are in-app rows and are not push-delivered.
- The daily use counter stays on the device and accumulates foreground time. It does not report screen-time data to Wimpex servers.
- Restricted-content filtering applies to posts with active `nudity` or `violence` moderation flags with scores of at least 0.5. It does not yet cover stories or community media.
- The app does not request device-location permission or collect location, so there is no location setting to enable.

The SQL assertion script is `supabase/tests/teen_safety_rules.sql`; it should be run after applying migrations locally.

Before release, apply `20261025000000_teen_safety_controls.sql` after `20261024000000_restricted_message_requests.sql`, then redeploy `chat-push` and `livekit-call`. The Play Store Data Safety form should reflect collection of teen safety preferences and the saved time-zone identifier. Daily foreground usage stays local and exact device location is not collected.

## Remaining gaps

- The current direct-message mutual-follow rule is stricter than “accepted followers only.” Restricted-account message requests are implemented separately.
- Teen profile suggestions and public discovery queries are server-filtered, but direct profile lookup remains possible by username. This does not make teen profiles public.
- Restricted-content filtering still needs integration with story and community media moderation.
- No guardian account linking is implemented. See the [guardian-pairing proposal](./guardian-pairing-proposal.md).

Do not present the teen-safety requirements as fully implemented until the remaining gaps are addressed and migrations are validated on a local database.
