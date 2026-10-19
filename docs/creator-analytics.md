# Creator analytics

The creator dashboard requests analytics only for the authenticated account. The RPC does not accept an owner ID, and it returns aggregate counts and per-post metrics without viewer identities.

The feed samples playback progress every five seconds while a video is actively playing, buffers samples, and sends them to `record_post_watch_batch` in batches. The RPC verifies that the caller can view each published, non-hidden post, limits batch sizes and per-account sample rates, and writes to an RLS-enabled table with no direct client table grants.

The dashboard supports rolling 7-, 28-, and 90-day periods and reports views, unique viewers, watch time, average watch percentage, followers gained, likes, visible comments, shares, daily views, and up to five top posts. The migration provides a service-role-only `purge_post_watch_samples()` function that removes events older than 180 days; configure a secured external scheduler to call it if `pg_cron` is unavailable.

Before release, disclose account-linked watch/interaction analytics collection in the privacy policy and Play Store Data Safety form. The daily screen-time reminder remains on-device and is separate from video watch analytics. Apply `20261026000000_creator_analytics.sql` after earlier migrations. No remote migration is applied by this project change.

Validate aggregation, RLS, rate limits, and the creator-only RPC against a local Supabase database before deployment.
