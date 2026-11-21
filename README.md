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
