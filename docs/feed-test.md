# Feed test checklist

Use two signed-in accounts and a development build on devices that can reach the configured Supabase project.

## Create and upload

- Pick an MP4 video under 60 seconds and under 50 MB, preview it, add a caption, and post it.
- Try to choose a video longer than 60 seconds and verify the app rejects it.
- Try to choose a video larger than 50 MB and verify the app rejects it.
- Turn off the network during an upload, confirm the failed upload remains visible, restore the network, and retry.
- Close the app during an upload, reopen it, and confirm the queued upload resumes from its saved TUS offset.
- Confirm a successful upload appears in the feed and opens its post detail.
- Confirm a failed upload can be removed and its pending post and local media are cleaned up.
- Edit a caption and audience, leave the composer, reopen it, and confirm the draft is restored.

## Feed and interactions

- Confirm only the currently visible video plays while scrolling, and off-screen videos pause.
- Confirm a post whose signed video URL fails shows a placeholder while other feed items remain visible.
- Like and unlike a post from both the feed and detail screen, then confirm counts update.
- Save and unsave a post, then confirm counts update.
- Share a post and confirm its share count updates after the share sheet succeeds.
- Scroll to the end of each feed and confirm another keyset page loads without duplicates.
- Pull to refresh each feed and confirm the newest posts appear.
- Set an account to private and verify its posts stay hidden until a follow is accepted.
- Block an account and verify neither account can see the other's posts.

## Post details and comments

- Open a post from the feed, confirm its private video URL plays, and confirm the author profile opens.
- Add a comment and a reply, then confirm both appear in chronological order on both signed-in clients.
- Delete your own comment and confirm the deleted-comment state is shown.
- Try to comment on a post with comments disabled and confirm the composer is not available.
- Load more comments and confirm no duplicate comments appear.
- Leave the detail screen and confirm its comments realtime subscription is removed.

## Database and network

- Enable airplane mode and confirm cached feed items remain visible and feed errors offer a retry.
- Run `supabase test db` with Docker available and confirm all `supabase/tests` pgTAP tests pass.
