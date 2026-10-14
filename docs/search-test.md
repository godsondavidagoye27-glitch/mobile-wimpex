# Search test guide

Apply the search migration and run its database tests with a local Supabase stack:

```sh
npx supabase db reset
npx supabase test db
```

The `search_security.sql` pgTAP test covers profile and video visibility, blocks, demo-account filtering, exact hashtag counts, seven-day trends, suggested people, keyset pagination, input/page limits, authentication, and the 60-request rate limit.

## Manual app checks

1. Open Search from the Home header. Confirm the input says “Search people, videos, communities” and the default view shows recent searches, trending hashtags, and suggested people.
2. Run a search shorter than two characters, then enter at least two. Confirm results do not appear before the 300 ms debounce and stale query results are replaced.
3. Switch among People, Videos, Hashtags, and Communities. Follow a person, open a profile, open a video, and open a hashtag or community result.
4. Load another page of results and verify no duplicate rows and correct continuation order.
5. Save a recent search, remove it, clear all recents, and relaunch Search to verify local persistence.
6. Open a hashtag from the Home caption, post detail, composer chips, trending list, and search results. Confirm the deep-linked hashtag route shows its exact count and a three-column video grid.
7. Refresh Search and a hashtag page, and test empty results and offline errors with Retry.
