# Communities test guide

Apply all migrations and run the database security tests with a local Supabase stack:

```sh
npx supabase db reset
npx supabase test db
```

`communities_core_security.sql` covers community creation limits, membership and ownership rules, private community visibility, adults-only access, counters, and direct-write restrictions. The app unit tests cover community role permissions.

## Manual app checks

1. Open Groups and verify My communities, Suggested, and Discover load. Search and filter by category, paginate results, and retry after an offline error.
2. Create a public community with rules and an icon. Verify the creator is its owner, its active member count starts at one, and the community appears under My communities and Discover.
3. Join a public community as another account. Verify membership is immediate, the count updates, and the owner receives a community notification.
4. Create a private community. Verify other accounts can discover its name/category but not its description, posts, or members; request to join and confirm a manager can approve or decline it.
5. As a manager, invite an eligible person. Verify the invite notification opens the community and the invited account can accept or decline.
6. Promote a member to moderator. Verify moderators can manage membership and rules but cannot transfer ownership, delete the community, or ban the owner or another moderator.
7. Transfer ownership, leave a community, ban and unban a member, and delete a community as its owner. Confirm counts and membership lists update correctly.
8. Check an adults-only community with adult and minor accounts. A minor must not discover it, open it by deep link, join it, create one, or receive an invitation.
9. Mark community notifications read, refresh Groups and the community page, and confirm unread badges and membership state remain correct.
10. Test empty results, blocked users, repeated join/invite actions, and offline errors with Retry.

Posts and community chat are covered in Phase 8D.
