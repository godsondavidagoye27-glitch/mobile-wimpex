# Safe demo data

Use a dedicated development Supabase project. The seed and cleanup commands require `SEED_ALLOWED=true` and an exact project-ref confirmation; they never load the app's `.env` file.

Create an untracked `.env.seed` in the project root:

```dotenv
SEED_ALLOWED=true
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-development-service-role-key
DEMO_PASSWORD=your-strong-development-only-password
```

Do not commit or share this file. `.env.seed` is ignored by git. The service-role key bypasses row-level security and must only belong to a disposable development project. Both commands print the destination URL and require the exact project ref before changing data.

Apply database migrations (including the demo-post tagging migration) and deploy the function:

```powershell
npx supabase db push
npx supabase functions deploy demo-reply --no-verify-jwt
```

Set the function's webhook secret and leave demo replies disabled until testing:

```powershell
npx supabase secrets set DEMO_REPLY_WEBHOOK_SECRET=replace-with-a-random-secret DEMO_MODE=false
```

In the Supabase Dashboard, create a **Database Webhook** with:

- Table: `public.messages`
- Event: `INSERT`
- Type: `Supabase Edge Functions`
- Function: `demo-reply`
- HTTP header: `x-webhook-secret: <the same random secret>`

The function also checks `DEMO_MODE=true`, ignores messages from demo profiles, skips read-only conversations and non-text messages, and uses the source message ID as an idempotency key. Enable demo replies only on a development project:

```powershell
npx supabase secrets set DEMO_MODE=true
```

Seed the nine clearly labeled demo profiles, their welcome chats, and, when a video is needed, MP4 files placed in `scripts/seed/assets`. The script logs and skips video creation if that folder is absent or empty. To also create seeded conversations with your account, pass the email address associated with its existing Wimpex profile:

```powershell
npm run seed -- --me you@example.test
```

Without `--me`, the script creates demo profiles and their welcome chats only. Demo chat messages have stable IDs/client IDs, so rerunning the command does not duplicate them.

Remove seed-tagged chat rows, demo-owned storage assets, and all profiles/auth users marked as demo:

```powershell
npm run seed:clean
```

Cleanup deletes tagged messages, reactions, memberships, and posts, plus demo profiles/auth users and their owned assets. It stops before deleting anything if a demo profile owns an untagged post, protecting data that was not created by the seed script. It keeps a seeded conversation if a non-demo message or an additional non-demo participant was added after seeding. Otherwise it removes that demo conversation. It also removes the read-only welcome thread generated for a demo profile, but leaves unrelated conversations untouched. Associated follow rows cascade when the demo profiles are removed.

The test fixture includes adult profiles, a profile under 18 for policy testing, a profile that accepts no DMs, public profiles, and an account left without a follow relationship. Demo accounts use `@example.test` addresses and must not be used as real accounts.
