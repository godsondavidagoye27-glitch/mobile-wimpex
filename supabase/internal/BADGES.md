# Internal badge operations

Badge records are managed by database triggers, owner-only SQL tools, and the server-side evaluator. Never expose the rules, evaluation details, or this guide in the app.

## Grant and revoke

```sql
select public.admin_grant_badge('username', 'verified');
select public.admin_revoke_badge('username', 'verified', 'owner decision');
```

Grant a badge with an expiry:

```sql
select public.admin_grant_badge(
  'username',
  'verified',
  'temporary grant',
  now() + interval '30 days'
);
```

The grant function makes an automatic grant manual. Manual grants are not changed by automatic evaluation. A manual revoke suppresses automatic grants until the suppression is cleared:

```sql
select public.admin_clear_badge_suppression('username', 'verified');
```

## Inspect badges and evaluations

```sql
select * from public.admin_list_badges('username');
select * from public.admin_verification_report('username');
```

The report contains internal values and must only be run by a trusted database owner. The dashboard SQL editor runs as `postgres`; these functions are not callable by app clients.

## Tune rules

Rule values are JSON scalars, so numeric values are written as JSON numbers and boolean values as JSON booleans:

```sql
update public.verification_rules
set value = '900'::jsonb, updated_at = now()
where rule_key = 'min_qualified_followers';

update public.verification_rules
set value = 'true'::jsonb, enabled = true, updated_at = now()
where rule_key = 'require_email_confirmed';
```

Disable a rule without deleting its configured value:

```sql
update public.verification_rules
set enabled = false, updated_at = now()
where rule_key = 'min_active_days_last_30';
```

## Run evaluation

Run a bounded batch from the SQL editor:

```sql
select * from public.run_verification_evaluation(500);
```

The result contains only aggregate counts. To schedule it daily or every few hours, first enable `pg_cron` in the project, then schedule it from the SQL editor; this migration intentionally does not create a project-specific job:

```sql
select cron.schedule(
  'verification-evaluation',
  '0 */6 * * *',
  'select public.run_verification_evaluation(500);'
);
```

`reports.moderation_status = 'actioned'` is the schema's upheld-report signal. Set it only after a moderator action using a trusted backend or database-owner session; app clients can submit reports but cannot set this status. Reciprocal/low-quality engagement filtering uses accepted-follow count; the internal `min_following_for_qualified_engagement` value can be tuned like other rules.

## Default values

The migration seeds conservative defaults: account age 45 days, 12 published posts, 750 qualified followers, 2,500 qualifying likes, 8 active days in 30 days, complete profile required, confirmed email or phone required, no more than 0 actioned reports in 90 days, 0 active community/live bans, qualified follower account age 14 days, follower avatar required, and at least 5 accepted follows for a follower/liker to count.

These defaults are visible to anyone with repository access because they are migration seed data. Change them in `verification_rules` after deployment if the repository is shared.
