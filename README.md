# SEOForge

Free SEO toolkit by Syeds Enterprises — a public SaaS, live at https://seoforge.syedsenterprises.org/. Static HTML/CSS/JavaScript frontend, Supabase Auth/Postgres, and Supabase Edge Functions. No frontend build step.

Free tools on real public data, no invented numbers: site audits and PageSpeed, keyword ideas, rank observations, link checks, content briefs, competitor comparisons, revenue logging and a link marketplace. No backlink index and no keyword-volume database — the site says so plainly instead of faking them.

## Pricing

- Free $0 — 5 audits/mo, 10 keywords, 5 link checks/mo, 3 briefs/mo, 3 compares/mo, 10 tool checks/mo, 5 AI messages/day, 1 site.
- Pro $9/mo or $90/yr — unlimited, 3 sites.
- Agency $29/mo or $290/yr — Pro plus 10 sites, featured marketplace listing, priority support.
- Business, custom — talk to sales (mailto:contact@syedsenterprises.org); assigned manually, no checkout button.

Billing is live via PayPal. Guest mode works without an account; most tools need no account at all.

## Sponsor

SEOForge is built and maintained by Syed Shahed (Syeds Enterprises). If it saves you time, you can sponsor the work: https://github.com/sponsors/syedsenterprises

## Development

Use Node 22 or later. Run npm run check and npm test, then serve the directory with python -m http.server 8000. Open http://localhost:8000. Guest mode works without Supabase. No Node dependencies or lockfile are required.

## Included tools

- Site audits and PageSpeed (mobile/desktop), bulk audits, health checklist.
- Speed Score — our own 0–100 score from measurements we take ourselves (TTFB, page weight, render-blocking, compression, images, request count). It cannot measure true LCP/CLS; Google's PageSpeed result is shown alongside it.
- Google Suggest keyword research, Bing rank observations (DuckDuckGo fallback) and difficulty estimates.
- Link verification, broken-link checks, redirect inspection, schema detection, robots and sitemap utilities.
- SERP/social previews, content briefs and competitor comparisons.
- Manual revenue logging and estimates; personal listings and order records.
- Search Console and GA4 reports through authenticated Google OAuth.
- CSV exports and JSON export of the currently loaded workspace.
- Workspace name, light/dark/system themes (light by default), accent color, compact density, default website and audit device.
- Email/password authentication and password recovery.
- Forge Assistant — in-site AI agent. Bring your own key (CoArena, Google Gemini free tier, or any OpenAI-compatible provider) or use keyless local answers from your own saved data.
- Landing hero audit widget — a real Health Check + Speed Score with no signup, and shareable score links (#tab=health&url=…).
- Admin dashboard for the site owner: platform health, personal totals, PayPal plan, user counts.

Marketplace records are not a public marketplace or order fulfillment system. Ad-network API credentials do not enable automatic revenue synchronization. Public fetch proxies and Bing/DuckDuckGo search can be unavailable or block requests.

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

Quotas apply to stored observations, not public client-side requests. Link observations group anchors by server-generated IDs; comparisons store two rows. Cached UI usage may lag the database ledger after deletions; server errors remain authoritative.

## Layout

- index.html — landing page (no app code)
- app.html — app shell
- assets/app.js, core.js, styles.css — behavior, validation, themes
- supabase/functions — Google OAuth/reports, billing, webhook, summary sender, fetch-proxy, pagespeed, ai-agent, admin-stats, status
- database/bootstrap.sql — new-project baseline
- database/harden-existing.sql — original-v2 upgrade
- database/release-usage.sql — usage ledger (apply after the hardening upgrade on new installations)
- tests — regression tests and transactional database checks
- scripts — browser and production endpoint smoke tests
- docs/OPERATIONS.md — configuration and release gates
- .github/workflows/ci.yml — JavaScript and Deno checks

Supabase JS is pinned to 2.119.2.

## Release status

Current version: **2.11.0** (+ v2.11.x patch). Live at https://seoforge.syedsenterprises.org/ (GitHub Pages mirror still serves the same build). Deploys go straight to main; CI Verify must pass on the final commit. The account/billing protection SQL (harden-existing.sql, release-usage.sql) is applied to the hosted project and was verified using rolled-back fixtures.

Billing is live via PayPal (live plans, sandbox lifecycle tested end to end). Google OAuth and email (Resend SMTP) are live and verified. Provider credentials and secrets live in Supabase secrets only — never put secrets in GitHub files. Read the operations guide before changing provider configuration.

## v2.11.0

Rebuilt landing page (real buttons, interactive showcase, honest stats, four pricing tiers, Hire Syed section), Forge Assistant with keyless local answers, Speed Score, shareable audit links, owner admin dashboard, and theme adaptivity — one accent colour drives the whole site, light by default. The v2.11.x patch fixed genuine-report defects (no measured data shown as real data, no failed fetch shown as a page title, no invented sitemap dates) and the admin user-counts query.

Browser validation passes on desktop (1440px) and mobile (390px). Production endpoint smoke tests reject unauthenticated billing, Google and email requests and unsigned PayPal events. Integration configuration status is independently visible in Workspace settings.
