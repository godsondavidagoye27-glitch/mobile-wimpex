# Comment safety and upload moderation

## Current implementation

- Comment hidden-word phrases are case- and accent-insensitive and are evaluated by a database trigger. A person can store up to 100 phrases.
- A restricted account's comments on the post owner's posts are hidden from other viewers until the owner approves them.
- When a restricted account starts a direct conversation or sends a new message to the owner, the thread is hidden from the regular chat list and shown in Message requests. The owner must accept before replying.
- Hidden or moderation-pending comments do not increment public comment counts or create notifications.
- `moderate-content` uses OpenRouter's chat completions API to score comment/caption text and a video thumbnail when a `thumb_path` exists. High-confidence results hide the content; medium-confidence results enter the staff review queue. Content is never automatically deleted.
- Failed API attempts remain in `moderation_jobs` with exponential retry delays. Authenticated client calls process only the caller's jobs. A secret-authenticated worker call processes due jobs across users and first releases stale `processing` jobs.
- `post-preview` returns Open Graph HTML only for published, public posts from non-private adult accounts. Followers-only, private, hidden, and under-18 content returns 404.

## OpenRouter model routing and data disclosure

The moderation function uses the OpenRouter chat completions API with `openai/gpt-4o-mini` for text and image scoring. Automatic captions use OpenRouter's speech-to-text API with `openai/whisper-large-v3`, requesting segment timestamps for WebVTT. Both requests require zero-data-retention (`zdr`) provider routing. OpenRouter may route requests to an upstream model provider; actual availability, retention, and processing terms remain subject to OpenRouter and that provider.

The app sends comment text, post captions, and a thumbnail image (only if a thumbnail is present) to OpenRouter for automated review. If authors enable automatic captions, the post's video file is sent to OpenRouter and its routed transcription provider. New video upload jobs still do not generate or persist a moderation thumbnail, and no video-frame extraction is implemented; visual moderation of newly uploaded videos is therefore incomplete.

For the Play Store Data Safety form, disclose that user-generated text and available thumbnails are shared for automated safety review, and videos are shared for optional transcription, with OpenRouter and routed model providers. Disclose the purposes as content moderation/abuse prevention and caption generation. Update the privacy policy before enabling these production functions. No user-facing consent toggle has been added; confirm legal requirements for the launch regions.

## Database and deployment

Apply migrations in timestamp order. The new feature migrations are:

1. `20261020000000_comment_safety_controls.sql`
2. `20261021000000_content_moderation.sql`
3. `20261022000000_edit_published_posts.sql`
4. `20261023000000_chat_forward_pins_search.sql`
5. `20261024000000_restricted_message_requests.sql`
6. `20261025000000_teen_safety_controls.sql`

Deploy:

```powershell
npx supabase functions deploy moderate-content
npx supabase functions deploy post-preview
npx supabase functions deploy captions-start
npx supabase functions deploy captions-callback
npx supabase functions deploy captions-retry
```

Set `OPENROUTER_API_KEY` as a Supabase Edge Function secret. Never place it in the app environment. `moderate-content` validates caller JWTs itself; its gateway JWT check is disabled so a worker can authenticate with a separate `MODERATION_WORKER_SECRET`. `post-preview` is public and uses only the public-post allowlist.
Set the Edge Function secret `PUBLIC_WEB_BASE_URL` to the same HTTPS domain configured in the app; the placeholder is only for development.

For unattended retries, set a random `MODERATION_WORKER_SECRET` Edge Function secret and schedule an HTTP POST to `$SUPABASE_URL/functions/v1/moderate-content` with the `x-moderation-worker-secret` header. The scheduled worker calls `public.retry_stale_moderation_jobs()` and processes up to five due queue entries per invocation. Supabase Cron/`pg_net` availability varies by project; use an external scheduler if those extensions are not enabled. Do not place the secret in the app or commit it.

## Manual checks still required

- Verify hidden-word matching in PostgreSQL with `unaccent` installed and confirm the existing comments migration backfills old comments as clear.
- Verify the database trigger creates one moderation job per post/comment and that transient API failures remain retryable.
- Verify the staff reviewer account is explicitly marked `is_official`; that existing flag is currently the review authorization.
- Test public preview responses for public posts, private profiles, followers-only posts, moderated posts, and minors.
- New feed uploads still have `thumb_path: null`; video-frame extraction, story images/videos, and community media are not yet connected to visual moderation. Do not claim full visual-upload moderation until a compatible frame/image pipeline is verified and implemented.
