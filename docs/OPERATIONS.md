# Operations and release gates

## Database

For a new project, run database/bootstrap.sql, then database/harden-existing.sql once. Existing v2 projects need only the upgrade. Project mzbesucdnjecinkdawzy already has migration seoforge_protect_billing_and_account_data applied; do not rerun it.

These are reviewable SQL upgrade/bootstrap scripts, not fabricated CLI migration versions. Generate future migration files with the installed CLI and preserve dashboard migration history.

Run tests/database-security.sql in staging after the upgrade. Temporary fixtures are rolled back. Tests cover isolation, blocked plan updates, allowed preferences, audit quotas and deletion-resistant accounting.

Back up before future migrations. Never restore client plan-update permissions to make old checkout code work.

## Functions and configuration

Deploy google-oauth, billing, paypal-webhook and send-alert from supabase/functions. Gateway legacy-JWT verification is disabled because each function validates a user JWT, PayPal signature or cron secret itself. Do not remove those checks.

Public defaults:
- APP_ORIGINS: https://syedsenterprises.github.io (comma-separated additional staging origins)
- GOOGLE_CLIENT_ID: existing public client ID
- GOOGLE_REDIRECT_URI: https://syedsenterprises.github.io/seoforge/
- BILLING_ENABLED: false

Supabase provides SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Keep the service role out of frontend files.

Configure securely in the Supabase dashboard:
- GOOGLE_CLIENT_SECRET
- PAYPAL_MODE: sandbox first, then live
- PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_PLAN_ID, PAYPAL_WEBHOOK_ID
- RESEND_API_KEY, RESEND_FROM (verified sender), CRON_SECRET (32+ random characters)

Check Google redirect URIs and Supabase Auth redirect allowlists. Enable Search Console, Analytics Data and Analytics Admin APIs. Testing-mode Google apps only admit configured test users.

## Billing lifecycle

Authenticated checkout creates a PayPal subscription with custom_id set to the user ID and stores the binding before returning an approval URL. A stable PayPal request ID prevents concurrent duplicate creates within PayPal's idempotency window.

The webhook verifies the signature, fetches current subscription state, validates plan/account, and applies events transactionally. Duplicate IDs and older provider timestamps do not overwrite entitlement. Only ACTIVE grants Pro.

Register BILLING.SUBSCRIPTION.ACTIVATED, UPDATED, CANCELLED, EXPIRED and SUSPENDED at /functions/v1/paypal-webhook. An early notification may precede the binding and require provider retry.

Old plain-link subscriptions lack an account binding: reconcile them against PayPal records manually. Never infer ownership from a return URL or email alone.

Before BILLING_ENABLED=true, test sandbox approval, activation, cancellation, suspension, duplicate/reordered events, network interruption, and renewal after cancellation. Verify forged return URLs never grant Pro.

Self-service cancellation UI and scheduled payment reconciliation remain follow-up work. Subscribers can manage subscriptions in PayPal.

## Weekly summaries

send-alert accepts scheduler POST requests with x-cron-secret only. It ignores arbitrary recipients/HTML and reads opted-in profiles and saved observations. It does not run live rank checks. No schedule is installed automatically.

Limits: 500 users, 100 keywords/user, 1,000 recent checks/user. Resend idempotency keys use account/week but provider retention is finite. Add a durable delivery ledger, pagination and a queue before scaling or retrying beyond that window. Verify delivery and opt-out before enabling a schedule.

## Verification

Automated:
- npm run check
- npm test
- deno check --config supabase/functions/deno.json supabase/functions/*/index.ts
- transactional database-security.sql
- inspect GitHub CI before merging

Manual staging gates:
- responsive layout, keyboard navigation and theme contrast
- signup/email confirmation, sign-in/out, refresh, cross-tab sign-out and password reset
- OAuth/PKCE, Search Console/GA4 authorization and disconnect
- network failures, denied saves and shared-browser account isolation
- public API/proxy failures and blocked search responses
- PayPal lifecycle and Resend delivery

## Remaining limits

Public CORS proxies expose requested URLs and can fail independently of the target. Replace them with a controlled crawler, SSRF defenses, queues and rate limits before promising crawling SLAs.

Cloud lists have row caps; JSON export covers loaded data only. Add cursor pagination and asynchronous complete-account export before promising full backups.

V2 guest records remain local. Automatic migration was removed to avoid cross-account copying on shared devices; an explicit reviewed import workflow remains to be built.

Most application logic remains in app.js. Further split tool controllers as features grow. Full browser E2E and load tests have not been completed in this environment.

Enable leaked-password protection if available on the Supabase plan. Add monitoring, restore tests, privacy/terms policies and operational ownership before paid launch.

## v2.8 updates

- Apply database/release-usage.sql after harden-existing.sql on new projects. The hosted project already has seoforge_release_usage_and_rate_limits applied.
- Deploy status alongside the four existing functions. Pass a relative deno.json import-map path when updating functions to avoid stale deployment paths.
- Browser CI runs Chromium at 1440px and 390px on pinned Ubuntu 24.04. It exercises every tool tab, theme persistence, rank/revenue entries, exports and forged billing returns using isolated browser contexts and blocked external calls.
- Cloud export now reads all pages (up to 100,000 rows per table) and fails without downloading partial results. This supersedes the earlier loaded-only export limitation. Avoid editing records during the export; it is not a transactional database snapshot.
- The production smoke workflow checks public availability and unauthenticated endpoint rejection every six hours. GitHub Actions notifications provide failure reporting; configure repository notification recipients for operational ownership.
- Refresh subscription reconciles the account's current provider state after a delayed webhook. API calls are limited per account/minute.
- Email preference failures explicitly retain the prior preference instead of pretending a local save changed delivery.
