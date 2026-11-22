# SEOForge

SEO research workspace by Syeds Enterprises. Static HTML/CSS/JavaScript frontend, Supabase Auth/Postgres, and Supabase Edge Functions. No frontend build step.

## Development

Use Node 22 or later. Run npm run check and npm test, then serve the directory with python -m http.server 8000. Open http://localhost:8000. Guest mode works without Supabase. No Node dependencies or lockfile are required.

## Included tools

- Site audits and PageSpeed (mobile/desktop), bulk audits, health checklist.
- Google Suggest keyword research, DuckDuckGo rank observations and difficulty estimates.
- Link verification, broken-link checks, redirect inspection, schema detection, robots and sitemap utilities.
- SERP/social previews, content briefs and competitor comparisons.
- Manual revenue logging and estimates; personal listings and order records.
- Search Console and GA4 reports through authenticated Google OAuth.
- CSV exports and JSON export of the currently loaded workspace.
- Workspace name, system/light/dark themes, accent color, compact density, default website and audit device.
- Email/password authentication and password recovery.

Marketplace records are not a public marketplace or order fulfillment system. Ad-network API credentials do not enable automatic revenue synchronization. Public fetch proxies and DuckDuckGo can be unavailable or block requests.

## Security changes

- A PayPal return URL never grants a paid plan. Client plan updates are denied in Postgres.
- Subscriptions are bound to authenticated user IDs, not matched by editable email.
- Google callbacks require random, expiring, one-time state bound to the signed-in account and a PKCE verifier.
- Server functions validate authentication; Google tokens remain service-only.
- Account preferences are namespaced by user. Guest records are not automatically uploaded.
- Account load failures are surfaced. Failed cloud writes do not silently become guest records.
- Empty/blocked search responses do not create false lost-rank observations.
- CSV exports neutralize formulas; website inputs reject executable schemes and credentials.
- Database quotas serialize per user and retain usage after audit history is deleted.
- Parent ownership is checked for rank checks and orders.

Quotas apply to stored observations, not public client-side requests. Link observations group anchors by timestamp; comparisons store two rows. Cached UI usage may lag the database ledger after deletions; server errors remain authoritative.

## Layout

- index.html — structure
- assets/app.js, core.js, styles.css — behavior, validation, themes
- supabase/functions — Google OAuth/reports, billing, webhook, summary sender
- database/bootstrap.sql — new-project baseline
- database/harden-existing.sql — original-v2 upgrade
- tests — regression tests and transactional database checks
- docs/OPERATIONS.md — configuration and release gates
- .github/workflows/ci.yml — JavaScript and Deno checks

Supabase JS is pinned to 2.119.2.

## Release status

Account/billing protection SQL was applied to the existing Supabase project and verified using rolled-back fixtures. Frontend changes are delivered in the pull request; merging and Pages deployment are separate steps.

Paid checkout defaults to disabled. Google client secret, PayPal credentials/webhook registration, and Resend sender/scheduling require operator configuration. Never put secrets in GitHub files.

This is a hardening and customization release, **not a claim that all production integrations are verified**. Read the operations guide before a paid launch.

## v2.8 release completion

Adds complete paginated account exports, authoritative usage counts, integration readiness, subscription refresh, per-account API rate limits, desktop/mobile browser smoke tests and six-hourly public endpoint monitoring. Apply database/release-usage.sql after the hardening upgrade on new installations. Both SQL upgrades are already applied to the hosted project. The status function reports configuration without disclosing secret values. Live paid activation still requires verified provider configuration.

Browser validation passes on desktop (1440px) and mobile (390px). Production endpoint smoke tests reject unauthenticated billing, Google and email requests and unsigned PayPal events. Integration configuration status is independently visible in Workspace settings.
