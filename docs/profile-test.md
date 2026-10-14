# Profile and follow testing

## Apply the database changes

Apply `supabase/migrations/20261014030000_profiles_follows.sql` after the existing feed migrations. Profile editing, privacy, follow requests, blocking, profile post tabs, and profile counters depend on this migration.

## Automated database tests

Run the local Supabase database tests after the migration has been applied:

```powershell
npx supabase test db
```

`supabase/tests/profile_follows_security.sql` verifies pending and accepted follow counts, request ownership, counter write protection, block cleanup, and blocked profile/post access.

## Manual app checks

1. Create two accounts and make one account private in Settings.
2. From the other account, request to follow. Confirm the button shows pending and the private account's follow-request badge updates.
3. Accept and decline requests. Confirm the list and profile counts update without restarting either app.
4. Block the follower from the private profile. Confirm the relationship disappears, the profile and its videos are unavailable to the blocked account, and the blocked account cannot follow again.
5. Edit the profile name, username, bio, HTTPS link, and avatar. Confirm invalid usernames and links show a readable error, and a successful avatar change appears on the profile.
6. Pin up to three videos, then confirm that pinning a fourth is rejected. Change a video's audience and verify visibility from a different account.
7. Open the Followers and Following sheets, search for an account, and test follow, request, unfollow, and profile navigation.
8. Set an account's date of birth to under 18 in a test environment and confirm that public account privacy cannot be enabled.
