# Story highlights

Story highlights let an author retain selected active stories on their profile after the original story expires. Adding a story copies its media into the private `highlights` storage bucket; story expiry cleanup can then remove the source file without removing the highlight copy. Removing a highlight or deleting the account removes its copied media.

Each highlight has an audience, and each saved item also keeps the source story's audience. Viewers must satisfy both audience rules. In particular, a close-friends story remains close-friends-only even if it is placed in a highlight with a wider audience. Private-profile and block checks apply to the highlight and its media. The server enforces access through RLS-backed storage policies and security-definer RPCs; clients do not receive direct table grants.

Authors can create up to 20 highlights, save up to 100 stories in each, rename, reorder, remove, and review highlights from the profile. Add active stories from the story viewer before they expire. Media is copied rather than referenced so expiry does not invalidate saved highlights.

Apply `20261028000000_story_highlights.sql` after `20261027000000_scheduled_posts.sql`. If the migration was already applied, also apply `20261101000000_fix_story_highlight_media_policy.sql`; it keeps `story_highlight_items` inaccessible directly while allowing the storage policy to securely check media visibility. Redeploy `delete-own-account` so its storage cleanup includes the `highlights` bucket. No new edge function is required.

Before release, disclose that user-selected photos/videos can be retained in Wimpex storage beyond their original story expiry until the author removes the highlight or deletes the account. Include user-generated photos/videos, retention, profile visibility controls, and deletion behavior in the privacy policy and Play Store Data Safety form.

## Manual checks

- [ ] Add an active image and video story to a highlight, let the source stories expire, and confirm both copied items remain playable on the profile.
- [ ] Verify a close-friends source story stays unavailable to non-close-friends even when its highlight audience is everyone.
- [ ] Verify a follower-only highlight, private profile, and both directions of blocking hide the highlight and signed media URLs.
- [ ] Create 20 highlights and add 100 stories to one; confirm additional creations/additions are rejected by the server.
- [ ] Rename, reorder, and delete highlights; verify deletion removes the copied media.
- [ ] Delete the account and confirm all objects under the user's `highlights` storage path are removed.
