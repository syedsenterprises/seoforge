# SEOForge v2 — multi-user SaaS

One single-file web app that merges SEO, ads and link-marketplace workflows into one
SaaS — by Syeds Enterprises, for $0 running cost.

**Live:** https://syedsenterprises.github.io/seoforge/
**Repo:** https://github.com/syedsenterprises/seoforge

## What's new in v2 (21 Nov 2026)

- **Accounts:** email + password sign-up/sign-in via Supabase Auth (email
  confirmation on). Session persists. A `profiles` row (plan `free`) is created
  on first sign-in.
- **Per-user cloud data:** when signed in, all 7 modules read/write Supabase
  tables (audits, keywords, rank_checks, verified_links, revenue_entries,
  listings, orders) with row-level security — each user sees only their own rows.
  When logged out, the app works exactly like v1 (localStorage).
- **One-time migration:** on first sign-in, any localStorage data is copied into
  the user's Supabase rows (duplicates skipped silently). Flagged per user in
  localStorage (`syedSuite.migrated.<user-id>`). Migrated link records keep
  page/domain/date but not per-link counts.
- **Free-plan limits (cloud counts only):** 5 site audits / calendar month,
  10 tracked keywords total, 5 link verifications / calendar month. Pro is
  unlimited. Limits are shown in the Dashboard plan card and under each module;
  hitting one shows the remaining count and an upgrade prompt — never a silent fail.
- **Landing page:** logged-out visitors see a hero, the 7 modules as features, and
  pricing (Free $0 vs Pro $9/month). "Launch app" opens the dashboard without
  signing up (local mode). Signed-in users go straight to the dashboard.
- **PayPal Pro checkout — LIVE:** Pro is $9.00 USD/month, plan "SEOForge Pro",
  plan ID `P-4RE674325T1902737NMA2SCY`, status ON. The upgrade button sends the
  buyer to `https://www.paypal.com/webapps/billing/plans/subscribe?plan_id=P-4RE674325T1902737NMA2SCY`.
  On return, PayPal appends `?subscription_id=...`; the app stores it in
  localStorage and sets the user's `profiles.plan` to `pro`.
- **Honest upgrade path:** Pro activation currently relies on the PayPal return
  URL. Server-side webhook verification of the subscription is the next step
  after launch — until then, a subscription is trusted from the return URL only.
  Do not treat this as payment proof for disputes.

## Setup notes (already done, keep for reference)

- Supabase project: `https://mzbesucdnjecinkdawzy.supabase.co` (free tier).
  The app uses the **publishable key** (`sb_publishable_...`), not the legacy anon
  key — legacy keys retire early 2027.
- Supabase Auth → Site URL should be `https://syedsenterprises.github.io/seoforge/`
  so email-confirmation links return to the app.
- PayPal plan "SEOForge Pro" return URL is
  `https://syedsenterprises.github.io/seoforge/` (required for `subscription_id`
  to come back to the app).
- If the Supabase JS CDN fails to load, the app still works in local mode and
  shows a notice in the header.

## Files

- `index.html` — the whole app. Vanilla JS + inline CSS only, no frameworks, no build step.
- `README.md` — this file.

## How to open it

- Double-click `index.html`, or serve it: `python3 -m http.server 8000` in this folder,
  then open `http://localhost:8000/` in a browser.
- All data is stored in the browser's localStorage. Nothing is uploaded anywhere.
  **Signed in:** data is stored in your Supabase account instead (see v2 notes above).
  Logged-out use is still localStorage only.
- Mobile-friendly and light — designed to be usable on a 4G phone.

## Modules

1. **Dashboard** — totals computed from localStorage (audits run, keywords tracked, links
   verified, ad revenue logged, orders). Quick actions to each module.
2. **Site Audit** — fetches `sitemap.xml` (up to 50 URLs) and status-checks each URL,
   then runs Google PageSpeed Insights (mobile/desktop) and shows performance score,
   LCP, CLS and the SEO audit items PageSpeed returns.
3. **Keyword Explorer** — live suggestions from Google Suggest for a seed keyword, plus
   question/buyer expansions and a–z. Save any suggestion to the Rank Tracker.
4. **Rank Tracker** — checks a keyword's position in **DuckDuckGo** results for your
   target URL and stores a dated history. Labelled clearly: DuckDuckGo, not Google.
5. **Link Verifier** — fetches a linking page live and reports every link to your
   domain with its real `rel` attribute: dofollow / nofollow / sponsored / ugc.
6. **Ad Revenue Hub** — manual daily revenue logging (Adsterra / Monetag / AdSense /
   Other), totals per network, hand-rolled bar chart. Settings section holds optional
   API keys (stored in localStorage only, never sent anywhere except to their own
   service). Live sync is v3.
7. **Marketplace** — seeded ONLY with real inventory: LookForIt sponsored listing
   $20 one-time, LookForIt manual review $49, Estate Path guest post (DM for rates —
   no fixed price exists, none invented). Add listings and record orders locally.

## Live data sources (all free, no key required for v1)

| Feature | Source | Notes |
|---|---|---|
| Sitemap + page fetch | `api.allorigins.win` (fallback: `api.codetabs.com`) | Free public CORS proxies — unreliable at times; the app shows proxy errors honestly instead of blaming the site. |
| PageSpeed | `pagespeedonline.googleapis.com` (no key) | Google's free no-key quota is shared and often exhausted. |
| Keyword suggestions | `suggestqueries.google.com` | Real Google suggestions. No search volume — none is invented. |
| Rank checks | `html.duckduckgo.com` via proxy | DuckDuckGo results, not Google. |
| Revenue / listings / orders | Supabase tables when signed in, localStorage when logged out | Manual in v2; live network sync is v3. |

## Endpoint verification (21 Nov 2026, from this VM)

Verified working:

- **Google Suggest** — `curl "https://suggestqueries.google.com/complete/search?client=firefox&q=ai%20tools"`
  returned HTTP 200 with real suggestions (`ai tools free`, `ai tools like chatgpt`, …).
- **LookForIt sitemap (direct)** — `curl -L https://lookforit.xyz/sitemap.xml` returned
  HTTP 200, 25,381 bytes, 200 `<url>` entries. The site is healthy.
- **allorigins proxy** — `https://api.allorigins.win/raw?url=https://example.com` returned
  HTTP 200. The proxy itself is up.

Verified FAILING (the app handles these honestly instead of faking data):

- **PageSpeed Insights, no key** — HTTP 429 twice, for two different URLs:
  `Quota exceeded for quota metric 'Queries' … quota_limit_value: 0` for the shared
  anonymous project. The no-key quota is exhausted. In the app a 429 shows that exact
  message and suggests adding a free API key (Google Cloud Console) in Settings, or
  retrying later. A key is optional — v1 works without one, just with this limit.
- **allorigins fetching lookforit.xyz** — HTTP 500 / 408 / 522 across repeated tries,
  while the same proxy fetched example.com fine and the sitemap loads directly.
  The proxy is flaky for this origin right now. The app tries allorigins, then
  codetabs, then reports a proxy error honestly ("the target site may still be fine").
- **codetabs proxy** — HTTP 522 for example.com (down at check time). Kept only as a
  second fallback.
- **corsproxy.io** — now requires an API key (HTTP 401). Not used.

## Known limits / what needs his browser test

- **Not yet tested live:** sign-up (including the confirmation email), sign-in,
  sign-out, the PayPal upgrade button click, the `subscription_id` return flow,
  and the free-plan limit prompts. These need a real browser test with a real
  account — do the signup first, confirm the email, sign in, run one audit, one
  keyword save, one link check, then click Upgrade and check the plan flips to Pro.
- PageSpeed and proxy calls were verified from this VM, not from his phone/browser.
  On his own connection the no-key PageSpeed quota may behave differently (shared
  quota), and proxies may work better or worse. He should run one audit, one keyword
  search, one rank check and one link verification in the app and tell me what failed.
- The DuckDuckGo HTML endpoint returned HTTP 202 with 15 KB directly from curl; the
  app parses `a.result__a` links from it via the proxy. If DDG changes its HTML,
  positions will report "not in top results" — that is a parse failure, not a ranking.
- PageSpeed calls can take up to ~60–120 s; the app shows a progress message and has
  a 120 s timeout.
- Keyword Explorer fires up to 33 Suggest queries (seed + 6 prefixes + a–z) in batches
  of 4; on a slow connection it takes a while and shows live progress.
- There is **no free Ahrefs/Semrush backlink index**. The app says so on the
  Dashboard instead of faking one. Backlink checking is done link-by-link with the
  Link Verifier.

## Honesty rules baked in

- No fake search volumes, DA/DR, backlink counts, revenue, listings or buyers.
- Every "live" feature calls a real endpoint; failures are shown as failures.
- Guest-post price is "DM for rates" — no fixed price exists on record and none was invented.
- Paid links are reported by their real `rel` attribute, never assumed dofollow.

## What's new in v2.6 — integrations (21 Nov 2026)

- **Google Search Console + Analytics (read-only OAuth):** a "Connect Google"
  button (Settings → Integrations, and the Search Console tab) starts the
  Google OAuth flow. Scopes are read-only only:
  `webmasters.readonly` + `analytics.readonly`. After Google redirects back
  with `?code=...`, the code is exchanged by the `google-oauth` edge function
  (below). The Search Console tab then shows, for a verified site and date
  range you pick, real clicks / impressions / CTR / average position per page
  and per query, plus a GA4 panel (sessions + users, last 28 days, property
  you pick). All Google calls go through the edge function — no Google token
  or secret is ever in the browser. The app runs in Google **test mode (up to
  100 users)** until OAuth verification — it says so in the UI.
  **Status 21 Nov 2026: the OAuth client is LIVE** — client ID
  `158848063786-cmdknljpjj6po7j2uc4r26dp31qm4nek.apps.googleusercontent.com`
  is wired into `index.html`. The flow still cannot complete until the client
  secret is set as a Supabase secret and the edge function is deployed (see
  Setup 2) — until then the code exchange fails and the button reports it
  honestly.
- **PayPal webhook verification:** `functions/paypal-webhook/` verifies every
  PayPal event by signature and flips `profiles.plan` to `pro` on
  `BILLING.SUBSCRIPTION.ACTIVATED` and back to `free` on
  `CANCELLED` / `EXPIRED` / `SUSPENDED`. Matching is by the subscriber's
  PayPal email against `profiles.email` (the plain subscribe link cannot carry
  a user id — see the file's header comment). The return-URL upgrade in the app
  stays as the fallback.
- **Email alerts (Resend):** `functions/send-alert/` sends one mail per call.
  Settings → Integrations has a "weekly rank summary" opt-in. The preference
  is stored in `profiles.weekly_summary` when that column exists, otherwise in
  this browser's localStorage. **Weekly mails need a scheduled trigger** — see
  below; until it is set up, turning the setting on saves the preference but
  sends nothing.
- **Share / export (client-side, no keys):** audit results get a share bar —
  Web Share API, Post on X, Post on LinkedIn, Copy summary — plus an "Open in
  LookForIt" link when the audited site is lookforit.xyz. The landing page has
  a "Connects to your accounts" section listing only what is actually built.

### Placeholders — where each real value goes

| Placeholder | Real value | Where it goes |
|---|---|---|
| `GOOGLE_CLIENT_ID` | **LIVE 21 Nov 2026:** `158848063786-cmdknljpjj6po7j2uc4r26dp31qm4nek.apps.googleusercontent.com` (project "SEOForge", `seoforge-515414`) | `index.html` (top of the script) — already wired in |
| `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth client secret — **not reported, stays in Google Cloud** | Supabase secret for the `google-oauth` function (never in the app) — **still to be set** |
| `RESEND_API_KEY` | Resend API key | Supabase secret for the `send-alert` function |
| `RESEND_FROM` (optional) | Verified sender, e.g. `SEOForge <alerts@syedsenterprises.org>` | Supabase secret for `send-alert`; default is `onboarding@resend.dev` (only delivers to the Resend account owner's own email until a domain is verified) |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | PayPal developer app **live** credentials | Supabase secrets for the `paypal-webhook` function |
| `PAYPAL_WEBHOOK_ID` | Webhook id from the PayPal dashboard | Supabase secret for `paypal-webhook` |
| `CRON_SECRET` (optional) | Any random string | Supabase secret for `send-alert`; the scheduled job sends it as the `x-cron-secret` header |

### Setup 1 — Google Cloud OAuth client

**DONE 21 Nov 2026:** project "SEOForge" (`seoforge-515414`); Search Console
API + Analytics Data API enabled; consent screen External, Testing mode,
scopes `webmasters.readonly` + `analytics.readonly`; redirect URIs registered:
`https://syedsenterprises.github.io/seoforge/` and
`https://syedsenterprises.github.io/seoforge/index.html`; client ID
`158848063786-cmdknljpjj6po7j2uc4r26dp31qm4nek.apps.googleusercontent.com`
is wired into `index.html`. What is left: copy the client secret into the
Supabase secret (Setup 2) — the secret was not reported and stays in Google
Cloud. If the flow is ever re-created: enable the **Google Search Console
API**, the **Google Analytics Data API** and the **Google Analytics Admin
API**, create a Web application OAuth client, and register exactly the
redirect URI above.

### Setup 2 — Supabase edge functions + SQL

```bash
# from this folder (needs the Supabase CLI + a linked project)
supabase functions deploy google-oauth
supabase functions deploy paypal-webhook
supabase functions deploy send-alert
supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...
supabase secrets set PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... PAYPAL_WEBHOOK_ID=...
supabase secrets set RESEND_API_KEY=... RESEND_FROM="SEOForge <alerts@syedsenterprises.org>" CRON_SECRET=...
```

Run this SQL in the Supabase SQL Editor (google_tokens is required; the
`weekly_summary` column is optional — the app falls back to localStorage
without it):

```sql
create table if not exists google_tokens (
  user_id uuid references auth.users(id) on delete cascade,
  provider text not null,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  created_at timestamptz default now(),
  primary key (user_id, provider)
);
alter table google_tokens enable row level security;
-- tokens are only ever read/written by the edge function (service role);
-- no client policy is granted on purpose.
alter table profiles add column if not exists weekly_summary boolean default false;
```

### Setup 3 — PayPal webhook

PayPal Developer Dashboard → My Apps & Credentials → your app → Webhooks →
Add Webhook. URL (exactly):

`https://mzbesucdnjecinkdawzy.supabase.co/functions/v1/paypal-webhook`

Subscribe it to: `BILLING.SUBSCRIPTION.ACTIVATED`,
`BILLING.SUBSCRIPTION.CANCELLED`, `BILLING.SUBSCRIPTION.EXPIRED`,
`BILLING.SUBSCRIPTION.SUSPENDED`. Copy the webhook id into the
`PAYPAL_WEBHOOK_ID` secret. The function returns 200 only after a verified
event is handled; unverified events get 401.

### Setup 4 — weekly summary mails (scheduled trigger)

The `send-alert` function sends one mail per call; it does not schedule
itself. Shape of the job (run once a week from an external cron — GitHub
Actions schedule, cron-job.org, or similar):

1. Read opted-in users: `select id, email from profiles where weekly_summary = true`.
2. For each user, compose the summary from their `rank_checks` (latest position
   per keyword vs the previous check) as simple HTML.
3. Call the function once per user:
   `POST https://mzbesucdnjecinkdawzy.supabase.co/functions/v1/send-alert`
   with header `x-cron-secret: <CRON_SECRET>` and body
   `{"to": "<user email>", "subject": "Your SEOForge weekly rank summary",
   "html": "<p>…</p>"}`.
   (Supabase pg_cron + pg_net can do the same job from inside the database —
   `select net.http_post(...)` once per opted-in user — if those extensions are
   enabled on the project.)

Until this job exists, the weekly-summary setting saves the preference only
and sends nothing — the UI says so.

## Files (v2.6)

- `index.html` — the whole app (now 120,698 bytes).
- `functions/google-oauth/index.ts` — Google OAuth exchange, token refresh, Search Console + GA4 calls.
- `functions/paypal-webhook/index.ts` — PayPal webhook signature verification + plan flips.
- `functions/send-alert/index.ts` — Resend email sender (user + scheduled-job paths).
- `README.md` — this file.

## Verification (v2.6, 21 Nov 2026, from this VM)

- `deno check` (Deno 2.9.8, installed for this check) on all three edge
  functions: **PASS, no errors**.
- Extracted inline JS from `index.html` (78,630 bytes): `node --check` **PASS**.
- Served locally (`python3 -m http.server`): HTTP 200, 120,698 bytes.
- Served copy greps: PayPal plan URL exactly 1×, `REPLACE_WITH_PLAN_ID` 0×,
  Supabase URL present, `GOOGLE_OAUTH_CLIENT_ID` placeholder present (2× —
  the constant and its placeholder check), "Search Console" 19×,
  "Connect Google" 2×, "Notifications" 1×, "Share this audit" 1×.
- Secrets audit: all three functions read every secret from `Deno.env` only;
  no hardcoded keys, tokens or client secrets anywhere in `functions/` or the
  app (the Supabase publishable key in `index.html` is public by design).

## Not yet tested live (v2.6)

- Google OAuth end-to-end (connect → consent → code exchange → Search
  Console report → GA4 report → disconnect) — the client ID is wired in, but
  the flow cannot complete until `GOOGLE_CLIENT_SECRET` is set as a Supabase
  secret and the `google-oauth` function is deployed (Setup 2). The connect
  button reports the missing piece honestly instead of failing silently.
- PayPal webhook (needs the webhook registered + secrets set, then a real
  subscription event).
- Resend mail send (needs `RESEND_API_KEY`; the default sender only delivers
  to the Resend account owner's own email until a domain is verified).
- The weekly-summary scheduled job does not exist yet (see Setup 4).

## v2.5 feature batch (21 Nov 2026, merged into the v2.6 file)

Added 15 things to `index.html` on top of v2/v2.6, all in one file, no new
dependencies. Nothing v2/v2.6 had was removed or changed except the version
label in the meta description (kept at v2.6, since that work landed first).

New tabs: SERP Preview, Broken Links, Redirects, Schema, Robots & Sitemap,
Content Briefs, Competitors, Revenue Estimator, Health Check, Bulk Audit.
Plus: Keyword Difficulty (in Keyword Explorer + Rank Tracker), audit-history
chart + CSV exports (audits, rank history, verified links, revenue), and
dashboard upgrades (rank movement up/down vs previous check, revenue this
month vs last month).

New Supabase tables (code is defensive — every call try/catch, localStorage
fallback, page never breaks if a table is missing): `content_briefs`,
`competitors`, `site_checks`; `keywords` gains a `difficulty` column
(writes retry without it if the column does not exist yet).

Free limits (cloud counts, Pro unlimited): content briefs 3/month,
competitor compares 3/month, broken-link / redirect / schema / robots /
sitemap checks share 10/month. Health check and bulk audit count against the
existing 5 audits/month (they run PageSpeed). Every limit shows remaining
counts and an upgrade prompt — never a silent fail.

Honesty rules kept: Keyword Difficulty is an estimate from the live
DuckDuckGo top 10 (formula shown on screen), the Revenue Estimator uses
published AdSense RPM ranges by niche (shown on screen, labelled an
estimate), redirect chains report only hops the free proxy exposes, and
PageSpeed 429s are shown exactly as returned.

## Verification (v2.5, 21 Nov 2026, from this VM)

- Extracted inline JS (130,352 bytes): `node --check` **PASS**.
- Served locally (`python3 -m http.server`): HTTP 200, 173,409 bytes.
- Served copy greps: PayPal plan URL exactly 1×, `REPLACE_WITH_PLAN_ID` 0×,
  Supabase URL present, all feature markers present (Broken Link, Redirect,
  Content Brief, Keyword Difficulty, Sitemap, Robots, Competitor, Health
  Checklist, Revenue Estimator, Bulk Audit, SERP Preview, JSON-LD).
- Headless Chrome (Playwright chromium_headless_shell) on the real file:
  landing renders with all new features, **no uncaught JS errors**.
- Fallback test (test copy only, in /tmp): the three new tables mocked as
  missing (PostgREST 42P01) with a fake signed-in user — `loadCloudData`
  returned empty arrays without throwing, `recordBrief` /
  `recordToolCheck` / `recordCompetitors` fell back to localStorage + cache
  and returned success, lists rendered. **PASS, no uncaught errors.**
  (This test also caught a real gap: `ensureProfile`/`loadCloudData` had no
  null guard for a failed Supabase client — guards added.)

## Not yet tested live (v2.5)

- Sign-up / sign-in / limit prompts in a real browser session.
- Each new tool end-to-end against live sites (SERP preview, broken links,
  redirect hops via proxy, schema, robots test, sitemap download, brief
  generation, competitor compare, estimator math, health checklist, bulk
  audit with a real PSI quota).
- The three new Supabase tables being created (the parallel task) and the
  `keywords.difficulty` column — until then the app runs on the localStorage
  fallback path by design.
