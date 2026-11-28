
"use strict";
/* ================= v2 config ================= */
const SUPABASE_URL = "https://mzbesucdnjecinkdawzy.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_r61BK1KPrPVwF6O2AncpnA_vlg_xx6N";
/* Billing must be verified by a server before entitlement changes. */
const PAYPAL_SUBSCRIBE_URL = "";

const PLAN_LIMITS = { auditsPerMonth: 5, keywordsTotal: 10, linkChecksPerMonth: 5, briefsPerMonth: 3, comparesPerMonth: 3, toolChecksPerMonth: 10, aiMessagesPerDay: 5, sites: 1 };
/* Plans (v2.11.0): Free $0 · Pro $9/mo or $90/yr · Agency $29/mo or $290/yr ·
   Business — custom, "Talk to sales" (no PayPal plan; assigned manually by the
   owner via profiles.plan). Pro/Agency/Business are all unlimited on every
   counted limit; they differ only in site count and the Agency extras. */
const PLAN_TIERS = {
  free:     { name:"Free",     sites:1,  paid:false },
  pro:      { name:"Pro",      sites:3,  paid:true },
  agency:   { name:"Agency",   sites:10, paid:true },
  business: { name:"Business", sites:50, paid:true }
};
function planTier(p){ return PLAN_TIERS[p] || PLAN_TIERS.free; }
function planDisplayName(p){ return planTier(p).name; }
function isPaidPlan(){ return planTier(currentPlan).paid; }
function siteLimitForPlan(){ return isAdmin() ? 50 : planTier(currentPlan).sites; } /* owner: no plan cap (the form still offers 10 slots) */
/* The "My sites" form offers 10 static slots plus extra inputs created on
   demand up to the plan limit (Business/Admin: 50). The plan limit gates how
   many are kept on save: Free 1, Pro 3, Agency 10, Business 50. */
const SITE_SLOT_IDS = ["siteSlot1","siteSlot2","siteSlot3","siteSlot4","siteSlot5","siteSlot6","siteSlot7","siteSlot8","siteSlot9","siteSlot10"];
/* Single version source — the header + footer labels are filled from here at load.
   package.json and supabase/functions/status/index.ts must carry the same value
   (enforced by tests/app.test.cjs). */
const APP_VERSION = "2.12.0";
/* Owner admin (v2.10.0): the owner's own account has no limits. This is the
   same client-side limit model the app already uses — the limits are UI
   guards, not server enforcement; the server still validates plan on
   billing. The email is already public as the contact address. */
const OWNER_EMAIL = "syedsinterprises@gmail.com";
function isAdmin(){ return !!(currentUser && currentUser.email && String(currentUser.email).toLowerCase() === OWNER_EMAIL); }

/* ================= v2.6 integrations ================= */
/* Google OAuth (Search Console + Analytics, read-only).
   This EXACT redirect URI must be registered in the OAuth client:
   https://seoforge.syedsenterprises.org/app.html
   (the app lives at /app.html since v2.10.0; the landing page is /).
   Scopes: webmasters.readonly + analytics.readonly. The app runs in Google
   test mode (up to 100 users) until OAuth verification — see README.
   The client SECRET is never in this file: it lives as a Supabase secret for
   the google-oauth edge function (see functions/google-oauth/). */
const GOOGLE_CLIENT_ID = "158848063786-cmdknljpjj6po7j2uc4r26dp31qm4nek.apps.googleusercontent.com"; /* Google Cloud OAuth client — project "SEOForge" (seoforge-515414), live 21 Nov 2026 */
const GOOGLE_REDIRECT_URI = "https://seoforge.syedsenterprises.org/app.html";
const GOOGLE_SCOPES = "https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly";
const GOOGLE_OAUTH_FN = SUPABASE_URL + "/functions/v1/google-oauth";
const ALERT_FN = SUPABASE_URL + "/functions/v1/send-alert";

/* Supabase client (guarded: if the CDN fails, the app still works in local mode). */
const activeRequests = new Set();
/* Run-scoped cancellation (F3/F4): the audit run owns its own request set.
   Cancel aborts ONLY that set — the old code aborted the one global set, so
   cancelling an audit also killed any other tool's in-flight fetch. Scopes
   are passed explicitly (fetchTimeout/fetchJsonTimeout/fetchViaProxy/
   fetchPageDoc/runPSI all take an optional scope); a call with no scope
   registers in the global set, as before. Sign-out still cancels everything
   (it reloads the page anyway). */
let auditRunScope = null;
function cancelPendingRequests(){ for(const controller of activeRequests) controller.abort(); activeRequests.clear(); if(auditRunScope){ for(const controller of auditRunScope) controller.abort(); auditRunScope.clear(); } }
function cancelAuditRequests(){ if(auditRunScope){ for(const controller of auditRunScope) controller.abort(); auditRunScope.clear(); } }
let sb = null, cloudAvailable = false;
try{
  if(window.supabase && window.supabase.createClient){
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    cloudAvailable = true;
  }
}catch(e){ sb = null; cloudAvailable = false; }

/* ---------- storage ---------- */
const LS = {
  get(k, d){ try{ const v = localStorage.getItem(this.key(k)); return v ? JSON.parse(v) : d; }catch(e){ return d; } },
  set(k, v){
    try { localStorage.setItem(this.key(k), JSON.stringify(v)); }
    catch { throw new Error("Browser storage is full or unavailable. Export a backup before clearing data."); }
  },
  key(k){ return "syedSuite." + (currentUser ? "user." + currentUser.id + "." : "") + k; }
};
const $ = id => document.getElementById(id);
const esc = s => String(s==null?"":s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const todayISO = () => new Date().toISOString().slice(0,10);
const thisMonthPrefix = () => new Date().toISOString().slice(0,7); /* "YYYY-MM" */
const fmtDate = iso => { try{ return new Date(iso+"T00:00:00").toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}); }catch(e){ return iso; } };
const normHost = SEOForgeCore.normHost;
const numOrNull = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };

/* ---------- store: localStorage when logged out, Supabase cache when signed in ---------- */
const S = {
  mode: 'local', /* 'local' | 'cloud' */
  cache: { audits:[], keywords:[], links:[], revenue:[], listings:[], orders:[], briefs:[], competitors:[], toolChecks:[] },
  get(kind, def){ return this.mode==='cloud' ? (this.cache[kind]!==undefined ? this.cache[kind] : def) : LS.get(kind, def); }
};
let currentUser = null;   /* Supabase user object when signed in */
let currentPlan = 'free'; /* 'free' | 'pro' | 'agency' | 'business' */
let cloudUsage = null, usageLoading = false;
let cloudUserId = null;   /* guards against double-loading on auth events */
/* Cloud load state (v2.11.0): until loadCloudData succeeds, the cache holds
   the empty reset — the Dashboard must show "—" (loading / could not load),
   never genuine-looking zeros. Local/guest mode is unaffected: its data is
   localStorage, always present. */
let cloudDataLoaded = false, cloudDataFailed = false;

/* ---------- views (app.html is the app; the landing page lives at /) ---------- */
/* Home goes back to the landing page — except for a signed-in user, for whom
   / forwards straight back to /app, so the click would visibly do nothing.
   Signed-in users go to the Dashboard tab instead; signed-out users go to /. */
function showLanding(){ if(currentUser){ showTab("dashboard", true); } else { location.href = "./"; } }
/* Guest mode: "Continue without an account" from the landing page or the auth
   card. The flag lives in plain localStorage (not the per-user store) so a
   guest reload stays in the app instead of dropping back to the sign-in card.
   Signing in clears it (afterSignIn); signing out leaves via the landing page. */
const GUEST_KEY = "syedSuite.guest";
function isGuestMode(){
  try{ if(localStorage.getItem(GUEST_KEY)==="1") return true; }catch(e){}
  return /#guest\b/.test(location.hash||"");
}
function enterGuestMode(){
  try{ localStorage.setItem(GUEST_KEY, "1"); }catch(e){}
  showApp();
}
/* A saved Supabase session token in localStorage (the same key the Supabase JS
   client uses). The inline gate in app.html and initAppFromUrl() read this
   BEFORE initAuth() finishes, so a signed-in user returning from PayPal (or
   any reload) sees the app immediately and never flashes the auth view. An
   expired or missing token means "signed out" — the auth view shows instead,
   with no spinner and no stuck state. */
function hasSavedSession(){
  try{
    const raw = localStorage.getItem("sb-mzbesucdnjecinkdawzy-auth-token");
    if(!raw) return false;
    const s = JSON.parse(raw);
    return !!(s && s.access_token && (!s.expires_at || s.expires_at*1000 > Date.now()));
  }catch(e){ return false; }
}
function showApp(){
  delete document.documentElement.dataset.authView;
  const v = $("authView"); if(v) v.hidden = true;
  const s = $("appShell"); if(s) s.hidden = false;
}
/* Show the sign-in / create-account card. mode is "signin" or "signup" and
   the card shows exactly ONE primary button for that mode — the heading and
   the primary always match, so a "Create" heading never sits over a
   "Sign in" button. Reset password is sign-in only; the mode switch and the
   guest entry are quiet text links below the actions. The header is minimal
   while the card is up (html[data-auth-view="1"] hides the site switcher,
   search and nav toggle in CSS), and the card centres vertically instead of
   floating in a void. authMode also drives the Enter key, so the keyboard
   submits the shown mode. */
let authMode = "signin";
function showAuthView(mode){
  const s = $("appShell"); if(s) s.hidden = true;
  authMode = mode === "signup" ? "signup" : "signin";
  document.documentElement.dataset.authView = "1";
  const v = $("authView");
  if(v){
    v.hidden = false;
    const t = $("authViewTitle");
    if(t) t.textContent = authMode === "signup" ? "Create your free account" : "Sign in to SEOForge";
    const si = elOrNull("signInBtn"); if(si) si.hidden = authMode !== "signin";
    const su = elOrNull("signUpBtn"); if(su) su.hidden = authMode !== "signup";
    const fp = elOrNull("forgotPassword"); if(fp) fp.hidden = authMode !== "signin";
    const sw = elOrNull("authModeSwitch");
    if(sw){
      sw.textContent = authMode === "signup" ? "Already have an account? Sign in" : "No account yet? Create a free account";
      sw.href = authMode === "signup" ? "#auth=signin" : "#auth=signup";
    }
  }
  window.scrollTo({top:0});
}
/* Header + footer version labels read the version from ONE place (APP_VERSION).
   app.html carries <span data-app-version></span> in both spots. */
function applyVersionLabels(){
  document.querySelectorAll("[data-app-version]").forEach(el => { el.textContent = "v" + APP_VERSION; });
}
function showBanner(msg, kind){
  const b = $("topBanner");
  b.textContent = msg;
  b.className = kind === 'warn' ? 'warn' : 'okbox';
  b.hidden = false;
}
/* getElementById that returns null for a missing id instead of throwing in
   the vm test harness (whose $() asserts the id exists in the static HTML).
   For elements rendered dynamically — the share bar, the disconnect-confirm
   row — a missing element just means "not on screen". */
function elOrNull(id){ try{ return document.getElementById(id); }catch(e){ return null; } }
/* Inline error/warn note prepended to a results area (no native modals).
   The note survives until the area is re-rendered — the same pattern every
   tool already uses for empty-input errors. */
function prependNote(elId, cls, msg){
  const el = $(elId); if(!el) return;
  el.innerHTML = '<div class="' + cls + '">' + esc(msg) + '</div>' + el.innerHTML;
}
/* Inline error inside a form area (no native modals). Empty msg clears it. */
function formErr(elId, msg){
  const el = $(elId); if(!el) return;
  el.innerHTML = msg ? '<div class="err">' + esc(msg) + '</div>' : '';
}
$("topBanner").addEventListener("click", () => { $("topBanner").hidden = true; });
$("homeBtn").addEventListener("click", showLanding);
function focusAuth(){ showAuthView("signin"); const el = $("authEmail"); if(el) el.focus(); }
function showAuthMsg(msg){ $("authMsg").textContent = msg; }

/* ---------- tabs ---------- */
const VALID_TABS = ["dashboard","audit","health","bulk","keywords","rank","compete","links","broken","redirect","brief","serp","schema","robots","gsc","ads","market","estimator","preferences","admin"];
/* Deep links: #tab=rank opens the Rank Tracker, etc. Returns "" for anything else.
   The tab parameter may sit after another hash parameter (e.g. the landing's
   "Save this audit" link is #auth=signup&tab=health&url=...), so match tab=
   after either # or &. */
function parseTabHash(hash){
  const m = String(hash||"").match(/(?:#|&)tab=([a-z]+)/);
  if(!m || !VALID_TABS.includes(m[1])) return "";
  if(m[1]==="admin" && !isAdmin()) return ""; /* non-owners fall back to dashboard */
  return m[1];
}
/* Shared-score deep link: #tab=health&url=<encoded URL> — from the landing
   hero widget's "Share your score" and from any shared score card. The URL is
   validated by normaliseSite, so junk never reaches the Health Check. Pure,
   so it is unit testable. The url parameter may follow #auth=signup (the
   "Save this audit" link), so match tab= after either # or &. */
function parseShareHash(hash){
  const m = String(hash||"").match(/(?:#|&)tab=health&url=([^&]+)/);
  if(!m) return "";
  try{ return normaliseSite(decodeURIComponent(m[1])); }catch(e){ return ""; }
}
/* A share link that lands on a signup view: the check runs AFTER sign-in and
   saves to the new account — that is what "Save this audit" means. Set by
   initAppFromUrl, consumed by afterSignIn. */
let pendingShareUrl = "";
/* Share-link runs, once per page load (F12): back/forward to an already-run
   #tab=health&url= hash must prefill the tab but NOT re-run (and re-save)
   the check — each re-run burned one of a Free user's 5 monthly audits. */
const shareRuns = new Set();
/* Parse an auth intent from the hash, e.g. #auth=signup from the landing page.
   It may sit after another hash parameter, so match auth= after # or &. */
function parseAuthHash(hash){
  const m = String(hash||"").match(/(?:#|&)auth=(signin|signup)/);
  return m ? m[1] : "";
}
document.querySelectorAll("button[data-tab]").forEach(b => b.addEventListener("click", () => showTab(b.dataset.tab, true)));
document.querySelectorAll("[data-goto]").forEach(b => b.addEventListener("click", () => showTab(b.dataset.goto, true)));
/* Back/forward across tabs: a user tab click pushState()s a history entry, so
   the back button walks back through tabs; programmatic switches (init,
   deep links, hashchange) replaceState() instead, so they never add entries. */
if(typeof window.addEventListener === "function"){
  window.addEventListener("hashchange", () => {
    /* A share link pasted while already in the app: prefill the Health Check
       and run it — a full page load does this in initAppFromUrl, but without
       this branch the hash only switched tabs and the URL was never run. */
    const shared = parseShareHash(location.hash);
    if(shared){
      if(!isGuestMode() && !hasSavedSession() && !currentUser) enterGuestMode();
      else showApp();
      showTab("health");
      const el = $("hcUrl"); if(el) el.value = shared;
      const key = "health|" + shared;
      if(!shareRuns.has(key)){ shareRuns.add(key); runHealth(); }
      return;
    }
    const t = parseTabHash(location.hash);
    if(t) showTab(t);
    /* An unknown #tab= value never leaves the user on a stale tab while the
       address bar says something else: fall back to the Dashboard with a
       one-line note. (A hash with no tab= at all — e.g. #pricing carried over
       from the landing — is left alone.) */
    else if(/(?:#|&)tab=/.test(location.hash||"")){ showTab("dashboard"); showBanner("Unknown section — showing the Dashboard.", "warn"); }
    const a = parseAuthHash(location.hash);
    if(a) showAuthView(a);
    else if(/#guest\b/.test(location.hash||"")) showApp();
  });
}
function showTab(name, push){
  document.querySelectorAll("button[data-tab]").forEach(b => b.classList.toggle("active", b.dataset.tab===name));
  document.querySelectorAll("section.tab").forEach(s => s.classList.toggle("active", s.id==="tab-"+name));
  try{
    /* Keep a present &url= share param ONLY on the Health tab, so copying
       the address bar after a tab switch still shares the check. On any
       other tab &url= is a dead share link (parseShareHash requires
       tab=health) — strip it instead of carrying it around (F12). */
    let suffix = "";
    if(name==="health"){
      const um = String(location.hash||"").match(/(?:#|&)url=([^&]+)/);
      if(um){ try{ suffix = "&url=" + encodeURIComponent(decodeURIComponent(um[1])); }catch(e){ suffix = "&url=" + um[1]; } }
    }
    const hash = "#tab=" + name + suffix;
    if(push && history.pushState) history.pushState(null, "", hash); else history.replaceState(null, "", hash);
  }catch(e){}
  if(name==="dashboard"){ renderDashboard(); renderPlanCard(); }
  if(name==="audit"){ renderAuditHistory(); renderLimitNotes(); }
  if(name==="rank"){ renderRankList(); renderLimitNotes(); }
  if(name==="links"){ renderLinkHistory(); renderLimitNotes(); }
  if(name==="ads"){ renderRevenue(); }
  if(name==="preferences"){ loadSettings(); renderLimitNotes(); if(capabilitiesState!=="ok") loadCapabilities(); }
  if(name==="market") renderMarket();
  if(name==="admin"){ renderAdmin(); }
  if(name==="gsc"){ renderGoogleStatus(); }
  if(name==="brief"){ renderBriefs(); renderLimitNotes(); }
  if(name==="compete"){ renderCompetitors(); renderLimitNotes(); }
  if(name==="serp" || name==="broken" || name==="redirect" || name==="schema" || name==="robots" || name==="estimator" || name==="health" || name==="bulk"){ renderLimitNotes(); }
  window.scrollTo({top:0});
}
/* ---------- header controls: site switcher, global search, sidebar ---------- */
$("siteSwitcher").addEventListener("change", () => {
  const v = $("siteSwitcher").value;
  if(!v) return;
  LS.set("selectedSite", v);
  applySelectedSite();
});
$("globalSearch").addEventListener("input", () => {
  const box = $("globalSearchResults"); if(!box) return;
  const targets = globalSearchTargets($("globalSearch").value);
  box.innerHTML = targets.map((t,i) => '<button type="button" class="gs-result" data-gs="' + i + '">' + esc(t.label) + '</button>').join("");
  box.querySelectorAll("[data-gs]").forEach(b => b.addEventListener("click", () => {
    const t = targets[+b.dataset.gs]; if(!t) return;
    const el = $(t.field); if(el) el.value = t.value;
    showTab(t.tab, true); box.innerHTML = ""; $("globalSearch").value = "";
  }));
});
$("globalSearch").addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); globalSearchGo($("globalSearch").value); } });
$("headerSignInBtn").addEventListener("click", focusAuth);
$("authGuestLink").addEventListener("click", enterGuestMode);
/* The free-plan monthly limits apply to cloud users on the Free plan only.
   Every paid tier (Pro, Agency, Business) is unlimited — the old inline
   checks compared against 'pro' only, which wrongly capped Agency and
   Business users at the free limits. One helper, used by all four gates. */
function planLimitApplies(){ return S.mode==='cloud' && !isPaidPlan() && !isAdmin(); }
$("siteSaveBtn").addEventListener("click", () => {
  /* Preserve-not-delete (F2): the plan limit gates how many sites are
     ACTIVE / visible in the form — it never deletes stored sites. A Business
     user with 50 sites who downgrades to Agency keeps all 50 stored; 10 are
     active, 40 are kept (not active) and shown below with a Remove button.
     A save only ever rewrites the visible window; the kept tail is carried
     over untouched. Nothing here overwrites a longer stored list with a
     shorter one. */
  const limit = siteLimitForPlan();
  const prevSel = LS.get("selectedSite", "");
  const stored = storedSites();
  const visible = normalizeSiteList(siteSlotValues().filter(v => v !== undefined && v !== null));
  const active = visible.slice(0, limit);
  const notAdded = visible.length - active.length;
  const kept = stored.slice(limit).filter(x => !active.includes(x));
  const sites = active.concat(kept);
  LS.set("sites", sites);
  /* Keep the current selection when it is still in the list (F6) — the old
     code unconditionally reset it to sites[0] on every save. */
  if(prevSel && sites.includes(prevSel)) LS.set("selectedSite", prevSel);
  else if(sites.length) LS.set("selectedSite", sites[0]);
  renderSiteSwitcher(); applySelectedSite(); loadSiteSlots();
  $("siteSaved").textContent = sites.length ? "Saved — " + active.length + " active site(s)" + (kept.length ? " · " + kept.length + " extra kept (not active)" : "") + (notAdded ? " · " + notAdded + " entered site(s) not added — your " + planDisplayName(currentPlan) + " plan allows " + limit : "") + "." : "Saved — no sites.";
  setTimeout(() => { $("siteSaved").textContent = ""; }, 5000);
});
/* Sidebar: collapse to icons on desktop, drawer on small screens. */
$("sidebarToggle").addEventListener("click", () => { document.body.classList.toggle("sidebar-collapsed"); });
$("navToggle").addEventListener("click", () => { document.body.classList.toggle("nav-open"); });
document.querySelectorAll("#sidebar button[data-tab], #bottomNav button[data-tab]").forEach(b => b.addEventListener("click", () => { document.body.classList.remove("nav-open"); }));

/* The upgrade entry point (header button, plan card, limit prompts) — delegated
   so dynamically rendered buttons work too. The picker lives in the Dashboard
   plan card; see goUpgrade() below. */
document.addEventListener("click", e => {
  const t = e.target.closest('[data-action="upgrade"]');
  if(t){ e.preventDefault(); goUpgrade(); }
});
function handlePaypalReturn(){
  const url = new URL(location.href);
  if(url.searchParams.has("subscription_id")){
    url.searchParams.delete("subscription_id");
    history.replaceState(null, "", url.toString());
    try { localStorage.removeItem("syedSuite.paypalSubId"); } catch {}
    showBanner("A checkout return is not payment verification. Your plan changes only after server confirmation.", "warn");
    return true;
  }
  /* PayPal's cancel return carries only ?token=… (no subscription_id), so
     without this branch a cancelled checkout returned in silence — the user
     could not tell whether anything had been charged. */
  if(url.searchParams.has("token")){
    url.searchParams.delete("token");
    history.replaceState(null, "", url.toString());
    showBanner("Checkout cancelled — no charge was made and your plan is unchanged.", "ok");
    return true;
  }
  return false;
}
async function applyPendingPaypalSub(){
  // Clear legacy, untrusted checkout data. Never write entitlements from the browser.
  try { localStorage.removeItem("syedSuite.paypalSubId"); } catch {}
}

/* ---------- auth ---------- */
function refreshAuthUI(){
  $("authLoggedOut").hidden = !!currentUser;
  $("authLoggedIn").hidden = !currentUser;
  applyVersionLabels();
  $("upgradeBtn").style.display = (isAdmin() || currentPlan==="agency" || currentPlan==="business") ? 'none' : '';
  $("upgradeBtn").textContent = currentPlan==="pro" ? "Upgrade to Agency — $29/mo" : "Upgrade to Pro — $9/mo";
  /* The logo button goes to the Dashboard for a signed-in user (the landing
     would forward straight back) and to the landing for a signed-out one —
     the title says which, so the click never looks dead. */
  $("homeBtn").title = currentUser ? "SEOForge — back to the Dashboard" : "SEOForge — back to the home page";
  if(currentUser){
    $("authUserEmail").textContent = currentUser.email || "";
    const pill = $("planPill");
    pill.textContent = isAdmin() ? 'Admin' : planDisplayName(currentPlan);
    pill.classList.toggle('pro', isAdmin() || isPaidPlan());
  }
  renderAdminSection();
}
/* ---------- owner admin dashboard (v2.10.0) ---------- */
const ADMIN_STATS_FN = SUPABASE_URL + "/functions/v1/admin-stats";
let adminSectionEl = null, adminPanelEl = null;
/* The Admin sidebar section + tab panel are created ONLY for the owner and
   removed for everyone else — they do not exist in the DOM for non-owners.
   Called from refreshAuthUI on every auth change. */
function renderAdminSection(){
  if(adminSectionEl){ try{ adminSectionEl.remove(); }catch(e){} adminSectionEl = null; }
  if(adminPanelEl){ try{ adminPanelEl.remove(); }catch(e){} adminPanelEl = null; }
  if(!isAdmin()) return;
  const nav = $("sidebarNav"), main = $("appMain");
  if(!nav || !main) return;
  adminSectionEl = document.createElement("div");
  adminSectionEl.className = "side-group";
  adminSectionEl.id = "adminSection";
  adminSectionEl.innerHTML = '<span class="side-group-label">Admin</span><button type="button" data-tab="admin"><svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6z"/></svg>Admin dashboard</button>';
  const btn = adminSectionEl.querySelector("button");
  if(btn) btn.addEventListener("click", () => { showTab("admin", true); document.body.classList.remove("nav-open"); });
  nav.appendChild(adminSectionEl);
  adminPanelEl = document.createElement("section");
  adminPanelEl.className = "tab";
  adminPanelEl.id = "tab-admin";
  adminPanelEl.innerHTML = '<div class="card"><h2>Admin dashboard</h2><p class="muted">Owner only — your account, platform health and user counts. No other user\u2019s private data is shown here.</p><div id="adminOut"><p class="muted">Loading…</p></div></div>';
  main.appendChild(adminPanelEl);
}
/* Admin dashboard contents — all from the owner's own data + public endpoints.
   User counts come from the server-gated admin-stats function; if it does not
   answer, the rest still renders with an honest "unavailable" line. */
/* Admin dashboard (v2.11.0): renders the static sections immediately, then
   fills the three server sections (platform health, PayPal, user counts)
   CONCURRENTLY as each answers, each with a ~10s timeout and an honest
   "unavailable — retry" line. The old version awaited all three in sequence
   before painting anything, which read as a ~15s hang. Nothing here changes
   what admin-stats returns — the labels below match its fields exactly. */
async function renderAdmin(){
  const panel = adminPanelEl;
  if(!panel || !isAdmin()) return;
  const audits = S.get("audits", []), kws = S.get("keywords", []), links = S.get("links", []),
    rev = S.get("revenue", []), orders = S.get("orders", []), briefs = S.get("briefs", []),
    comps = S.get("competitors", []);
  const revTotal = rev.reduce((a,r)=>a+(+r.amount||0),0);
  /* "Links verified" counts LINKS, not Link Verifier runs: one saved check can
     hold dozens of links (grouped rows carry .count). Same fix as the
     Dashboard stat — see renderDashboard. */
  const linkTotal = links.reduce((a,g)=>a+((g&&g.count)||0),0);
  panel.innerHTML = '<div class="card"><h2>Admin dashboard</h2>'
    + '<h3>Account</h3><p>Signed in as <b>' + esc(currentUser.email||"") + '</b> — <b>Admin — unlimited</b>, no restrictions.</p>'
    + '<h3>Platform health</h3><div id="adminHealth"><p class="muted">Checking platform health…</p></div>'
    + '<h3>My totals</h3><ul><li>Audits: <b>' + audits.length + '</b></li><li>Keywords tracked: <b>' + kws.length + '</b></li><li>Links verified: <b>' + linkTotal + '</b> across ' + links.length + ' check(s)</li><li>Revenue logged: <b>$' + revTotal.toFixed(2) + '</b> across ' + rev.length + ' entries</li><li>Orders: <b>' + orders.length + '</b></li><li>Content briefs: <b>' + briefs.length + '</b></li><li>Competitor compares: <b>' + v25Usage().comparesUsed + '</b></li></ul>'
    + '<h3>PayPal</h3><div id="adminPay"><p class="muted">Checking PayPal status…</p></div>'
    + '<h3>Users (counts only)</h3><div id="adminUsers"><p class="muted">Loading user counts…</p></div>'
    + '</div>';
  fillAdminHealth(); fillAdminPay(); fillAdminUsers();
}
async function fillAdminHealth(){
  const el = $("adminHealth"); if(!el) return;
  try{
    const res = await fetchTimeout(SUPABASE_URL + "/functions/v1/status", 10000);
    if(!res.ok) throw new Error("Status unavailable");
    const s = await res.json();
    const row = (k,v) => '<li>' + esc(k) + ': <b>' + (v===true ? 'yes' : v===false ? 'no' : esc(String(v==null?"—":v))) + '</b></li>';
    el.innerHTML = '<ul>' + row("Version", s.version) + row("Core", s.core) + row("Google connected", s.google) + row("Billing enabled", s.billing) + row("Email configured", s.email) + row("Weekly summary scheduled", s.emailScheduled) + '</ul>';
  }catch(e){ el.innerHTML = '<p class="muted">Platform health unavailable — the status endpoint did not answer. <button class="btn small secondary" id="adminHealthRetry">Retry</button></p>'; const b = $("adminHealthRetry"); if(b) b.addEventListener("click", fillAdminHealth); }
}
async function fillAdminPay(){
  const el = $("adminPay"); if(!el) return;
  try{
    const token = await supabaseAccessToken();
    if(!token) throw new Error("Sign in to check PayPal status");
    const res = await fetchJsonTimeout(SUPABASE_URL + "/functions/v1/billing", 10000, {method:"POST", headers:{"Content-Type":"application/json", Authorization:"Bearer "+token}, body:JSON.stringify({action:"status"})});
    const d = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(d.error || "Billing status unavailable");
    el.innerHTML = '<p>Plan: <b>' + esc(d.plan||"free") + '</b></p>';
  }catch(e){ el.innerHTML = '<p class="muted">PayPal status unavailable — ' + esc(e.message) + ' <button class="btn small secondary" id="adminPayRetry">Retry</button></p>'; const b = $("adminPayRetry"); if(b) b.addEventListener("click", fillAdminPay); }
}
async function fillAdminUsers(){
  const el = $("adminUsers"); if(!el) return;
  try{
    const token = await supabaseAccessToken();
    if(!token) throw new Error("Sign in to load user counts");
    const res = await fetchJsonTimeout(ADMIN_STATS_FN, 10000, {method:"POST", headers:{"Content-Type":"application/json", Authorization:"Bearer "+token}, body:"{}"});
    const d = await res.json().catch(()=>({}));
    if(!res.ok || typeof d.totalUsers !== "number") throw new Error(d.error || "User stats unavailable");
    /* Labels match admin-stats exactly: proUsers/agencyUsers/businessUsers are
       profiles.plan counts; payingUsers counts ACTIVE billing_subscriptions
       only. An abandoned APPROVAL_PENDING subscription (left by an earlier QA
       walkthrough: Upgrade clicked, then cancelled at PayPal) is shown as
       "not active, no charge" — it is a real record, never deleted. */
    el.innerHTML = '<ul>'
      + '<li>Total users: <b>' + d.totalUsers + '</b></li>'
      + '<li>Pro users: <b>' + (d.proUsers==null?"—":d.proUsers) + '</b></li>'
      + '<li>Agency users: <b>' + (d.agencyUsers==null?"—":d.agencyUsers) + '</b></li>'
      + '<li>Business users: <b>' + (d.businessUsers==null?"—":d.businessUsers) + '</b></li>'
      + '<li>Paying users: <b>' + (d.payingUsers==null?"—":d.payingUsers) + '</b> <span class="muted">(active subscriptions only)</span></li>'
      + '<li>Signups in the last 7 days: <b>' + d.signups7d + '</b></li>'
      + '<li>Audits run this month (all users): <b>' + d.auditsThisMonth + '</b></li></ul>'
      + (d.paypalPlanId ? '<p class="muted">PayPal plan ID: ' + esc(d.paypalPlanId) + '</p>' : '')
      + (d.subscription ? '<p>Subscription: <b>' + esc(d.subscription.status||"") + '</b> <span class="muted">(' + esc(d.subscription.id||"") + ')' + (d.subscription.status && d.subscription.status!=="ACTIVE" ? ' — not active, no charge' : '') + '</span></p>' : '<p class="muted">No PayPal subscription on file.</p>');
  }catch(e){ el.innerHTML = '<p class="muted">User stats unavailable — the admin-stats function did not answer. The rest of this page is unaffected. <button class="btn small secondary" id="adminUsersRetry">Retry</button></p>'; const b = $("adminUsersRetry"); if(b) b.addEventListener("click", fillAdminUsers); }
}
async function ensureProfile(user){
  if(!sb) return 'free';
  const { data, error } = await sb.from("profiles").select("id,plan").eq("id", user.id).maybeSingle();
  if(error){ console.error("profile lookup failed", error); return 'free'; }
  if(data) return data.plan || 'free';
  const { error: insErr } = await sb.from("profiles").insert({ id: user.id, email: user.email || "", plan: "free" });
  if(insErr){ console.error("profile create failed", insErr); return 'free'; }
  return 'free';
}
async function loadCloudData(){
  if(!sb) return;
  const uid = currentUser.id;
  const generation = authGeneration;
  const empty = { audits:[], keywords:[], links:[], revenue:[], listings:[], orders:[], briefs:[], competitors:[], toolChecks:[] };
  const q = async (table, orderCol, limit) => {
    let query = sb.from(table).select("*").eq("user_id", uid);
    if(orderCol) query = query.order(orderCol, { ascending:false });
    if(limit) query = query.limit(limit);
    const { data, error } = await query;
    if(error) throw new Error("Could not load " + table + ": " + error.message);
    return data || [];
  };
  const [audits, keywords, rankChecks, vlinks, revenue, listings, orders, briefs, competitors, siteChecks] = await Promise.all([
    q("audits", "created_at", 20),
    q("keywords", "created_at", 500),
    q("rank_checks", "checked_at", 2000),
    q("verified_links", "checked_at", 200),
    q("revenue_entries", "entry_date", 500),
    q("listings", "created_at", 200),
    q("orders", "created_at", 200),
    q("content_briefs", "created_at", 100),
    q("competitors", "created_at", 100),
    q("site_checks", "created_at", 200)
  ]);
  if (generation !== authGeneration || currentUser?.id !== uid) return;
  S.cache.audits = audits.map(a => ({ id:a.id, date:(a.created_at||"").slice(0,10), url:a.url, total:null, ok:null, failed:null, psi:a.score, lcp:(a.lcp!=null?String(a.lcp):null), cls:(a.cls!=null?String(a.cls):null) }));
  const checksByKw = {};
  rankChecks.forEach(c => { (checksByKw[c.keyword_id] = checksByKw[c.keyword_id] || []).push({ date:(c.checked_at||"").slice(0,10), position:c.position, checkedAt:c.checked_at }); });
  S.cache.keywords = keywords.map(k => ({ id:k.id, keyword:k.keyword, url:k.url||"", difficulty:(k.difficulty==null?null:k.difficulty), checks:(checksByKw[k.id]||[]).sort((a,b)=>(a.checkedAt||a.date).localeCompare(b.checkedAt||b.date)) }));
  S.cache.links = groupVerifiedRows(vlinks);
  S.cache.revenue = revenue.map(r => ({ id:r.id, date:r.entry_date, network:r.network, amount:r.amount }));
  S.cache.listings = listings.map(l => ({ id:l.id, site:l.site_url, niche:l.niche||"", price:l.price, da:(l.da==null?"":String(l.da)), dr:(l.dr==null?"":String(l.dr)), title:(l.site_url||"").replace(/^https?:\/\//,""), desc:"Custom listing added by you." }));
  const listingById = {};
  S.cache.listings.forEach(l => { listingById[l.id] = l; });
  S.cache.orders = orders.map(o => {
    const l = listingById[o.listing_id];
    return { id:o.id, date:(o.created_at||"").slice(0,10), listing:l?l.title:(o.listing_id||"listing"), site:l?l.site:"", price:l?l.price:null, status:o.status||"pending", listing_id:o.listing_id };
  });
  /* v2.5 tables — q() already returns [] when a table does not exist yet, so
     a missing table never breaks loading; the features fall back to localStorage. */
  S.cache.briefs = briefs.map(b => ({ id:b.id, date:(b.created_at||"").slice(0,10), keyword:b.keyword||"", brief:b.brief||{} }));
  /* Dedupe competitors at load: rows recorded before the v2.11.0 normalizer
     ("www.lookforit.xyz" and "lookforit.xyz") collapse to one here, so no
     database delete is needed to fix the duplicate. */
  S.cache.competitors = dedupeCompetitors(competitors.map(c => ({ id:c.id, date:(c.created_at||"").slice(0,10), url:c.url||"" })));
  S.cache.toolChecks = siteChecks.map(t => ({ id:t.id, date:(t.created_at||"").slice(0,10), type:t.check_type||"", url:t.url||"", summary:(t.result && t.result.summary)||"" }));
  cloudDataLoaded = true; cloudDataFailed = false;
}
function groupVerifiedRows(rows){
  const map = new Map();
  rows.forEach(r => {
    const d = (r.checked_at||"").slice(0,10);
    const key = r.observation_id || (r.page_url + "|" + r.target_domain + "|" + (r.checked_at||""));
    if(!map.has(key)) map.set(key, { date:d, page:r.page_url, domain:r.target_domain, hits:[] });
    map.get(key).hits.push(r);
  });
  return [...map.values()].map(g => {
    const found = g.hits.filter(h => h.found);
    return { date:g.date, page:g.page, domain:g.domain, count:found.length,
      types: found.length ? [...new Set(found.map(h => classifyRel(h.rel).label))].join(", ") : "No link found" };
  });
}
/* Guest data stays on this device. Never auto-upload shared-browser data into an account. */

async function cloudInsertAudit(a){
  const { data, error } = await sb.from("audits").insert({ user_id:currentUser.id, url:a.url, score:(a.psi==null?null:a.psi), lcp:numOrNull(a.lcp), cls:numOrNull(a.cls), created_at:new Date().toISOString() }).select("id").single();
  if(error) throw new Error("Audit could not be saved: " + error.message);
  return data.id;
}
let authGeneration = 0;
let signInTask = null;
let signingInId = null;
/* Guest data lives under the un-namespaced keys ("syedSuite.audits", ...).
   Never auto-upload it into an account — but say so on first sign-in, or
   the user sees an empty Dashboard and thinks their work vanished. */
function guestStoreHasData(){
  try{
    return ["audits","keywords","links","revenue","listings","orders","briefs","competitors","toolChecks"].some(k => {
      const raw = localStorage.getItem("syedSuite." + k);
      if(!raw) return false;
      const v = JSON.parse(raw);
      return Array.isArray(v) && v.length > 0;
    });
  }catch(e){ return false; }
}
async function afterSignIn(user){
  if(!user) return;
  const guestHadData = guestStoreHasData();
  if(cloudUserId === user.id && currentUser?.id === user.id) return;
  if(currentUser?.id !== user.id) cancelPendingRequests();
  if(signInTask && signingInId === user.id) return signInTask;
  const generation = ++authGeneration;
  cloudUsage = null;
  cloudDataLoaded = false; cloudDataFailed = false;
  currentUser = user;
  S.mode = "cloud";
  S.cache = { audits:[], keywords:[], links:[], revenue:[], listings:[], orders:[], briefs:[], competitors:[], toolChecks:[] };
  signingInId = user.id;
  signInTask = (async () => {
    const plan = await ensureProfile(user);
    if(generation !== authGeneration) return;
    currentPlan = plan;
    await loadCloudData();
    if(generation !== authGeneration) return;
    cloudUserId = user.id;
    await applyPendingPaypalSub();
    try{ localStorage.removeItem(GUEST_KEY); }catch(e){}
    refreshAuthUI(); showApp(); renderAll(); loadPreferences();
    /* First sign-in with guest work in this browser: explain where it is.
       Once per account — the flag lives in the per-user store, so a later
       reload does not nag again. */
    if(guestHadData && !LS.get("guestBannerShown", false)){
      LS.set("guestBannerShown", true);
      showBanner("Your guest work stays in this browser — export it from Workspace settings or re-run it to save it to your account.", "warn");
    }
    /* A share link that waited for sign-in ("Save this audit"): run the check
       now so it saves to the new account. */
    if(pendingShareUrl){
      const u = pendingShareUrl; pendingShareUrl = "";
      const el = $("hcUrl"); if(el) el.value = u;
      showTab("health"); runHealth();
    }
    $("authPass").value = "";
  })();
  try { await signInTask; }
  catch(e){ if(generation === authGeneration){ cloudDataFailed = true; showBanner("Account data could not load. Reload to retry. " + e.message, "warn"); renderAll(); } }
  finally { if(generation === authGeneration){ signInTask = null; signingInId = null; } }
}

async function doSignUp(){
  if(!cloudAvailable){ showAuthMsg("Sign-in is unavailable right now (the Supabase library failed to load). The app still works locally — try again later."); return; }
  const email = ($("authEmail").value||"").trim();
  const pass = $("authPass").value||"";
  if(!email || !pass){ showAuthMsg("Enter an email and a password."); return; }
  if(pass.length < 12){ showAuthMsg("Use a password of at least 12 characters."); return; }
  showAuthMsg("Creating your account…");
  const { data, error } = await sb.auth.signUp({ email, password: pass, options:{ emailRedirectTo: location.origin + "/app.html" } });
  if(error){ showAuthMsg("Sign-up failed: " + error.message); return; }
  if(data.session && data.session.user){
    showAuthMsg("Account created — welcome!");
    await afterSignIn(data.session.user);
  }else if(data.user && data.user.identities && data.user.identities.length === 0){
    /* Supabase never says outright that an email is already registered — it
       returns a success with an empty identities list and no session. The app
       has to spot that and say so plainly, instead of the misleading
       "Account created — check your inbox" message. */
    showAuthMsg("An account with this email already exists — try signing in instead.");
  }else{
    showAuthMsg("Account created — check your inbox for the confirmation email, then sign in.");
  }
}
async function doSignIn(){
  if(!cloudAvailable){ showAuthMsg("Sign-in is unavailable right now (the Supabase library failed to load). The app still works locally — try again later."); return; }
  const email = ($("authEmail").value||"").trim();
  const pass = $("authPass").value||"";
  if(!email || !pass){ showAuthMsg("Enter your email and password."); return; }
  showAuthMsg("Signing in…");
  $("resendBtn").hidden = true;
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
  if(error){
    if(/not confirmed/i.test(error.message||"")){
      showAuthMsg("Your email isn't confirmed yet — check your inbox for the confirmation email, or tap Resend confirmation below.");
      $("resendBtn").hidden = false;
    }else{
      showAuthMsg("Sign-in failed: " + error.message);
    }
    return;
  }
  showAuthMsg("");
  if(data.user) await afterSignIn(data.user);
}
function clearAuthState(){
  cancelPendingRequests();
  ++authGeneration; signInTask = null; signingInId = null;
  cloudUsage = null;
  cloudDataLoaded = false; cloudDataFailed = false;
  currentUser = null; currentPlan = "free"; cloudUserId = null; S.mode = "local";
  S.cache = { audits:[], keywords:[], links:[], revenue:[], listings:[], orders:[], briefs:[], competitors:[], toolChecks:[] };
  refreshAuthUI(); showLanding(); renderAll(); loadPreferences();
}
async function doSignOut(){
  try {
    const { error } = await sb.auth.signOut();
    if(error) throw error;
    clearAuthState();
    location.reload(); // cancel in-flight tools and discard private rendered results
  } catch(e) { showAuthMsg("Sign-out failed: " + e.message); }
}

$("signUpBtn").addEventListener("click", doSignUp);
$("signInBtn").addEventListener("click", doSignIn);
async function doResendConfirmation(){
  if(!cloudAvailable){ showAuthMsg("Sign-in is unavailable right now (the Supabase library failed to load)."); return; }
  const email = ($("authEmail").value||"").trim();
  if(!email){ showAuthMsg("Enter your email above first, then tap Resend confirmation."); return; }
  showAuthMsg("Sending confirmation email…");
  const { error } = await sb.auth.resend({ type:"signup", email, options:{ emailRedirectTo: location.origin + "/app.html" } });
  if(error){ showAuthMsg("Could not resend: " + error.message); return; }
  showAuthMsg("Confirmation email sent — check your inbox (and spam folder).");
}
$("resendBtn").addEventListener("click", doResendConfirmation);
async function doGoogleSignIn(){
  if(!cloudAvailable){ showAuthMsg("Sign-in is unavailable right now (the Supabase library failed to load)."); return; }
  showAuthMsg("Opening Google sign-in…");
  const { error } = await sb.auth.signInWithOAuth({ provider:"google", options:{ redirectTo: location.origin + location.pathname } });
  if(error) showAuthMsg("Google sign-in failed: " + error.message);
}
$("googleSignInBtn").addEventListener("click", doGoogleSignIn);
$("signOutBtn").addEventListener("click", doSignOut);
$("authPass").addEventListener("keydown", e => { if(e.key === "Enter") (authMode === "signup" ? doSignUp() : doSignIn()); });
async function initAuth(){
  if(!cloudAvailable){
    showAuthMsg("Cloud sign-in is unavailable. You can use local tools and retry later.");
    return;
  }
  // Never await Supabase calls inside its auth callback (the session lock is held).
  sb.auth.onAuthStateChange((event, session) => {
    setTimeout(() => {
      if(event === "SIGNED_OUT" && currentUser){ clearAuthState(); location.reload(); }
      if(event === "SIGNED_IN" && session?.user && cloudUserId !== session.user.id) afterSignIn(session.user);
      if(event === "PASSWORD_RECOVERY") showRecoveryForm();
    }, 0);
  });
  try {
    const { data, error } = await sb.auth.getSession();
    if(error) throw error;
    if(data.session?.user) await afterSignIn(data.session.user);
  } catch(e){ showAuthMsg("Session could not be restored: " + e.message); }
}

/* ---------- free-plan usage ---------- */
function usageThisMonth(){
  if(currentUser && cloudUsage) return cloudUsage;
  const m = thisMonthPrefix();
  const auditsUsed = S.get("audits", []).filter(a => (a.date||"").indexOf(m) === 0).length;
  const linksUsed = S.get("links", []).filter(l => (l.date||"").indexOf(m) === 0).length;
  const keywordsUsed = S.get("keywords", []).length;
  return { auditsUsed, linksUsed, keywordsUsed };
}
function limitNoteText(){
  if(!currentUser) return "Not signed in — usage is saved in this browser only. Sign in to keep it in your account.";
  if(isAdmin()) return "Admin — unlimited: no limits on audits, keywords, link checks, briefs, compares or tool checks.";
  if(currentPlan === 'pro') return "Pro plan: unlimited audits, keywords, link checks, briefs, compares, tool checks and AI messages · 3 sites.";
  if(currentPlan === 'agency') return "Agency plan: everything in Pro · 10 sites · featured marketplace listings · priority email support.";
  if(currentPlan === 'business') return "Business plan: everything in Agency · up to 50 sites · custom limits · dedicated support.";
  const u = usageThisMonth();
  const v = v25Usage();
  return "Free plan: " + (PLAN_LIMITS.auditsPerMonth - u.auditsUsed) + " of " + PLAN_LIMITS.auditsPerMonth + " audits left this month · "
    + (PLAN_LIMITS.linkChecksPerMonth - u.linksUsed) + " of " + PLAN_LIMITS.linkChecksPerMonth + " link checks left · "
    + (PLAN_LIMITS.keywordsTotal - u.keywordsUsed) + " of " + PLAN_LIMITS.keywordsTotal + " keywords left · "
    + (PLAN_LIMITS.briefsPerMonth - v.briefsUsed) + " of " + PLAN_LIMITS.briefsPerMonth + " content briefs left · "
    + (PLAN_LIMITS.comparesPerMonth - v.comparesUsed) + " of " + PLAN_LIMITS.comparesPerMonth + " competitor compares left · "
    + (PLAN_LIMITS.toolChecksPerMonth - v.toolChecksUsed) + " of " + PLAN_LIMITS.toolChecksPerMonth + " tool checks left · 1 site · " + PLAN_LIMITS.aiMessagesPerDay + " AI messages a day.";
}
function renderLimitNotes(){
  const t = limitNoteText();
  ["auditLimitNote","lvLimitNote","rkLimitNote","blLimitNote","rdLimitNote","scLimitNote","rbLimitNote","smLimitNote","brLimitNote","cpLimitNote","hcLimitNote","bkLimitNote"].forEach(id => { const el = $(id); if(el) el.textContent = t; });
  if(currentUser && sb && !usageLoading){
    usageLoading = true;
    const uid=currentUser.id;
    sb.rpc("current_usage").then(({data,error})=>{
      if(!error && data && currentUser?.id===uid){
        /* The RPC's comparesUsed is derived from competitor ROWS server-side
           (see deploy item D-c) and undercounts re-compares of tracked URLs,
           so it must never overwrite the client run-count: compares are
           counted by RUNS in v25Usage()/toolChecks. Once the account data has
           loaded, the client count is authoritative here. */
        let comparesUsed = data.comparesUsed;
        if(cloudDataLoaded){
          const m = thisMonthPrefix();
          comparesUsed = S.get("toolChecks", []).filter(t => (t.date||"").indexOf(m)===0 && t.type==="compare").length;
        }
        cloudUsage = Object.assign({}, data, {comparesUsed});
        document.querySelectorAll(".limit-note").forEach(el=>el.textContent=limitNoteText());
        renderPlanCard();
      }
    }).catch(()=>{}).finally(()=>{usageLoading=false;});
  }
}
/* Upgrade picker: monthly/yearly toggle + the four plans. Rendered inside the
   Dashboard plan card (no new tab). Paid options call startCheckout(planKey);
   Business has no PayPal plan — it is a mailto to sales. Free is shown as the
   current plan for free users. */
let upgradePickerOpen = false, upgradeBilling = "monthly", promoCodeVal = "";
function planPickerHtml(){
  const toggle = '<div class="row" role="group" aria-label="Billing period"><button class="btn small' + (upgradeBilling==="monthly"?"":" secondary") + '" data-billing="monthly">Monthly</button><button class="btn small' + (upgradeBilling==="yearly"?"":" secondary") + '" data-billing="yearly">Yearly — save up to $58</button></div>';
  /* LAUNCH25: 25% off the first year on yearly plans only. The discount is
     applied server-side at checkout; this only changes the displayed price. */
  const promoOn = promoCodeVal.trim().toUpperCase()==="LAUNCH25";
  const money = v => "$" + (Number.isInteger(v) ? v : v.toFixed(2));
  const price = (m, y, py) => upgradeBilling==="yearly" ? money(promoOn ? py : y) + "/year" : money(m) + "/month";
  const save = (m, y, py) => upgradeBilling==="yearly" ? " (save " + money(m*12 - (promoOn ? py : y)) + (promoOn ? " first year" : "") + ")" : "";
  const promoRow = '<div class="row"><label>Promo code <input id="promoCode" type="text" placeholder="LAUNCH25" autocomplete="off" autocapitalize="characters" spellcheck="false" value="' + esc(promoCodeVal) + '"></label><span class="muted">LAUNCH25 — 25% off your first year on yearly plans.</span></div>';
  const opt = (key, name, priceText, desc, cta, disabled) =>
    '<div class="listing"><b>' + name + '</b> — <span class="price">' + priceText + '</span><br><span class="muted">' + desc + '</span><br>'
    + (disabled ? '<button class="btn small secondary" disabled>Current plan</button>'
      : '<button class="btn small" data-checkout="' + key + '">' + cta + '</button>') + '</div>';
  return '<h3>Choose a plan</h3>' + toggle + promoRow
    + opt("free", "Free", "$0", "5 audits/mo · 10 keywords · 5 link checks/mo · 3 briefs/mo · 3 compares/mo · 10 tool checks/mo · 5 AI messages/day · 1 site.", "", currentPlan==="free")
    + opt(upgradeBilling==="yearly"?"pro-yearly":"pro-monthly", "Pro", price(9,90,67.50) + save(9,90,67.50), "Everything unlimited, unlimited AI messages · 3 sites.", "Upgrade to Pro — " + price(9,90,67.50), currentPlan==="pro")
    + opt(upgradeBilling==="yearly"?"agency-yearly":"agency-monthly", "Agency", price(29,290,217.50) + save(29,290,217.50), "Everything in Pro · 10 sites · featured marketplace listings · priority email support.", "Upgrade to Agency — " + price(29,290,217.50), currentPlan==="agency")
    + '<div class="listing"><b>Business</b> — <span class="price">Custom</span><br><span class="muted">Everything in Agency · up to 50 sites · custom limits · dedicated support · custom integrations · volume pricing.</span><br><a class="btn small secondary" href="mailto:contact@syedsenterprises.org?subject=SEOForge%20Business%20plan">Talk to sales</a></div>'
    + '<p class="muted">Payments are handled by PayPal — you can cancel anytime from PayPal. Business plans are set up by the owner after you talk to sales.</p>';
}
function renderPlanCard(){
  const el = $("planCard"); if(!el) return;
  if(!currentUser){
    el.innerHTML = '<h2>Your plan</h2><p class="muted">You are using SEOForge in this browser only (local mode). <b>Sign in</b> to save your audits, keywords and revenue to your account — free. Pro is $9/month for unlimited use.</p><button class="btn secondary" data-action="upgrade">See plans — from $9/month</button>';
    return;
  }
  const u = usageThisMonth();
  const v = v25Usage();
  if(isAdmin()){
    el.innerHTML = '<h2>Your plan — Admin</h2><p>Signed in as ' + esc(currentUser.email) + '.</p><p><b>Admin — unlimited, no restrictions.</b> No limits on audits, keywords, link checks, briefs, compares or tool checks.</p>';
  }else if(currentPlan === 'pro'){
    el.innerHTML = '<h2>Your plan — Pro</h2><p><b>Pro is active.</b> Signed in as ' + esc(currentUser.email) + '. Unlimited audits, keywords, link checks, briefs, compares, tool checks and AI messages · 3 sites.</p><button class="btn secondary" data-action="upgrade">See Agency — $29/month</button>';
  }else if(currentPlan === 'agency'){
    el.innerHTML = '<h2>Your plan — Agency</h2><p><b>Agency is active.</b> Signed in as ' + esc(currentUser.email) + '. Everything in Pro · 10 sites · featured marketplace listings · priority email support.</p>';
  }else if(currentPlan === 'business'){
    el.innerHTML = '<h2>Your plan — Business</h2><p><b>Business is active.</b> Signed in as ' + esc(currentUser.email) + '. Everything in Agency · up to 50 sites · custom limits · dedicated support · custom integrations.</p>';
  }else{
    el.innerHTML = '<h2>Your plan — Free</h2><p>Signed in as ' + esc(currentUser.email) + '.</p>'
      + '<p class="muted">This month: ' + u.auditsUsed + ' of ' + PLAN_LIMITS.auditsPerMonth + ' audits used · ' + u.linksUsed + ' of ' + PLAN_LIMITS.linkChecksPerMonth + ' link checks used · ' + u.keywordsUsed + ' of ' + PLAN_LIMITS.keywordsTotal + ' keywords tracked · ' + v.briefsUsed + ' of ' + PLAN_LIMITS.briefsPerMonth + ' briefs used · ' + v.comparesUsed + ' of ' + PLAN_LIMITS.comparesPerMonth + ' compares used · ' + v.toolChecksUsed + ' of ' + PLAN_LIMITS.toolChecksPerMonth + ' tool checks used · 1 site · ' + PLAN_LIMITS.aiMessagesPerDay + ' AI messages a day.</p>'
      + '<button class="btn" data-action="upgrade">See plans — from $9/month</button>';
  }
  if(upgradePickerOpen && currentUser && !isAdmin()){
    el.innerHTML += planPickerHtml();
    el.querySelectorAll("[data-billing]").forEach(b => b.addEventListener("click", () => { upgradeBilling = b.dataset.billing; renderPlanCard(); }));
    el.querySelectorAll("[data-checkout]").forEach(b => b.addEventListener("click", () => startCheckout(b.dataset.checkout)));
    const pi = el.querySelector("#promoCode");
    if(pi) pi.addEventListener("change", () => { promoCodeVal = pi.value; renderPlanCard(); });
  }
}
/* The upgrade entry point (header button, plan card, limit prompts): opens the
   plan picker in the Dashboard plan card. No network call happens here — the
   checkout itself is startCheckout(), which the picker calls per plan. */
function goUpgrade(){
  if(!currentUser){ focusAuth(); showAuthMsg("Sign in before upgrading."); return; }
  if(isAdmin()) return;
  upgradePickerOpen = true;
  showTab("dashboard", true);
  renderPlanCard();
  try{ window.scrollTo({top:0, behavior:"smooth"}); }catch(e){}
}
/* One paid plan checkout: creates the PayPal approval URL for the chosen
   plan key ("pro-monthly" | "pro-yearly" | "agency-monthly" | "agency-yearly")
   and hands the user to PayPal. The plan is applied server-side only, after
   PayPal confirms — never from this page. A promo code typed in the picker
   is sent along and validated server-side; an invalid code stops checkout. */
async function startCheckout(planKey){
  const token = await supabaseAccessToken();
  if(!token){ focusAuth(); showAuthMsg("Sign in before upgrading."); return; }
  const promo = (document.getElementById("promoCode")?.value || "").trim();
  try{
    const res = await fetchJsonTimeout(SUPABASE_URL+"/functions/v1/billing", 20000, {method:"POST",headers:{"Content-Type":"application/json", apikey:SUPABASE_PUBLISHABLE_KEY, Authorization:"Bearer "+token}, body:JSON.stringify({action:"checkout", plan:planKey, promo})});
    const data = await res.json().catch(()=>({}));
    if(!res.ok || !data.url) throw new Error(data.error || "Checkout could not be started.");
    const url = new URL(data.url);
    if(url.protocol !== "https:" || !["www.paypal.com","www.sandbox.paypal.com"].includes(url.hostname)) throw new Error("Invalid checkout destination");
    window.location.href = url.href;
  }catch(e){ showBanner("Could not start checkout: " + e.message, "warn"); }
}

/* ---------- fetch helpers (honest errors, proxy fallback) ---------- */
function fetchTimeout(url, ms, scope){
  const c = new AbortController();
  const set = scope || activeRequests;
  set.add(c);
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, {signal:c.signal}).finally(() => { clearTimeout(t); set.delete(c); });
}
const PROXIES = [
  u => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
  u => "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(u)
];
function isProxyErrorPage(status, text){
  if(status===522 || status===408) return true;
  if(status===500 && /internal server error|error code/i.test((text||"").slice(0,400))) return true;
  return false;
}
/* Fetch any URL through our own server-side proxy first, then free public proxies.
   Returns {status, text} plus, when our proxy served it, {ttfbMs, totalMs, bytes, headers}
   (timings the free proxies cannot provide). Status codes from a proxy usually mirror
   the target; 500/522/408 are proxy failures, not proof the site is down. */
async function fetchViaProxy(url, timeoutMs, scope){
  let lastErr = null;
  /* Own server-side proxy first (reliable); free public proxies as fallback. */
  try{
    const res = await fetchJsonTimeout(SUPABASE_URL+"/functions/v1/fetch-proxy", timeoutMs||15000, {method:"POST",headers:{"Content-Type":"application/json",apikey:SUPABASE_PUBLISHABLE_KEY,Authorization:"Bearer "+SUPABASE_PUBLISHABLE_KEY},body:JSON.stringify({url})}, scope);
    const data = await res.json().catch(()=>({}));
    /* A 403/429 from OUR edge proxy means the TARGET blocked the Supabase
       datacenter IP — not that the page is down. Fall through to the free
       public proxies (different IPs, may get through) before giving up. Any
       other edge result is returned as-is; only a real failure reaches the
       fallbacks. (202 handling for DuckDuckGo is untouched — the Bing-first
       SERP switch covers that separately.) */
    if(res.ok && typeof data.text === "string" && data.status !== 403 && data.status !== 429) return {status:data.status||200, ok:!!data.ok, text:data.text, ttfbMs:data.ttfbMs, totalMs:data.totalMs, bytes:data.bytes, compressed:data.compressed, headers:data.headers||null};
    lastErr = new Error(data.error||("Proxy error (HTTP "+res.status+")"));
    if(data.status === 403 || data.status === 429) lastErr = new Error("Page fetch failed (HTTP " + data.status + ") — the site blocked our server. Trying another route…");
  }catch(e){ lastErr = e; }
  for(const p of PROXIES){
    try{
      const res = await fetchTimeout(p(url), timeoutMs||15000, scope);
      const text = await res.text();
      if(isProxyErrorPage(res.status, text)){ lastErr = new Error("Proxy error (HTTP "+res.status+" from the free proxy — the target site may still be fine)"); continue; }
      return { status: res.status, ok: res.ok, text };
    }catch(e){ lastErr = e; }
  }
  throw lastErr || new Error("All free proxies failed — retry later");
}

/* ---------- Dashboard ---------- */
/* ---------- Dashboard: a true overview, real numbers only ---------- */
/* Inline-SVG sparkline (no library): values 0–100, one polyline. Pure, so it
   is unit testable. Returns "" for fewer than two points. */
function sparklineSVG(values, w, h){
  const vals = (values||[]).filter(v => typeof v === "number" && !isNaN(v));
  if(vals.length < 2) return "";
  const W = w||220, H = h||48, pad = 3;
  const min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
  const span = (max - min) || 1;
  const pts = vals.map((v,i) => ((pad + i*(W-2*pad)/(vals.length-1)).toFixed(1) + "," + (H - pad - (v-min)/span*(H-2*pad)).toFixed(1))).join(" ");
  return '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Trend"><polyline points="' + pts + '" fill="none" style="stroke:var(--accent)" stroke-width="2"/></svg>';
}
/* Skeleton rows while a proxy fetch runs — a visible loading state, not just a
   dimmed button. Rendered into the results area and replaced by the first
   real render; the .prog text updates overwrite nothing here. */
function skeletonHtml(n){
  let bars = "";
  for(let i=0;i<(n||3);i++) bars += '<i style="width:' + (92 - i*12) + '%"></i>';
  return '<div class="skel" aria-hidden="true">' + bars + '</div>';
}
function renderDashboard(){
  /* Cloud mode before the account data has loaded (or after a failed load):
     the cache holds the empty reset — show "—", never genuine-looking zeros.
     Local/guest mode reads localStorage, which is always present. */
  if(S.mode === "cloud" && !cloudDataLoaded){
    ["stAudits","stKeywords","stLinks","stRevenue","stOrders"].forEach(id => { const el = $(id); if(el) el.textContent = "—"; });
    const dh = $("dashHealth");
    if(dh) dh.innerHTML = '<p class="muted">' + (cloudDataFailed ? "Account data could not load — reload to retry. Nothing below is a real zero yet." : "Loading your account data…") + '</p>';
    return;
  }
  const audits = S.get("audits", []);
  const kws = S.get("keywords", []);
  const links = S.get("links", []);
  const rev = S.get("revenue", []);
  $("stAudits").textContent = audits.length;
  $("stKeywords").textContent = kws.length;
  /* "Links verified" counts LINKS, not Link Verifier runs: one saved check can
     hold dozens of links (grouped rows carry .count). The stat shows the real
     link total, with the check count in the title — the old code showed the
     observation count, so one 42-link check read as "1 links verified". */
  const linkTotal = links.reduce((a,g)=>a+((g&&g.count)||0),0);
  /* The check count is visible, not tooltip-only: "42 links · 1 check". */
  $("stLinks").textContent = linkTotal + " · " + links.length + " check" + (links.length===1?"":"s");
  const stLinksStat = $("stLinksStat");
  if(stLinksStat) stLinksStat.title = links.length + " link check(s) — " + linkTotal + " links found";
  $("stRevenue").textContent = "$" + rev.reduce((a,r)=>a+(+r.amount||0),0).toFixed(2);
  $("stOrders").textContent = S.get("orders", []).length;
  $("dashStoreNote").textContent = currentUser
    ? "Totals are computed from your SEOForge account (stored in Supabase, visible only to you)."
    : "Totals are computed from what is saved in this browser only (localStorage). Saved data stays in this browser; live tools send your queries to external providers.";
  /* Site health from the latest audit — real numbers only, empty state names
     the one next action. */
  const dh = $("dashHealth");
  if(dh){
    const last = audits[0];
    if(!last) dh.innerHTML = '<p class="muted">No audits yet — <b>run your first audit</b> to see your site health here.</p>';
    else dh.innerHTML = '<p><b>' + esc(last.url||"") + '</b> <span class="muted">— ' + fmtDate(last.date) + '</span><br>'
      + (last.psi!=null ? 'PageSpeed <b>' + last.psi + '/100</b>' : 'PageSpeed not scored')
      + (last.ok!=null ? ' · <b>' + last.ok + '</b> of ' + last.total + ' URLs reachable' : '') + '</p>';
  }
  const ds = $("dashSpark");
  if(ds){
    const withPsi = audits.filter(a => a.psi!=null).slice(0,10).reverse();
    ds.innerHTML = withPsi.length >= 2
      ? sparklineSVG(withPsi.map(a => a.psi)) + '<p class="muted">PageSpeed trend — last ' + withPsi.length + ' scored audits.</p>'
      : '<p class="muted">Run two or more audits to see a PageSpeed trend.</p>';
  }
  /* Top tracked keywords with their last position. */
  const dk = $("dashKeywords");
  if(dk){
    if(!kws.length) dk.innerHTML = '<p class="muted">No keywords tracked yet — <b>add a keyword</b> in the Rank Tracker.</p>';
    else dk.innerHTML = '<ul>' + kws.slice(0,5).map(k => {
      const c = k.checks||[];
      const last = c.length ? c[c.length-1] : null;
      return '<li><b>' + esc(k.keyword) + '</b> — ' + (last ? (last.position ? 'last position #' + last.position + ' (' + fmtDate(last.date) + ')' : 'not in top results (' + fmtDate(last.date) + ')') : 'never checked') + '</li>';
    }).join("") + '</ul>';
  }
  /* Revenue this month. */
  const dr = $("dashRevenue");
  if(dr){
    const m = thisMonthPrefix();
    const thisMonth = rev.filter(e => (e.date||"").indexOf(m)===0);
    const t = thisMonth.reduce((a,e)=>a+(+e.amount||0),0);
    dr.innerHTML = t > 0
      ? '<p><b>$' + t.toFixed(2) + '</b> logged this month across ' + thisMonth.length + ' entries.</p>'
      : '<p class="muted">No revenue logged this month — <b>log ad revenue</b> to track it here.</p>';
  }
  /* Recent activity: latest audits + tool checks, newest first. */
  const da = $("dashActivity");
  if(da){
    const acts = [];
    audits.slice(0,3).forEach(a => acts.push({d:a.date, t:"Audit: " + (a.url||"") + (a.psi!=null ? " — PageSpeed " + a.psi + "/100" : "")}));
    S.get("toolChecks", []).slice(0,3).forEach(t => acts.push({d:t.date, t:"Check (" + t.type + "): " + (t.url||"")}));
    acts.sort((a,b) => (b.d||"").localeCompare(a.d||""));
    da.innerHTML = acts.length
      ? '<ul>' + acts.slice(0,5).map(a => '<li><span class="muted">' + fmtDate(a.d) + ' — </span>' + esc(a.t) + '</li>').join("") + '</ul>'
      : '<p class="muted">Nothing yet — your latest audits and checks will appear here.</p>';
  }
  /* Top opportunities / next actions: one clear step per gap, never invented. */
  const op = $("dashOpps");
  if(op){
    const items = [];
    if(!audits.length) items.push({goto:"audit", label:"Run your first audit"});
    if(!currentUser) items.push({goto:"preferences", label:"Sign in to save your work to your account"});
    else if(!googleConnected) items.push({goto:"gsc", label:"Connect Google for Search Console data"});
    if(!kws.length) items.push({goto:"rank", label:"Add a keyword to track"});
    if(!links.length) items.push({goto:"links", label:"Verify a paid link"});
    if(!items.length) items.push({goto:"audit", label:"Run a fresh audit to keep scores current"});
    op.innerHTML = '<div class="row">' + items.slice(0,3).map(i => '<button class="btn secondary" data-goto="' + i.goto + '">' + esc(i.label) + '</button>').join("") + '</div>';
    op.querySelectorAll("[data-goto]").forEach(b => b.addEventListener("click", () => showTab(b.dataset.goto, true)));
  }
  renderDashboardExtras();
}

/* ---------- Site Audit ---------- */
const normaliseSite = SEOForgeCore.normaliseSite;
/* Overall audit deadline (120 s) + cancel: the sitemap crawl used to run
   unbounded (up to ~6 min on 50 slow URLs) with no way to stop it. */
const AUDIT_DEADLINE_MS = 120000;
let auditCancelled = false;
document.addEventListener("click", e => {
  const t = e.target.closest('[data-action="cancel-audit"]');
  if(t){ e.preventDefault(); auditCancelled = true; cancelAuditRequests(); const p = $("auditProg"); if(p) p.textContent = "Cancelling…"; }
});

async function runAudit(psiOnly){
  const btn = $("auditBtn"), psiBtn = $("psiBtn");
  auditCancelled = false;
  btn.disabled = true; psiBtn.disabled = true;
  const out = $("auditOut"), prog = $("auditProg");
  out.innerHTML = ""; prog.textContent = "";
  const site = normaliseSite($("auditUrl").value);
  if(!site){ out.innerHTML = '<div class="err">Enter a site URL first.</div>'; btn.disabled=false; psiBtn.disabled=false; return; }
  /* Remember the last-run URL (guest-safe localStorage) so a reload keeps
     the field filled while the completed audit stays in history. */
  try{ LS.set("lastAuditUrl", site); }catch(e){}
  /* Free-plan limit: 5 audits per calendar month (cloud counts only). */
  if(planLimitApplies()){
    const used = usageThisMonth().auditsUsed;
    if(used >= PLAN_LIMITS.auditsPerMonth){
      out.innerHTML = '<div class="warn"><b>Free plan limit reached.</b> You have used ' + used + ' of ' + PLAN_LIMITS.auditsPerMonth + ' site audits this month. <button class="btn small" data-action="upgrade">Upgrade to Pro — $9/month</button> for unlimited audits.</div>';
      btn.disabled=false; psiBtn.disabled=false; return;
    }
  }
  const strategy = $("psiStrategy").value;
  const limit = Math.max(5, Math.min(50, parseInt($("auditLimit").value||"50",10)));
  const started = Date.now();
  /* One deadline for the WHOLE run (F13): crawl + Speed Score + PageSpeed
     share a single 120 s budget measured from run start — the old code
     measured 120 s for the crawl only, so a full audit could run ~260 s. */
  const deadline = started + AUDIT_DEADLINE_MS;
  /* Run-scoped cancellation (F3/F4): this run's requests register in their
     own set; Cancel aborts only them. */
  auditRunScope = new Set();
  const scope = auditRunScope;
  /* Speed Score of the full audit (null in PageSpeed-only mode) — carried
     into lastAudit so the share card leads with the stable measurement. */
  let sfScore = null, sfGrade = null;
  out.innerHTML = skeletonHtml(3);
  /* The Cancel button lives in #auditCancelWrap, OUTSIDE #auditOut: the
     crawl render used to replace out.innerHTML and delete the button, so
     there was no Cancel for the Speed Score + PageSpeed tail (F3). */
  const cancelWrap = $("auditCancelWrap");
  if(cancelWrap) cancelWrap.innerHTML = '<p><button class="btn secondary" data-action="cancel-audit">Cancel audit</button></p>';
  try{
    let urls = [], sitemapNote = "";
    if(!psiOnly){
      const sitemapUrl = /\.xml(\?|$)/i.test(site) ? site : site + "/sitemap.xml";
      prog.textContent = "Fetching sitemap: " + sitemapUrl + " …";
      const sm = await fetchViaProxy(sitemapUrl, 20000, scope);
      if(sm.status === 404){ throw new Error("Sitemap not found at " + sitemapUrl + " (HTTP 404). Check the URL — some sites use a different sitemap path."); }
      if(!sm.ok){ throw new Error("Sitemap fetch failed (HTTP " + sm.status + "). The free proxy may be having trouble — retry, or paste the sitemap URL directly."); }
      const doc = new DOMParser().parseFromString(sm.text, "application/xml");
      urls = [...doc.querySelectorAll("url > loc")].map(n => n.textContent.trim()).filter(Boolean);
      if(!urls.length){
        const idx = [...doc.querySelectorAll("sitemap > loc")].map(n => n.textContent.trim()).filter(Boolean);
        if(idx.length){
          sitemapNote = "This is a sitemap index with " + idx.length + " child sitemaps. Checking the first one: " + esc(idx[0]);
          prog.textContent = "Sitemap index found — fetching first child sitemap …";
          const child = await fetchViaProxy(idx[0], 20000, scope);
          /* Same status check as the parent fetch above: a 404/error page
             must never be parsed as a sitemap. */
          if(child.status === 404 || !child.ok) throw new Error("Child sitemap fetch failed (HTTP " + child.status + "). The sitemap index points at a child that could not be fetched.");
          const cdoc = new DOMParser().parseFromString(child.text, "application/xml");
          /* Validate the parsed document: an HTML error/placeholder page
             parses as XML with a <parsererror> (or a non-sitemap root), and
             its <loc>-shaped markup would otherwise be audited as real URLs. */
          if(cdoc.querySelector("parsererror") || !cdoc.documentElement || !/^(urlset|sitemapindex)$/i.test(cdoc.documentElement.tagName || "")) throw new Error("Child sitemap did not return a valid sitemap — the page fetched is not a sitemap (it may be an error page).");
          urls = [...cdoc.querySelectorAll("url > loc")].map(n => n.textContent.trim()).filter(Boolean);
        }
      }
      if(!urls.length){ throw new Error("No URLs found in the sitemap. It may be empty, or in a format this parser does not read."); }
      urls = urls.slice(0, limit);
      prog.textContent = "Sitemap OK — " + urls.length + " URLs found. Checking each one (in batches) …";
      // status-check in batches of 5, bounded by the overall deadline
      const results = new Array(urls.length);
      const BATCH = 5;
      let checkedN = 0, stoppedEarly = false;
      for(let i=0;i<urls.length && !auditCancelled && Date.now()<deadline;i+=BATCH){
        const slice = urls.slice(i, i+BATCH);
        await Promise.all(slice.map(async (u, j) => {
          try{
            const r = await fetchViaProxy(u, 12000, scope);
            results[i+j] = { url:u, status:r.status, ok:r.ok };
          }catch(e){ results[i+j] = { url:u, status:null, ok:false, err:String(e.message||e) }; }
        }));
        checkedN = Math.min(i+BATCH, urls.length);
        prog.textContent = "Checked " + checkedN + " of " + urls.length + " URLs …";
      }
      stoppedEarly = checkedN < urls.length;
      const stopNote = stoppedEarly
        ? (auditCancelled
          ? "Audit cancelled — " + checkedN + " of " + urls.length + " URLs checked. The results below are partial."
          : "Stopped after 120 s — " + checkedN + " of " + urls.length + " URLs checked. The results below are partial; re-run with a smaller URL limit to cover the rest.")
        : "";
      const done = results.slice(0, checkedN);
      const okN = done.filter(r=>r.ok).length;
      const failN = done.length - okN;
      let rows = done.map(r => {
        const pill = r.ok ? '<span class="pill ok">OK ' + r.status + '</span>'
          : (r.status ? '<span class="pill bad">HTTP ' + r.status + '</span>' : '<span class="pill warn">Proxy error</span>');
        return "<tr><td>" + esc(r.url) + "</td><td>" + pill + "</td><td class='muted'>" + (r.ok ? "" : esc(r.err||"")) + "</td></tr>";
      }).join("");
      out.innerHTML = '<div class="card" style="margin-top:10px"><h3>Sitemap crawl — ' + checkedN + ' URLs</h3>'
        + (sitemapNote ? '<p class="muted">'+sitemapNote+'</p>' : '')
        + (stopNote ? '<p class="warn">' + esc(stopNote) + '</p>' : '')
        + '<p><span class="pill ok">' + okN + ' reachable</span> <span class="pill bad">' + failN + ' failed / proxy errors</span></p>'
        + measuredLine('each URL was fetched live through the server-side proxy; the status is the real HTTP status the page returned')
        + '<p class="muted">“Proxy error” means the free proxy could not fetch that URL — it does not prove the page is down. Retry if you see many of them.</p>'
        + '<div style="overflow-x:auto"><table><tr><th>URL</th><th>Status</th><th>Note</th></tr>' + rows + '</table></div></div>';
      const rec = { date:todayISO(), url:site, total:checkedN, ok:okN, failed:failN, psi:null, lcp:null, cls:null };
      /* A save failure (cloud insert error, or a full/disabled localStorage)
         must never erase a good result: warn and keep the table above. */
      try{
        if(S.mode==='cloud'){
          const id = await cloudInsertAudit(rec);
          if(id){ rec.id = id; } else { out.innerHTML += '<div class="warn">This audit ran, but saving it to your account failed — the result above is still valid.</div>'; }
          S.cache.audits = [rec].concat(S.cache.audits).slice(0,20);
        }else{
          LS.set("audits", [rec].concat(LS.get("audits", [])).slice(0,20));
        }
      }catch(e){
        out.innerHTML += '<div class="warn">This audit ran, but saving it failed — the result above is still valid.</div>';
      }
      /* Deadline / cancel: stop here with the partial results above — no
         Speed Score or PageSpeed phase after the overall deadline. */
      if(stoppedEarly){ prog.textContent = "Stopped — partial results above."; return; }
      // SEOForge Speed Score (our own measurement) — runs even when PageSpeed quota is out.
      // Kept in sfScore/sfGrade so the share card can lead with the stable
      // measurement instead of Google's run-to-run PageSpeed number.
      if(auditCancelled || Date.now() >= deadline){ prog.textContent = auditCancelled ? "Cancelled — partial results above." : "Stopped at the 120 s overall deadline — partial results above."; return; }
      prog.textContent = "Measuring SEOForge Speed Score…";
      try{
        const sf = seoforgeSpeedScore(await fetchPageDoc(site, 20000, scope));
        sfScore = sf.score; sfGrade = sf.grade;
        out.innerHTML += speedScoreHtml(sf);
      }catch(e){ if(auditCancelled) return; out.innerHTML += '<div class="muted">SEOForge Speed Score could not be measured — ' + esc(e.message||e) + '</div>'; }
    }
    // PageSpeed — still inside the same overall deadline (F13).
    if(auditCancelled || Date.now() >= deadline){ prog.textContent = auditCancelled ? "Cancelled — partial results above." : "Stopped at the 120 s overall deadline — partial results above."; return; }
    prog.textContent = "Running PageSpeed Insights (" + strategy + ") — this can take up to a minute …";
    const psi = await runPSI(site, strategy, scope);
    if(psiOnly) out.innerHTML = "";
    out.innerHTML += psiHtml(psi, site, strategy);
    lastAudit = { site, score: psi.score, sfScore, sfGrade, lcp: psi.lcp, cls: psi.cls, date: todayISO(), time: runClockTime() };
    out.innerHTML += shareBarHtml(lastAudit);
    prog.textContent = "Done in " + Math.round((Date.now()-started)/1000) + "s.";
    const audits = S.get("audits", []);
    if(audits.length && audits[0].url===site && audits[0].date===todayISO()){
      audits[0].psi = psi.score; audits[0].lcp = psi.lcp; audits[0].cls = psi.cls;
      if(S.mode==='cloud' && audits[0].id){
        const { error } = await sb.from("audits").update({ score:psi.score, lcp:numOrNull(psi.lcp), cls:numOrNull(psi.cls) }).eq("id", audits[0].id);
        if(error) console.error("audit PSI update failed", error);
      }else{
        LS.set("audits", audits);
      }
    }
    renderLimitNotes();
  }catch(e){
    if(auditCancelled){
      /* A cancel is not a failure: keep whatever partial results rendered
         and say so plainly, instead of stamping "Check failed" on them. */
      prog.textContent = "Cancelled — partial results above.";
      out.innerHTML += '<div class="muted">Audit cancelled — the results above are partial.</div>';
    }else{
      out.innerHTML += '<div class="err"><b>Check failed:</b> ' + esc(e.message||e) + '</div>';
      prog.textContent = "";
    }
  }finally{
    btn.disabled = false; psiBtn.disabled = false;
    const w = $("auditCancelWrap"); if(w) w.innerHTML = "";
    auditRunScope = null;
    renderAuditHistory();
  }
}
/* PageSpeed routing (v2.10.0): a customer with no key used to hit Google's
   shared no-key quota (429) and get an error instead of a report. Now the
   default route is the server-side `pagespeed` edge function, which calls the
   API with a key kept in Supabase (PAGE_SPEED_API_KEY) — the customer needs
   no key at all. A personal key in Workspace settings still works as an
   override (direct client-side call). If the edge function is not deployed
   yet, or the server key is not set, the code falls back to the direct
   no-key call with its honest quota message — a score is never faked. */
const PAGESPEED_FN = SUPABASE_URL + "/functions/v1/pagespeed";
function pagespeedRoute(){
  const key = (LS.get("settings", {}).psiKey||"").trim();
  return key ? { via:"direct", key } : { via:"edge" };
}
async function runPSI(url, strategy, scope, timeoutMs){
  /* timeoutMs defaults to the usual 120 s; the Redirects tool passes the
     time left on its 60 s overall cap (F15), so that leg can never push the
     tool past the cap. */
  timeoutMs = timeoutMs || 120000;
  if(auditCancelled) throw new Error("Audit cancelled");
  const route = pagespeedRoute();
  if(route.via === "direct") return runPSIDirect(url, strategy, route.key, scope, timeoutMs);
  try{
    const res = await fetchJsonTimeout(PAGESPEED_FN, timeoutMs, {method:"POST", headers:{"Content-Type":"application/json", apikey:SUPABASE_PUBLISHABLE_KEY, Authorization:"Bearer "+SUPABASE_PUBLISHABLE_KEY}, body:JSON.stringify({url, strategy})}, scope);
    const data = await res.json().catch(()=>({}));
    if(res.ok) return { score:data.score, lcp:data.lcp||null, cls:data.cls||null, seo:data.seo||[], finalUrl:data.finalUrl||url };
    /* 404 = function not deployed yet; 400 + "not configured" = the server
       key is not set. Both fall back to the direct no-key call below. Any
       other edge error (e.g. Google's quota on the server key) is real and
       is surfaced as-is — never silently replaced with a different number. */
    if(res.status===404 || res.status===501 || (res.status===400 && /not configured/i.test(data.error||""))){
      /* fall through to the direct call */
    }else{
      throw new Error(data.error || ("PageSpeed service error (HTTP " + res.status + ")"));
    }
  }catch(e){
    /* A cancel abort must never fall through to the direct call (that
       re-ran the whole 120 s PageSpeed leg after the user cancelled). */
    if(auditCancelled) throw new Error("Audit cancelled");
    /* Network-level failure reaching the edge function also falls back. A
       deliberate throw above (real edge error) is re-thrown, not swallowed:
       its message never matches the network patterns. */
    if(e.message && !/Failed to fetch|NetworkError|timed out|abort|Load failed/i.test(e.message)) throw e;
  }
  return runPSIDirect(url, strategy, "", scope, timeoutMs);
}
async function runPSIDirect(url, strategy, key, scope, timeoutMs){
  timeoutMs = timeoutMs || 120000;
  /* Ask for the SEO category explicitly: without a category parameter the
     PageSpeed API runs Performance only, so the "SEO checks" section was
     always empty. The edge function needs the same two parameters (reported
     separately — that file is deploy-only in this round). */
  let api = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=" + encodeURIComponent(url) + "&strategy=" + strategy + "&category=performance&category=seo";
  if(key) api += "&key=" + encodeURIComponent(key);
  let res;
  try{ res = await fetchTimeout(api, timeoutMs, scope); }
  catch(e){ throw new Error("PageSpeed request timed out after " + Math.round(timeoutMs/1000) + "s. Google's service may be slow — retry."); }
  let data = {};
  try{ data = await res.json(); }catch(e){ throw new Error("PageSpeed returned an unreadable response (HTTP " + res.status + ")."); }
  if(!res.ok){
    const msg = (data.error && data.error.message) || ("HTTP " + res.status);
    if(res.status===429) throw new Error("PageSpeed Insights quota exhausted (HTTP 429): " + msg + " The free no-key quota is shared and often runs out. Add a free API key in Workspace settings, or retry later.");
    throw new Error("PageSpeed Insights failed: " + msg);
  }
  const lr = data.lighthouseResult;
  if(!lr) throw new Error("PageSpeed returned no Lighthouse result for this URL.");
  const perf = lr.categories && lr.categories.performance ? lr.categories.performance.score : null;
  const audits = lr.audits || {};
  const lcp = audits["largest-contentful-paint"];
  const cls = audits["cumulative-layout-shift"];
  const seoRefs = (lr.categories && lr.categories.seo && lr.categories.seo.auditRefs) || [];
  const seoItems = seoRefs.map(r => {
    const a = audits[r.id]; if(!a) return null;
    return { title:a.title, score:a.score, display:a.displayValue||"" };
  }).filter(Boolean);
  return { score: perf==null?null:Math.round(perf*100), lcp:lcp?lcp.displayValue||"":null, cls:cls?cls.displayValue||"":null, seo:seoItems, finalUrl:lr.finalUrl||url };
}
/* Score ring (v2.11.0): an inline-SVG ring around the big number, same pattern
   as the sparkline — no library, no image. Pure, so it is unit testable. */
/* Trust: verification is built into every report, not claimed in copy.
   - measuredLine(text): "How this is measured" — source, method, when.
   - pagespeedVerifyUrl(url): Google's own PageSpeed tool for the same URL —
     our number comes from the same API, so it will match. The message is:
     don't trust us, check it.
   - psiDeltaFor(list, i): before/after — the PageSpeed change vs the previous
     audit of the same URL, so improvement is visible in the history. Pure,
     so it is unit testable. */
function runStamp(){ try{ return new Date().toLocaleString("en-GB", {day:"numeric", month:"short", hour:"2-digit", minute:"2-digit"}); }catch(e){ return ""; } }
/* Clock time of a run (HH:MM) — stamped next to a Google PageSpeed number so
   a shared score is never read as a stable badge: Google's score varies run
   to run, while our Speed Score is deterministic from the same page fetch. */
function runClockTime(){ try{ return new Date().toLocaleTimeString("en-GB", {hour:"2-digit", minute:"2-digit"}); }catch(e){ return ""; } }
function measuredLine(text){ return '<p class="muted">How this is measured: ' + text + ' — checked just now (' + runStamp() + ').</p>'; }
function pagespeedVerifyUrl(url){ return "https://pagespeed.web.dev/analysis?url=" + encodeURIComponent(url); }
function psiDeltaFor(list, i){
  const cur = list[i]; if(!cur || cur.psi==null) return null;
  for(let j=i+1;j<list.length;j++){
    const prev = list[j];
    if(prev && prev.url===cur.url && prev.psi!=null) return cur.psi - prev.psi;
  }
  return null;
}
function scoreRingSVG(score, size){
  const s = score==null ? null : Math.max(0, Math.min(100, Math.round(score)));
  const r = 34, c = 2*Math.PI*r;
  const frac = s==null ? 0 : s/100;
  /* Score bands keep their meaning (Excellent green, Needs work amber,
     Poor red) — except the Good band, which IS the accent: it was the
     hardcoded teal #0f766e, so it now follows the user's pick through
     --accent (inline style, so the ring re-themes live with no re-render).
     The track circle stays neutral; the number inherits currentColor. */
  const isAccentBand = s!=null && s>=70 && s<90;
  /* F1: a light accent's ring (stroke var(--accent)) is invisible on the
     white card — when the accent takes dark ink, the ring takes the darkened
     readable form instead. Purple/orange keep the plain accent stroke. */
  let ringVar = "var(--accent)";
  try{
    if(typeof getComputedStyle === "function" && typeof document !== "undefined" && document.documentElement){
      if(getComputedStyle(document.documentElement).getPropertyValue("--accent-on").trim() === "#111827") ringVar = "var(--accent-dark)";
    }
  }catch(e){}
  const color = s==null ? "#94a3b8" : s>=90 ? "#15803d" : s>=70 ? null : s>=50 ? "#b45309" : "#b91c1c";
  const sz = size||96;
  return '<svg width="'+sz+'" height="'+sz+'" viewBox="0 0 96 96" role="img" aria-label="Score '+(s==null?"not scored":s+" out of 100")+'"><circle cx="48" cy="48" r="'+r+'" fill="none" stroke="#e5e7eb" stroke-width="9"/><circle class="score-ring" cx="48" cy="48" r="'+r+'" fill="none" '+(isAccentBand ? 'style="stroke:'+ringVar+'"' : 'stroke="'+color+'"')+' stroke-width="9" stroke-linecap="round" stroke-dasharray="'+(c*frac).toFixed(1)+" "+c.toFixed(1)+'" transform="rotate(-90 48 48)"/><text x="48" y="52" text-anchor="middle" font-size="22" font-weight="800" fill="currentColor">'+(s==null?"—":s)+'</text><text x="48" y="68" text-anchor="middle" font-size="11" fill="currentColor">/ 100</text></svg>';
}
function psiHtml(psi, site, strategy){
  let seoRows = psi.seo.map(s => {
    const pill = s.score===1 ? '<span class="pill ok">Pass</span>' : (s.score===0 ? '<span class="pill bad">Fail</span>' : '<span class="pill info">Info</span>');
    return "<tr><td>" + esc(s.title) + "</td><td>" + pill + "</td><td class='muted'>" + esc(s.display) + "</td></tr>";
  }).join("");
  return '<div class="card" style="margin-top:10px"><h3>PageSpeed Insights — ' + esc(strategy) + '</h3>'
    + '<div class="score-flex">' + scoreRingSVG(psi.score) + '<div><p><b>PageSpeed performance</b></p>'
    + '<p>LCP: <b>' + esc(psi.lcp||"not reported") + '</b> &nbsp;·&nbsp; CLS: <b>' + esc(psi.cls||"not reported") + '</b> &nbsp;·&nbsp; Final URL: <span class="muted">' + esc(psi.finalUrl||site) + '</span></p></div></div>'
    + measuredLine('Google PageSpeed Insights — Google\u2019s API, not ours. <a href="' + esc(pagespeedVerifyUrl(site)) + '" target="_blank" rel="noopener">Verify it yourself on Google\u2019s own PageSpeed tool</a> — same API, so the score will match')
    + '<h3>SEO checks returned by PageSpeed</h3>'
    + (seoRows ? '<div style="overflow-x:auto"><table><tr><th>Check</th><th>Result</th><th>Detail</th></tr>' + seoRows + '</table></div>' : '<p class="muted">No SEO audit items returned.</p>')
    + '</div>';
}
function renderAuditHistory(){
  const list = S.get("audits", []);
  $("auditHistory").innerHTML = list.length ? list.map((a, idx) => {
    const statPills = (a.ok!=null)
      ? '<span class="pill ok">' + a.ok + ' OK</span> <span class="pill bad">' + a.failed + ' failed</span>'
      : '';
    const psiPill = (a.psi!=null ? ' <span class="pill info">PageSpeed ' + a.psi + '/100</span>' : '');
    /* Before/after proof: the PageSpeed change vs the previous audit of the
       SAME url. Fix the site, run it again, and the history shows the score
       moving — that is how effectiveness is proven, not claimed. */
    const d = psiDeltaFor(list, idx);
    const deltaPill = d==null ? '' : ' <span class="pill ' + (d>0?'ok':d<0?'bad':'info') + '">' + (d>0 ? '▲ +' + d + ' since last audit' : d<0 ? '▼ ' + d + ' since last audit' : '→ same as last audit') + '</span>';
    const lc = (a.lcp ? ' <span class="muted">LCP ' + esc(a.lcp) + (a.cls ? ' · CLS ' + esc(a.cls) : '') + '</span>' : '');
    /* The full URL is in the title attribute (hover reveals it) and long URLs
       wrap instead of being cut — the old render truncated them with no way
       to see the rest. */
    return '<div class="listing"><b title="' + esc(a.url) + '">' + esc(a.url) + '</b> <span class="muted">— ' + fmtDate(a.date) + '</span><br>'
      + statPills + psiPill + deltaPill + lc + '</div>';
  }).join("") : '<p class="muted">No audits yet. Run one above.</p>';
  renderAuditChart();
}
$("auditBtn").addEventListener("click", () => runAudit(false));
$("psiBtn").addEventListener("click", () => runAudit(true));

/* ---------- Keyword Explorer ---------- */
const KW_PREFIXES = ["how ","what ","best ","buy "," price"," near me"];
const kwDiffCache = {}; /* lowercase keyword -> difficulty score (this session) */
async function suggestOne(q){
  const api = "https://suggestqueries.google.com/complete/search?client=firefox&q=" + encodeURIComponent(q);
  try{
    const r = await fetchTimeout(api, 8000);
    if(r.ok){ const j = await r.json(); return j[1]||[]; }
  }catch(e){ /* CORS or network — fall through to proxy */ }
  const r = await fetchViaProxy(api, 12000);
  if(r.status && (r.status < 200 || r.status >= 300)) throw new Error("Google Suggest returned HTTP " + r.status + " — it may be blocking automated requests.");
  const j = JSON.parse(r.text);
  return j[1]||[];
}
async function runKeywords(){
  const btn = $("kwBtn"); btn.disabled = true;
  const out = $("kwOut"), prog = $("kwProg");
  out.innerHTML = ""; prog.textContent = "";
  const seed = ($("seedKw").value||"").trim();
  if(!seed){ out.innerHTML = '<div class="err">Enter a seed keyword first.</div>'; btn.disabled=false; return; }
  const queries = [seed]
    .concat(KW_PREFIXES.map(p => p.endsWith(" ") ? p + seed : seed + p))
    .concat("abcdefghijklmnopqrstuvwxyz".split("").map(ch => seed + " " + ch));
  const found = new Map();
  let done = 0, failed = 0;
  const POOL = 4;
  for(let i=0;i<queries.length;i+=POOL){
    await Promise.all(queries.slice(i, i+POOL).map(async q => {
      try{
        const list = await suggestOne(q);
        list.forEach(s => { const k = String(s).trim().toLowerCase(); if(k && !found.has(k)) found.set(k, String(s).trim()); });
      }catch(e){ failed++; }
      done++;
      prog.textContent = "Checked " + done + " of " + queries.length + " expansions — " + found.size + " suggestions so far …";
    }));
  }
  const items = [...found.values()].sort((a,b)=>a.localeCompare(b));
  prog.textContent = items.length + " unique suggestions from Google Suggest" + (failed ? " (" + failed + " expansions failed — free proxy trouble, not missing keywords)." : ".");
  if(!items.length){
    out.innerHTML = '<div class="err">No suggestions returned. Google Suggest or the free proxy may be unreachable right now — retry in a minute.</div>';
  }else{
    out.innerHTML = '<div class="note">Suggestions from Google — search volume is not available without a keyword API (not invented). Save any suggestion to the Rank Tracker to watch it.</div>'
      + '<table><tr><th>Suggestion</th><th></th></tr>' + items.map(s =>
        '<tr><td>' + esc(s) + '</td><td><button class="btn small secondary" data-save-kw="' + esc(s) + '">Save to tracker</button> <button class="btn small secondary" data-diff-kw="' + esc(s) + '">Difficulty</button></td></tr>').join("") + '</table>';
    out.querySelectorAll("[data-save-kw]").forEach(b => b.addEventListener("click", async () => {
      if(b.disabled) return;
      if(!checkKeywordLimit()) return;
      b.disabled = true; b.textContent = "Saving…";
      try{
        const res = await saveKeyword(b.dataset.saveKw, "", kwDiffCache[b.dataset.saveKw.toLowerCase()]);
        if(res === 'saved'){ b.textContent = "Saved ✓"; renderRankList(); renderDashboard(); renderLimitNotes(); }
        else if(res === 'duplicate'){ b.textContent = "Already tracked"; }
        else { b.textContent = "Save failed — retry"; b.disabled = false; }
      }catch(e){
        /* F8: a thrown save (full localStorage) used to leave the button
           reading "Save to tracker" in silence. */
        b.textContent = "Save failed — retry"; b.disabled = false;
      }
    }));
    out.querySelectorAll("[data-diff-kw]").forEach(b => b.addEventListener("click", async () => {
      b.disabled = true; b.textContent = "Checking…";
      try{
        const d = await estimateDifficulty(b.dataset.diffKw);
        kwDiffCache[b.dataset.diffKw.toLowerCase()] = d.score;
        b.textContent = "KD " + d.score + " · " + d.label;
        b.title = "Estimate from the live Bing top 10 — not a paid index";
      }catch(e){
        b.textContent = "Failed — retry"; b.disabled = false;
        try{ const n = b.parentElement ? b.parentElement.querySelector(".diff-note") : null; if(n) n.textContent = "Difficulty check failed: " + (e.message||e); else b.title = "Difficulty check failed: " + (e.message||e); }catch(err){}
      }
    }));
  }
  btn.disabled = false;
}
$("kwBtn").addEventListener("click", runKeywords);

/* ---------- Rank Tracker ---------- */
function checkKeywordLimit(){
  if(isAdmin() || S.mode!=='cloud' || isPaidPlan()) return true;
  const used = S.get("keywords", []).length;
  if(used >= PLAN_LIMITS.keywordsTotal){
    prependNote("rkList", "warn", "Free plan: you are tracking " + used + " of " + PLAN_LIMITS.keywordsTotal + " keywords. Upgrade to Pro ($9/month) for unlimited keywords.");
    return false;
  }
  return true;
}
async function saveKeyword(keyword, url, difficulty){
  const list = S.get("keywords", []);
  if(list.some(k => k.keyword.toLowerCase()===keyword.toLowerCase())) return 'duplicate';
  if(S.mode==='cloud'){
    const payload = { user_id:currentUser.id, keyword, url:url||"" };
    if(difficulty != null) payload.difficulty = difficulty;
    let { data, error } = await sb.from("keywords").upsert(payload, { onConflict: "user_id,keyword", ignoreDuplicates: true }).select("id");
    if(error && difficulty != null){
      /* The difficulty column may not exist yet — retry without it. */
      const r2 = await sb.from("keywords").upsert({ user_id:currentUser.id, keyword, url:url||"" }, { onConflict: "user_id,keyword", ignoreDuplicates: true }).select("id");
      data = r2.data; error = r2.error;
    }
    if(error){ console.error("keyword save failed", error); return 'error'; }
    if(!data || !data.length) return 'duplicate'; /* already tracked (unique constraint) */
    data = data[0];
    list.push({ id:data.id, keyword, url:url||"", checks:[], difficulty: (difficulty==null?null:difficulty) });
    return 'saved';
  }
  list.push({ keyword, url:url||"", checks:[], difficulty: (difficulty==null?null:difficulty) });
  LS.set("keywords", list);
  return 'saved';
}
$("rkAddBtn").addEventListener("click", async () => {
  /* Disabled for the whole save: a double-tap used to insert the keyword
     twice (both taps passed the duplicate check before either insert
     landed). The button text is the loading indicator. */
  const btn = $("rkAddBtn");
  btn.disabled = true; btn.textContent = "Saving…";
  try{
    const kw = ($("rkKw").value||"").trim(), url = ($("rkUrl").value||"").trim();
    if(!kw){ prependNote("rkList", "err", "Enter a keyword first."); return; }
    const list = S.get("keywords", []);
    if(list.some(k => k.keyword.toLowerCase()===kw.toLowerCase())){ prependNote("rkList", "err", "That keyword is already tracked."); return; }
    if(!checkKeywordLimit()) return;
    const res = await saveKeyword(kw, url);
    if(res !== 'saved'){ prependNote("rkList", "err", "Could not save that keyword — check your connection and retry."); return; }
    $("rkKw").value = ""; $("rkUrl").value = "";
    renderRankList(); renderDashboard(); renderLimitNotes();
  }catch(e){
    /* F8: LS.set throws on full/disabled storage — the old try/finally had
       no catch, so the click did nothing at all. Say so inline instead. */
    prependNote("rkList", "err", "Could not save that keyword — " + (e.message||e));
  }finally{
    btn.disabled = false; btn.textContent = "Add to tracker";
  }
});
function renderRankList(){
  const list = S.get("keywords", []);
  if(!list.length){ $("rkList").innerHTML = '<p class="muted">No keywords tracked yet. Add one above, or save suggestions from the Keyword Explorer.</p>'; return; }
  $("rkList").innerHTML = list.map((k, i) => {
    const last = k.checks.length ? k.checks[k.checks.length-1] : null;
    const hist = k.checks.slice(-5).reverse().map(c =>
      '<li>' + fmtDate(c.date) + ': ' + (c.position ? 'position ' + c.position : 'not in top results') + ' (Bing)</li>').join("");
    return '<div class="listing"><b>' + esc(k.keyword) + '</b> <span class="muted">→ ' + esc(k.url||"(no target URL set)") + '</span><br>'
      + (last ? '<span class="pill ' + (last.position ? 'ok' : 'warn') + '">Last: ' + (last.position ? '#' + last.position : 'not found') + ' · ' + fmtDate(last.date) + '</span> <span class="muted">Bing results, not Google</span>' : '<span class="pill info">Never checked</span> <span class="muted">Bing results, not Google</span>')
      + (k.difficulty!=null ? ' <span class="pill info">Difficulty ' + k.difficulty + '/100</span>' : '')
      + ' <button class="btn small" data-check="' + i + '">Check now</button>'
      + ' <span class="rank-check-note muted">' + (k.lastError ? 'Rank check failed: ' + esc(k.lastError) + ' — the search source may be blocked; retry later.' : '') + '</span>'
      + ' <button class="btn small secondary" data-diff="' + i + '">Difficulty</button>'
      + ' <button class="btn small danger" data-del-kw="' + i + '">Remove</button>'
      + (hist ? '<ul class="muted">' + hist + '</ul>' : '') + '</div>';
  }).join("");
  $("rkList").querySelectorAll("[data-check]").forEach(b => b.addEventListener("click", () => checkRank(+b.dataset.check, b)));
  $("rkList").querySelectorAll("[data-diff]").forEach(b => b.addEventListener("click", async () => {
    const item = S.get("keywords", [])[+b.dataset.diff]; if(!item) return;
    b.disabled = true; b.textContent = "Checking…";
    try{
      const d = await estimateDifficulty(item.keyword);
      item.difficulty = d.score;
      if(S.mode==='cloud' && item.id){
        const { error } = await sb.from("keywords").update({ difficulty: d.score }).eq("id", item.id);
        if(error) console.error("difficulty save failed (column may not exist yet)", error);
      }else{
        LS.set("keywords", S.get("keywords", []));
      }
      renderRankList(); renderDashboard();
    }catch(e){
      b.disabled = false; b.textContent = "Failed — retry";
      try{ const n = b.parentElement ? b.parentElement.querySelector(".diff-note") : null; if(n) n.textContent = "Difficulty check failed: " + (e.message||e); else b.title = "Difficulty check failed: " + (e.message||e); }catch(err){}
    }
  }));
  $("rkList").querySelectorAll("[data-del-kw]").forEach(b => b.addEventListener("click", async () => {
    const list2 = S.get("keywords", []);
    const item = list2[+b.dataset.delKw];
    if(S.mode==='cloud' && item && item.id){
      const { error } = await sb.from("keywords").delete().eq("id", item.id);
      if(error){ prependNote("rkList", "err", "Could not remove that keyword: " + error.message); return; }
    }
    list2.splice(+b.dataset.delKw, 1);
    if(S.mode==='local') LS.set("keywords", list2);
    renderRankList(); renderDashboard(); renderLimitNotes();
  }));
}
async function checkRank(idx, btn){
  const list = S.get("keywords", []);
  const item = list[idx]; if(!item) return;
  /* Inline failure (no alert): the button becomes "Failed — retry" and the
     reason appears in the .rank-check-note span next to it (rendered by
     renderRankList, so it survives re-renders for the rest of the session).
     The note is also set live at the start, so the row never sits silent
     while the search sources are being tried. */
  const rankNote = msg => {
    try{
      const note = btn.parentElement ? btn.parentElement.querySelector(".rank-check-note") : null;
      if(note) note.textContent = msg;
      else btn.title = msg;
    }catch(e){}
  };
  const failRank = msg => {
    btn.disabled = false; btn.textContent = "Failed — retry";
    item.lastError = msg;
    rankNote("Rank check failed: " + msg + " — the search source may be blocked; retry later.");
  };
  if(!item.url){ failRank("Set a target URL for this keyword first (edit it by removing and re-adding)."); return; }
  btn.disabled = true; btn.textContent = "Checking…";
  item.lastError = null;
  rankNote("Checking Bing results…");
  try{
    const target = normHost(new URL(item.url.startsWith("http")?item.url:"https://"+item.url).hostname);
    const results = await serpTopResults(item.keyword, 10, 15000);
    if(!results.length) throw new Error("Search results could not be parsed; the request may be blocked. No ranking was saved.");
    let position = null;
    for(let i=0;i<results.length;i++){
      let href = results[i].url;
      try{
        const host = normHost(new URL(href).hostname);
        if(host === target || host.endsWith("." + target)){ position = i+1; break; }
      }catch(e){ /* skip bad href */ }
    }
    if(S.mode==='cloud' && item.id){
      const { error } = await sb.from("rank_checks").insert({ user_id:currentUser.id, keyword_id:item.id, position, checked_at:new Date().toISOString() });
      if(error) throw new Error("Rank check could not be saved: " + error.message);
    }
    item.checks.push({ date: todayISO(), position });
    if(S.mode==='local') LS.set("keywords", list);
    renderRankList(); renderDashboard();
  }catch(e){
    failRank(e.message||e);
  }finally{
    /* Stuck-state guard: if neither the success render nor failRank ran
       (e.g. the render itself threw), never leave a disabled "Checking…". */
    if(btn.isConnected && btn.textContent === "Checking…"){ btn.disabled = false; btn.textContent = "Check now"; rankNote(""); }
  }
}

/* ---------- Link Verifier ---------- */
function classifyRel(rel){
  const r = (rel||"").toLowerCase();
  if(r.includes("sponsored")) return { label:"Sponsored", cls:"warn" };
  if(r.includes("nofollow")) return { label:"Nofollow", cls:"bad" };
  if(r.includes("ugc")) return { label:"UGC", cls:"warn" };
  return { label:"Dofollow", cls:"ok" };
}
async function runLinkVerify(){
  const checkedAt = new Date().toISOString();
  const btn = $("lvBtn"); btn.disabled = true;
  const out = $("lvOut"), prog = $("lvProg");
  out.innerHTML = ""; prog.textContent = "";
  const page = normaliseSite($("lvPage").value);
  const domain = normHost($("lvDomain").value);
  if(!page || !domain){ out.innerHTML = '<div class="err">Enter both the linking page URL and your domain.</div>'; btn.disabled=false; return; }
  /* Free-plan limit: 5 link verifications per calendar month (cloud counts only). */
  if(planLimitApplies()){
    const used = usageThisMonth().linksUsed;
    if(used >= PLAN_LIMITS.linkChecksPerMonth){
      out.innerHTML = '<div class="warn"><b>Free plan limit reached.</b> You have used ' + used + ' of ' + PLAN_LIMITS.linkChecksPerMonth + ' link verifications this month. <button class="btn small" data-action="upgrade">Upgrade to Pro — $9/month</button> for unlimited checks.</div>';
      btn.disabled=false; return;
    }
  }
  out.innerHTML = skeletonHtml(3);
  prog.textContent = "Fetching " + page + " …";
  try{
    const { text, status } = await fetchViaProxy(page, 20000);
    if(!status || status < 200 || status >= 300){ throw new Error("Page fetch failed (HTTP " + (status||"proxy error") + "). Check the URL and retry."); }
    const doc = new DOMParser().parseFromString(text, "text/html");
    const anchors = [...doc.querySelectorAll("a[href]")];
    const hits = [];
    anchors.forEach(a => {
      const href = a.getAttribute("href")||"";
      let host = "";
      try{ host = normHost(new URL(href, page).hostname); }catch(e){ return; }
      if(host === domain || host.endsWith("." + domain)){
        hits.push({ anchor:(a.textContent||"").trim().slice(0,120) || "(no anchor text)", href: href, rel:(a.getAttribute("rel")||"").toLowerCase() });
      }
    });
    prog.textContent = "";
    if(!hits.length){
      out.innerHTML = '<div class="warn"><b>No link found.</b> The page ' + esc(page) + ' contains no link to ' + esc(domain) + ' (checked ' + anchors.length + ' links on the page). The link may not exist, or the page may load links with JavaScript, which this checker cannot see.</div>';
      if(S.mode==='cloud'){
        const { error } = await sb.rpc("save_link_observation",{p_page:page,p_domain:domain,p_hits:[]});
        if(error){ out.innerHTML += '<div class="warn">Saving this check to your account failed: ' + esc(error.message) + '</div>'; }
        else{
          const saved = S.get("links", []);
          saved.unshift({ date:todayISO(), page, domain, count:0, types:"No link found" });
          S.cache.links = saved.slice(0,50);
        }
      }else{ LS.set("links",[{date:todayISO(),page,domain,count:0,types:"No link found"}].concat(LS.get("links",[])).slice(0,50)); }
      renderLinkHistory(); renderDashboard(); renderLimitNotes();
    }else{
      const rows = hits.map(h => {
        const c = classifyRel(h.rel);
        /* The destination is a real link to the live page — click it and see
           the link yourself. Relative hrefs resolve against the linking page. */
        let abs = null;
        try{ abs = new URL(h.href, page).toString(); }catch(e){}
        const linkCell = abs ? '<a href="' + esc(abs) + '" target="_blank" rel="noopener">' + esc(h.href) + '</a>' : esc(h.href);
        return "<tr><td>" + esc(h.anchor) + "</td><td>" + linkCell + "</td><td><span class='pill " + c.cls + "'>" + c.label + "</span><br><span class='muted'>rel=\"" + esc(h.rel||"(none)") + "\"</span></td></tr>";
      }).join("");
      out.innerHTML = '<div class="okbox"><b>' + hits.length + ' link' + (hits.length>1?"s":"") + ' to ' + esc(domain) + ' found</b> on <a href="' + esc(page) + '" target="_blank" rel="noopener">' + esc(page) + '</a>.</div>'
        + '<div style="overflow-x:auto"><table><tr><th>Anchor text</th><th>Link</th><th>Type</th></tr>' + rows + '</table></div>'
        + measuredLine('the live page was fetched — the table shows the real anchor text, the real destination and the real rel attribute from the page source. Click any link to open the live page yourself')
        + '<p class="muted">Paid/sponsored links should be rel="sponsored" (or nofollow). A paid link showing as Dofollow needs fixing.</p>';
      const types = [...new Set(hits.map(h => classifyRel(h.rel).label))].join(", ");
      if(S.mode==='cloud'){
        const { error } = await sb.rpc("save_link_observation",{p_page:page,p_domain:domain,p_hits:hits.map(h=>({anchor:h.anchor,rel:h.rel||null}))});
        if(error){ out.innerHTML += '<div class="warn">Saving this check to your account failed: ' + esc(error.message) + '</div>'; }
        else{
          const saved = S.get("links", []);
          saved.unshift({ date:todayISO(), page, domain, count:hits.length, types });
          S.cache.links = saved.slice(0,50);
        }
      }else{
        const saved = LS.get("links", []);
        saved.unshift({ date:todayISO(), page, domain, count:hits.length, types });
        LS.set("links", saved.slice(0,50));
      }
      renderLinkHistory(); renderDashboard(); renderLimitNotes();
    }
  }catch(e){
    out.innerHTML = '<div class="err"><b>Verification failed:</b> ' + esc(e.message||e) + '</div>';
    prog.textContent = "";
  }finally{ btn.disabled = false; }
}
function renderLinkHistory(){
  const list = S.get("links", []);
  $("lvHistory").innerHTML = list.length ? list.map(l =>
    '<div class="listing"><b>' + esc(l.domain) + '</b> on <a href="' + esc(l.page) + '" target="_blank" rel="noopener">' + esc(l.page) + '</a><br>'
    + '<span class="pill info">' + l.count + ' link(s): ' + esc(l.types) + '</span> <span class="muted">' + fmtDate(l.date) + '</span></div>').join("")
    : '<p class="muted">No verified links saved yet.</p>';
}
$("lvBtn").addEventListener("click", runLinkVerify);

/* ---------- Ad Revenue ---------- */
$("revDate").value = todayISO();
function renderRevenue(){
  const entries = S.get("revenue", []);
  const nets = ["Adsterra","Monetag","AdSense","Other"];
  const totals = {};
  nets.forEach(n => totals[n] = 0);
  entries.forEach(e => { totals[e.network] = (totals[e.network]||0) + (+e.amount||0); });
  const overall = entries.reduce((a,e)=>a+(+e.amount||0),0);
  const max = Math.max.apply(null, nets.map(n=>totals[n]).concat([0.01]));
  $("revTotals").innerHTML = '<p><b>Total logged: $' + overall.toFixed(2) + '</b> across ' + entries.length + ' entries.</p>';
  $("revChart").innerHTML = '<h3>By network</h3>' + nets.map(n =>
    '<div class="bar-row"><span class="lbl">' + n + '</span><span class="bar"><i style="width:' + Math.round(totals[n]/max*100) + '%"></i></span><span class="val">$' + totals[n].toFixed(2) + '</span></div>').join("");
  $("revList").innerHTML = entries.length ? '<table><tr><th>Date</th><th>Network</th><th>Amount</th><th></th></tr>' + entries.slice().reverse().map((e, ri) => {
    const i = entries.length - 1 - ri;
    return '<tr><td>' + fmtDate(e.date) + '</td><td>' + esc(e.network) + '</td><td>$' + (+e.amount).toFixed(2) + '</td><td><button class="btn small danger" data-del-rev="' + i + '">Delete</button></td></tr>';
  }).join("") + '</table>' : '<p class="muted">No revenue logged yet.</p>';
  $("revList").querySelectorAll("[data-del-rev]").forEach(b => b.addEventListener("click", async () => {
    b.disabled = true; const oldText = b.textContent; b.textContent = "Deleting…";
    const list = S.get("revenue", []);
    const item = list[+b.dataset.delRev];
    if(S.mode==='cloud' && item && item.id){
      const { error } = await sb.from("revenue_entries").delete().eq("id", item.id);
      if(error){ prependNote("revList", "err", "Could not delete that entry: " + error.message); b.disabled = false; b.textContent = oldText; return; }
    }
    list.splice(+b.dataset.delRev, 1);
    if(S.mode==='local') LS.set("revenue", list);
    renderRevenue(); renderDashboard();
  }));
}
$("revAddBtn").addEventListener("click", async () => {
  /* Disabled for the whole save: a double-tap used to log the same revenue
     twice. The button text is the loading indicator. */
  const btn = $("revAddBtn");
  btn.disabled = true; btn.textContent = "Logging…";
  try{
    const amt = parseFloat($("revAmt").value);
    if(isNaN(amt) || amt < 0){ prependNote("revList", "err", "Enter a valid amount (0 or more)."); return; }
    const rec = { date: $("revDate").value || todayISO(), network: $("revNet").value, amount: amt };
    if(S.mode==='cloud'){
      const { data, error } = await sb.from("revenue_entries").insert({ user_id:currentUser.id, entry_date:rec.date, network:rec.network, amount:rec.amount }).select("id").single();
      if(error || !data){ prependNote("revList", "err", "Could not log that revenue: " + (error ? error.message : "unknown error")); return; }
      rec.id = data.id;
      S.get("revenue", []).push(rec);
    }else{
      const entries = LS.get("revenue", []);
      entries.push(rec);
      LS.set("revenue", entries);
    }
    $("revAmt").value = "";
    renderRevenue(); renderDashboard();
  }catch(e){
    prependNote("revList", "err", "Could not log that revenue — " + (e.message||e));
  }finally{
    btn.disabled = false; btn.textContent = "Log revenue";
  }
});
function loadSettings(){
  const s = LS.get("settings", {});
  $("setPsi").value = s.psiKey||"";
  $("setAiProvider").value = s.aiProvider||"coarena";
  $("setAiKey").value = s.aiKey||"";
  $("setAiBaseUrl").value = s.aiBaseUrl||"";
  $("setAiModel").value = s.aiModel||"";
  agentProviderHint();
}
$("setSaveBtn").addEventListener("click", () => {
  LS.set("settings", { psiKey:$("setPsi").value.trim(), aiProvider:$("setAiProvider").value, aiKey:$("setAiKey").value.trim(), aiBaseUrl:$("setAiBaseUrl").value.trim(), aiModel:$("setAiModel").value.trim() });
  $("setSaved").textContent = "Saved in this browser.";
  setTimeout(() => { $("setSaved").textContent = ""; }, 3000);
});
/* API keys are password fields with a show/hide toggle — the PageSpeed key
   used to be type="text", readable on screen to anyone looking over a
   shoulder. The toggle defaults to hidden. */
function bindKeyToggle(btnId, inputId){
  const b = $(btnId); if(!b) return;
  b.addEventListener("click", () => {
    const el = $(inputId); if(!el) return;
    const show = el.type === "password";
    el.type = show ? "text" : "password";
    b.textContent = show ? "Hide key" : "Show key";
  });
}
bindKeyToggle("setPsiToggle", "setPsi");
bindKeyToggle("setAiToggle", "setAiKey");

/* ---------- Forge Assistant (in-site AI agent) ---------- */
/* Runs on the user's OWN key (BYOK): CoArena, Google Gemini free tier, or any
   OpenAI-compatible provider. The key lives only in this browser's localStorage
   and is sent to our ai-agent edge function per request — never stored
   server-side, and there is no site-wide key for anyone to burn through.
   Free plan: 5 messages a day (enforced in this browser; PLAN_LIMITS.aiMessagesPerDay);
   Pro, Agency and Business: unlimited. */

function agentSettings(){
  const s = LS.get("settings", {});
  return { provider:s.aiProvider||"coarena", key:(s.aiKey||"").trim(), baseUrl:(s.aiBaseUrl||"").trim(), model:(s.aiModel||"").trim() };
}
function agentEndpoint(provider, baseUrl){
  if(provider==="gemini") return "https://generativelanguage.googleapis.com/v1beta/openai";
  if(provider==="openai") return (baseUrl||"https://api.openai.com/v1").replace(/\/+$/,"");
  return (baseUrl||"").replace(/\/+$/,"");
}
function agentModel(provider, model){
  if(model) return model;
  if(provider==="gemini") return "gemini-2.0-flash";
  if(provider==="openai") return "gpt-4o-mini";
  return "";
}
function agentProviderHint(){
  const p = $("setAiProvider").value;
  if(p==="gemini"){
    $("setAiHint").textContent = "Free tier: get a key at Google AI Studio (aistudio.google.com). Base URL and model are filled in for you — only the key is needed.";
    if(!$("setAiBaseUrl").value) $("setAiBaseUrl").value = "https://generativelanguage.googleapis.com/v1beta/openai";
    if(!$("setAiModel").value) $("setAiModel").value = "gemini-2.0-flash";
  }else if(p==="openai"){
    $("setAiHint").textContent = "Any OpenAI-compatible provider — paste its base URL, your key and the model name.";
  }else{
    $("setAiHint").textContent = "CoArena: paste the base URL + key from your CoArena page, and the model name.";
  }
}
$("setAiProvider").addEventListener("change", agentProviderHint);
function agentUsageToday(){
  const d = LS.get("agentUsage", {});
  const today = todayISO();
  if(d.date!==today) return {date:today, used:0};
  return d;
}
function agentCanChat(){
  if(isAdmin() || isPaidPlan()) return {ok:true, left:null};
  const u = agentUsageToday();
  return u.used < PLAN_LIMITS.aiMessagesPerDay ? {ok:true, left:PLAN_LIMITS.aiMessagesPerDay-u.used} : {ok:false, left:0};
}
function agentBumpUsage(){
  if(isAdmin() || isPaidPlan()) return;
  const u = agentUsageToday();
  /* Best-effort only: if storage is full the LS.set throws, and the throw
     used to land in agentSend's catch and append "Could not answer" AFTER
     the real reply had already rendered. Swallow it here — the reply stands. */
  try{ LS.set("agentUsage", {date:u.date, used:u.used+1}); }catch(e){}
}
/* Forge counts, computed the same way the Dashboard does: rank checks live
   inside keywords[].checks (loadCloudData folds the rank_checks table into
   them — no top-level rankChecks key ever exists, so reading one always
   said "0 rank checks"), and "links" is a list of check groups each with a
   .count — count the links, not the groups. */
function agentDataCounts(){
  const kws = S.get("keywords", []);
  const ranks = kws.reduce((a,k)=>a+((k.checks||[]).length),0);
  const links = S.get("links", []).reduce((a,g)=>a+((g&&g.count)||0),0);
  return {ranks, links};
}
function agentContext(){
  const audits = S.get("audits", []);
  const last = audits[0];
  const kws = S.get("keywords", []).length;
  const {ranks, links} = agentDataCounts();
  const bits = [];
  if(last) bits.push("latest site audit: " + (last.url||"") + " — PageSpeed " + (last.psi==null?"unknown":last.psi+"/100") + (last.ok==null?"":", "+last.ok+" of "+last.total+" URLs reachable"));
  bits.push(kws + " keywords tracked, " + ranks + " rank checks, " + links + " verified links");
  bits.push("plan: " + (currentPlan||"free"));
  return "You are the Forge Assistant inside SEOForge, a free SEO toolkit. The user's saved data: " + bits.join("; ") + ". Answer SEO questions about their data and how to improve it. Never invent numbers — only use the data given here, or say you do not know.";
}
/* Keyless answers: questions about the user's own saved data are answered
   right here in the browser — no key, no network, no cost, and nothing is
   sent anywhere. Anything else still needs a key. Returns the answer, or
   null when the question is not one the local answerer can handle. */
function agentLocalAnswer(q){
  const text = String(q||"").toLowerCase();
  const has = (...words) => words.some(w => text.includes(w));
  const hasWord = w => new RegExp("(^|[^a-z])" + w + "([^a-z]|$)").test(text);
  const audits = S.get("audits", []);
  const last = audits[0];
  const kws = S.get("keywords", []);
  const {ranks, links} = agentDataCounts();
  const plan = currentPlan||"free";
  if(has("help","what can you do","hello","hey") || text.trim()==="hi"){
    return "No key needed for this: I can tell you about your own saved data — try 'what is my latest audit score?', 'how many keywords am I tracking?', 'how many links have I verified?', or 'what is my plan?'. For open SEO questions — how to fix something, what to do next — add your key in Settings (CoArena, or a free Gemini key) and I can answer those too.";
  }
  if(has("audit","pagespeed","page speed","how did","my site do") || (text.includes("score") && !text.includes("speed score"))){
    if(!last) return "You have no saved audits yet — run a Site Audit or a Health Check first, then ask me again.";
    return "Your latest audit of " + (last.url||"your site") + " scored PageSpeed " + (last.psi==null?"unknown":last.psi+"/100") + (last.ok==null?"":", "+last.ok+" of "+last.total+" URLs reachable") + ".";
  }
  if(has("keyword")){
    if(!kws.length) return "You're not tracking any keywords yet — add one in the Keywords tab and I'll keep count here.";
    const names = kws.slice(0,5).map(k=>k.keyword).filter(Boolean);
    return "You're tracking " + kws.length + " keyword" + (kws.length===1?"":"s") + (names.length?": " + names.join(", ") + (kws.length>names.length?" and " + (kws.length-names.length) + " more":""):"") + ". You have " + ranks + " rank check" + (ranks===1?"":"s") + " recorded.";
  }
  if(has("link","backlink")){
    return "You have " + links + " verified link" + (links===1?"":"s") + " saved." + (links?"":" Add one in the Links tab and it will show up here.");
  }
  if(has("plan","upgrade","limit","message") || hasWord("pro")){
    const limit = agentCanChat();
    if(isAdmin() || isPaidPlan()) return "You're on the " + planDisplayName(plan) + " plan. The assistant is unlimited for you.";
    return "You're on the Free plan. The assistant gives " + PLAN_LIMITS.aiMessagesPerDay + " free messages a day" + (limit.left!=null?" — you have " + limit.left + " left today":"") + "; Pro ($9/month) is unlimited.";
  }
  if(has("speed")){
    return "The speed score isn't saved — run a Health Check or a Site Audit to see it live. (Ask me about your audit score instead — that one I keep.)";
  }
  return null;
}
let agentHistory = [];
function agentRender(){
  const box = $("agentMsgs");
  const limit = agentCanChat();
  $("agentLimit").textContent = isPaidPlan() ? planDisplayName(currentPlan) + " — unlimited" : (limit.left + " of " + PLAN_LIMITS.aiMessagesPerDay + " free messages left today");
  box.innerHTML = agentHistory.length ? agentHistory.map(m => '<div class="agent-msg ' + (m.role==="user"?"user":"ai") + '">' + esc(m.content) + '</div>').join("") : '<p class="muted">Ask about your audit results, keywords, or any SEO question. I answer from your saved data — I never invent numbers. No key? I can still answer questions about your own data — try “what is my latest audit score?”</p>';
  box.scrollTop = box.scrollHeight;
}
async function agentAsk(messages){
  const s = agentSettings();
  const res = await fetchJsonTimeout(SUPABASE_URL+"/functions/v1/ai-agent", 30000, {method:"POST", headers:{"Content-Type":"application/json", apikey:SUPABASE_PUBLISHABLE_KEY, Authorization:"Bearer "+SUPABASE_PUBLISHABLE_KEY}, body:JSON.stringify({apiKey:s.key, baseUrl:agentEndpoint(s.provider, s.baseUrl), model:agentModel(s.provider, s.model), messages})});
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error||("AI agent error (HTTP "+res.status+")"));
  return data.reply||"";
}
async function agentSend(){
  const input = $("agentInput");
  const text = (input.value||"").trim();
  if(!text) return;
  const s = agentSettings();
  if(!s.key){
    const local = agentLocalAnswer(text);
    if(local){
      agentHistory.push({role:"user", content:text});
      agentHistory.push({role:"assistant", content:local});
      input.value = "";
      agentRender(); return;
    }
    agentHistory.push({role:"assistant", content:"Add your AI key in Settings first — the assistant runs on your own key, so it costs the site nothing. CoArena works, or a free Gemini key from Google AI Studio."});
    agentRender(); return;
  }
  const limit = agentCanChat();
  if(!limit.ok){
    agentHistory.push({role:"assistant", content:"Free plan: 5 assistant messages a day, and today\u2019s are used up. Upgrade to Pro ($9/month) for unlimited, or come back tomorrow."});
    agentRender(); return;
  }
  agentHistory.push({role:"user", content:text});
  input.value = ""; agentRender();
  $("agentSendBtn").disabled = true; $("agentProg").textContent = "Thinking…";
  try{
    const reply = await agentAsk([{role:"system", content:agentContext()}].concat(agentHistory.slice(-8)));
    agentHistory.push({role:"assistant", content:reply});
    agentBumpUsage();
  }catch(e){
    agentHistory.push({role:"assistant", content:"Could not answer — " + (e.message||e)});
  }
  $("agentSendBtn").disabled = false; $("agentProg").textContent = "";
  agentRender();
}
$("agentBtn").addEventListener("click", () => {
  const p = $("agentPanel");
  p.hidden = !p.hidden;
  if(!p.hidden){ agentRender(); $("agentInput").focus(); }
});
$("agentCloseBtn").addEventListener("click", () => { $("agentPanel").hidden = true; });
$("agentSendBtn").addEventListener("click", agentSend);
$("agentInput").addEventListener("keydown", e => { if(e.key==="Enter" && !e.shiftKey){ e.preventDefault(); agentSend(); } });
$("setAiTestBtn").addEventListener("click", async () => {
  const s = agentSettings();
  $("setAiTest").textContent = "Testing…";
  if(!s.key){ $("setAiTest").textContent = "Add your key first."; return; }
  try{
    const reply = await agentAsk([{role:"user", content:"Reply with one short sentence saying hello."}]);
    $("setAiTest").textContent = "Working — the assistant replied: " + reply.slice(0,120);
  }catch(e){ $("setAiTest").textContent = "Failed — " + (e.message||e); }
});

/* ---------- Marketplace ---------- */
const SEED_LISTINGS = [
  { id:"seed-1", site:"https://www.lookforit.xyz", niche:"AI tools directory", price:20, da:"", dr:"", title:"LookForIt — Sponsored listing", desc:"Your AI tool listed on lookforit.xyz (153 verified tools, 20 categories). One-time payment, live within 24 hours, marked sponsored." },
  { id:"seed-2", site:"https://www.lookforit.xyz", niche:"AI tools directory", price:49, da:"", dr:"", title:"LookForIt — Manual review", desc:"Hands-on review of your AI tool, written up properly and listed on LookForIt. One-time $49." },
  { id:"seed-3", site:"https://www.estatepath.online", niche:"Real estate (Florida, USA)", price:null, da:"", dr:"", title:"Estate Path — Guest post", desc:"Guest post on the Estate Path real estate blog. Price: DM for rates — no fixed price." },
  { id:"seed-4", site:"https://syedsenterprises.org", niche:"Software, SEO & content services", price:null, da:"", dr:"", title:"Syed Enterprises — Services hub", desc:"All services in one place — SEO tools, AI tool listings, real estate content and custom software. Browse the full list on the hub; DM for rates." }
];
function allListings(){ return SEED_LISTINGS.concat(S.get("listings", [])); }
/* One-shot marketplace error: placeOrder runs before renderMarket() in its
   caller, so an inline note written straight into #mktOrders would be wiped
   by the re-render. The error is staged here and rendered (once) by
   renderMarket(). */
let marketError = "";
async function placeOrder(l){
  if(S.mode==='cloud'){
    let listingId = l.id;
    if(String(listingId).indexOf("seed-") === 0){
      /* Seed listings live only in the page, not in the listings table.
         Copy the seed listing into the user's listings so the order's
         foreign key has a real row to point at. */
      const { data, error } = await sb.from("listings").insert({ user_id:currentUser.id, site_url:l.site, niche:l.niche, price:l.price, da:null, dr:null, listing_type:"seed-copy" }).select("id").single();
      if(error || !data){ marketError = "Could not place that order: " + (error ? error.message : "unknown error"); return false; }
      listingId = data.id;
      S.cache.listings.push({ id:data.id, site:l.site, niche:l.niche, price:l.price, da:"", dr:"", title:l.title, desc:l.desc });
    }
    const { data: ord, error: oerr } = await sb.from("orders").insert({ user_id:currentUser.id, listing_id:listingId, status:"pending" }).select("id").single();
    if(oerr || !ord){ marketError = "Could not place that order: " + (oerr ? oerr.message : "unknown error"); return false; }
    const orders = S.get("orders", []);
    orders.unshift({ id:ord.id, date:todayISO(), listing:l.title, site:l.site, price:l.price, status:"pending", listing_id:listingId });
    return true;
  }
  const orders = LS.get("orders", []);
  orders.unshift({ date:todayISO(), listing:l.title, site:l.site, price:l.price, status:"pending" });
  LS.set("orders", orders);
  return true;
}
/* Featured listings (v2.11.0): Agency accounts (and the owner) can mark one of
   their own listings as featured — it sorts first with a "Featured" badge.
   Business includes everything in Agency, so it can feature too. */
function featuredListingIds(){ return LS.get("featuredListings", []); }
function isFeaturedListing(id){ return featuredListingIds().includes(id); }
/* Agency or Business (or the owner) may feature. Pro and Free may not. */
function canFeatureListings(){ return isAdmin() || currentPlan === "agency" || currentPlan === "business"; }
function toggleFeaturedListing(id){
  if(!canFeatureListings()) return false;
  /* Seed listings are the site's own directory entries — they can never be
     force-featured via a stored id (the Feature button is hidden for them,
     but a stored id must not work either). */
  if(String(id).indexOf("seed-") === 0) return false;
  const ids = featuredListingIds();
  const i = ids.indexOf(id);
  if(i >= 0) ids.splice(i,1); else ids.push(id);
  LS.set("featuredListings", ids);
  return true;
}
function featuredFirst(listings){
  /* The featured sort applies only when the current plan can feature, and
     never to seed listings — a stored seed id (e.g. from before a plan
     downgrade) must not resurrect a badge or a first-place sort. */
  if(!canFeatureListings()) return (listings||[]).slice();
  const ids = new Set(featuredListingIds().filter(id => String(id).indexOf("seed-") !== 0));
  return (listings||[]).slice().sort((a,b) => (ids.has(b.id)?1:0) - (ids.has(a.id)?1:0));
}
function renderMarket(){
  const listings = featuredFirst(allListings());
  const canFeature = canFeatureListings();
  $("mktList").innerHTML = listings.map(l =>
    '<div class="listing">' + (canFeature && isFeaturedListing(l.id) ? '<span class="pill ok">Featured</span> ' : '') + '<b>' + esc(l.title) + '</b> — <span class="muted">' + esc(l.niche) + '</span><br>'
    + '<span class="muted">' + esc(l.desc||"") + '</span><br>'
    + '<a href="' + esc(normaliseSite(l.site)) + '" target="_blank" rel="noopener">' + esc(l.site) + '</a><br>'
    + '<span class="price">' + (l.price==null ? 'DM for rates' : '$' + l.price + ' one-time') + '</span>'
    + (l.da!=="" && l.da!=null ? ' · DA ' + esc(l.da) : '') + (l.dr!=="" && l.dr!=null ? ' · DR ' + esc(l.dr) : '')
    + ' <button class="btn small" data-order="' + esc(l.id) + '">Order</button>'
    + (canFeature && String(l.id).indexOf("seed-") !== 0 ? ' <button class="btn small secondary" data-feature="' + esc(l.id) + '">' + (isFeaturedListing(l.id) ? 'Unfeature' : 'Feature this listing') + '</button>' : '')
    + '</div>').join("");
  $("mktList").querySelectorAll("[data-feature]").forEach(b => b.addEventListener("click", () => { toggleFeaturedListing(b.dataset.feature); renderMarket(); }));
  $("mktList").querySelectorAll("[data-order]").forEach(b => b.addEventListener("click", async () => {
    const l = allListings().find(x => x.id === b.dataset.order);
    if(!l) return;
    b.disabled = true;
    await placeOrder(l);
    b.disabled = false;
    renderMarket(); renderDashboard();
  }));
  const orders = S.get("orders", []);
  const errHtml = marketError ? '<div class="err">' + esc(marketError) + '</div>' : '';
  marketError = "";
  $("mktOrders").innerHTML = errHtml + (orders.length ? orders.map((o,i) =>
    '<div class="listing"><b>' + esc(o.listing) + '</b> <span class="muted">— ' + fmtDate(o.date) + '</span><br>'
    + '<span class="pill warn">' + esc(o.status) + '</span> ' + (o.price==null ? 'DM for rates' : '$' + o.price)
    + ' <button class="btn small secondary" data-complete-order="' + i + '">Mark completed</button>'
    + ' <button class="btn small danger" data-del-order="' + i + '">Delete</button></div>').join("")
    : '<p class="muted">No orders yet. Orders are records only — contact the buyer yourself to complete the sale. No payments are taken here.</p>');
  $("mktOrders").querySelectorAll("[data-complete-order]").forEach(b => b.addEventListener("click", async () => {
    const o = S.get("orders", []);
    const item = o[+b.dataset.completeOrder];
    if(S.mode==='cloud' && item && item.id){
      const { error } = await sb.from("orders").update({ status:"completed" }).eq("id", item.id);
      if(error){ prependNote("mktOrders", "err", "Could not update that order: " + error.message); return; }
    }
    item.status = "completed";
    if(S.mode==='local') LS.set("orders", o);
    renderMarket();
  }));
  $("mktOrders").querySelectorAll("[data-del-order]").forEach(b => b.addEventListener("click", async () => {
    const o = S.get("orders", []);
    const item = o[+b.dataset.delOrder];
    if(S.mode==='cloud' && item && item.id){
      const { error } = await sb.from("orders").delete().eq("id", item.id);
      if(error){ prependNote("mktOrders", "err", "Could not delete that order: " + error.message); return; }
    }
    o.splice(+b.dataset.delOrder, 1);
    if(S.mode==='local') LS.set("orders", o);
    renderMarket(); renderDashboard();
  }));
}
$("mkAddBtn").addEventListener("click", async () => {
  /* Disabled for the whole save: a double-tap used to add the same listing
     twice. The button text is the loading indicator. */
  const btn = $("mkAddBtn");
  btn.disabled = true; btn.textContent = "Adding…";
  formErr("mkErr", "");
  try{
    const site = normaliseSite($("mkSite").value);
    const priceRaw = $("mkPrice").value;
    if(!site){ formErr("mkErr", "Enter the site URL."); return; }
    const price = priceRaw==="" ? null : parseFloat(priceRaw);
    if(price!==null && (isNaN(price) || price<0)){ formErr("mkErr", "Enter a valid price, or leave it blank for DM for rates."); return; }
    const niche = ($("mkNiche").value||"").trim()||"General";
    const da = $("mkDa").value===""?"":$("mkDa").value;
    const dr = $("mkDr").value===""?"":$("mkDr").value;
    if(S.mode==='cloud'){
      const { data, error } = await sb.from("listings").insert({ user_id:currentUser.id, site_url:site, niche, price, da:(da===""?null:parseInt(da,10)), dr:(dr===""?null:parseInt(dr,10)), listing_type:"custom" }).select("id").single();
      if(error || !data){ formErr("mkErr", "Could not add that listing: " + (error ? error.message : "unknown error")); return; }
      S.get("listings", []).push({ id:data.id, site, niche, price, da, dr, title:site.replace(/^https?:\/\//,""), desc:"Custom listing added by you." });
    }else{
      const listings = LS.get("listings", []);
      listings.push({ id:"custom-" + Date.now(), site, niche, price, da, dr, title:site.replace(/^https?:\/\//,""), desc:"Custom listing added by you." });
      LS.set("listings", listings);
    }
    ["mkSite","mkNiche","mkPrice","mkDa","mkDr"].forEach(id => { $(id).value = ""; });
    renderMarket();
  }catch(e){
    formErr("mkErr", "Could not add that listing — " + (e.message||e));
  }finally{
    btn.disabled = false; btn.textContent = "Add listing";
  }
});

/* ================= v2.6 integrations ================= */
/* Google OAuth (Search Console + Analytics, read-only), email alerts + share.
   Tokens and secrets live in Supabase (edge functions + google_tokens table) —
   nothing secret is in this file. The Google client ID above is a placeholder
   until the OAuth client is created; the connect button says so honestly. */
let lastAudit = null; /* { site, score, lcp, cls, date } — for the share buttons */
let googleConnected = false;
let gscSitesAutoLoaded = false; /* auto-load verified sites once per session when connected */

function fetchJsonTimeout(url, ms, opts, scope){
  const c = new AbortController();
  const set = scope || activeRequests;
  set.add(c);
  const t = setTimeout(() => c.abort(), ms);
  const o = Object.assign({}, opts || {}, { signal: c.signal });
  return fetch(url, o).finally(() => { clearTimeout(t); set.delete(c); });
}
async function supabaseAccessToken(){
  if(!sb) return null;
  try{
    const { data } = await sb.auth.getSession();
    return (data.session && data.session.access_token) || null;
  }catch(e){ return null; }
}
/* Every Google call goes through the google-oauth edge function, which attaches
   the stored access token server-side. Nothing token-like is in this page. */
async function googleApi(action, body){
  const token = await supabaseAccessToken();
  if(!token) throw new Error("Sign in to SEOForge first.");
  let res;
  try{
    res = await fetchJsonTimeout(GOOGLE_OAUTH_FN, 30000, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      body: JSON.stringify(Object.assign({ action }, body || {}))
    });
  }catch(e){ throw new Error("Could not reach the Google connection (edge function): " + (e.message || e) + ". It may not be deployed yet — see README."); }
  let data = {};
  try{ data = await res.json(); }catch(e){ throw new Error("The Google connection returned an unreadable response (HTTP " + res.status + ")."); }
  if(!res.ok) throw new Error((data && data.error) || ("Google request failed (HTTP " + res.status + ")"));
  return data;
}
async function connectGoogle(){
  if(!currentUser){
    showAuthMsg("Create a free account or sign in first — then you can connect Google.");
    focusAuth();
    return;
  }
  if(!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID === "GOOGLE_OAUTH_CLIENT_ID"){
    showBanner("Google sign-in is not set up yet — the OAuth client ID is still a placeholder. It is being created in Google Cloud Console; see the README for the exact steps.", 'warn');
    return;
  }
  const state = crypto.randomUUID();
  const verifier = crypto.randomUUID() + crypto.randomUUID();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  try {
    sessionStorage.setItem("seoforge.googleState", state);
    sessionStorage.setItem("seoforge.googleVerifier", verifier);
    sessionStorage.setItem("seoforge.googleUser", currentUser.id);
    sessionStorage.setItem("seoforge.googleTime", String(Date.now()));
  } catch { showBanner("Enable session storage to securely connect Google.", "warn"); return; }
  const url = "https://accounts.google.com/o/oauth2/v2/auth"
    + "?client_id=" + encodeURIComponent(GOOGLE_CLIENT_ID)
    + "&redirect_uri=" + encodeURIComponent(GOOGLE_REDIRECT_URI)
    + "&response_type=code&scope=" + encodeURIComponent(GOOGLE_SCOPES)
    + "&access_type=offline&prompt=consent&state=" + encodeURIComponent(state)
    + "&code_challenge_method=S256&code_challenge=" + encodeURIComponent(challenge);
  window.location.href = url;
}
document.addEventListener("click", e => {
  const t = e.target.closest('[data-action="google-connect"]');
  if(t){ e.preventDefault(); connectGoogle(); return; }
  if(e.target.closest('[data-action="google-disconnect-yes"]')){ e.preventDefault(); doDisconnectGoogle(); return; }
  if(e.target.closest('[data-action="google-disconnect-no"]')){ e.preventDefault(); clearDisconnectConfirm(); }
});
async function handleGoogleReturn(){
  let code = null, state = null, err = null;
  try{
    const params = new URLSearchParams(window.location.search);
    code = params.get("code"); state = params.get("state"); err = params.get("error");
  }catch(e){ return; }
  if(err){
    showBanner("Google sign-in did not complete: " + err + ". Try connecting again.", 'warn');
    return;
  }
  if(!code) return;
  /* Every sessionStorage access is guarded (F14b): with storage disabled
     the unguarded getItem calls below threw and the boot chain fell into a
     generic warning instead of the specific "state did not match" message. */
  const ssGet = k => { try{ return sessionStorage.getItem(k); }catch(e){ return null; } };
  const ssDel = k => { try{ sessionStorage.removeItem(k); }catch(e){} };
  const savedState = ssGet("seoforge.googleState");
  const verifier = ssGet("seoforge.googleVerifier");
  ssDel("seoforge.googleVerifier");
  const owner = ssGet("seoforge.googleUser");
  const issued = Number(ssGet("seoforge.googleTime"));
  ssDel("seoforge.googleState");
  ssDel("seoforge.googleUser");
  ssDel("seoforge.googleTime");
  if(!verifier || !savedState || state !== savedState || !currentUser || owner !== currentUser.id || !issued || Date.now()-issued > 600000){
    showBanner("Google sign-in was rejected: the security check (state) did not match. Try connecting again.", 'warn');
    return;
  }
  /* Clean code/state from the URL so a refresh does not re-exchange the code. */
  try{
    const url = new URL(window.location.href);
    ["code","state","scope","authuser","prompt"].forEach(k => url.searchParams.delete(k));
    history.replaceState(null, "", url.toString());
  }catch(e){}
  try{
    await googleApi("exchange", { code, code_verifier: verifier, redirect_uri: GOOGLE_REDIRECT_URI });
    showBanner("Google connected — your Search Console and Analytics data is now available in the Search Console tab.", 'ok');
  }catch(e){
    showBanner("Google connection failed: " + (e.message || e), 'warn');
    return;
  }
  renderGoogleStatus();
}
function setGoogleStatusUI(connected, note){
  googleConnected = !!connected;
  const msg = connected
    ? "Google is connected — Search Console and Analytics data is available below."
    : (note || "Google is not connected.");
  ["gscStatus","intGoogleStatus"].forEach(id => { const el = $(id); if(el) el.textContent = msg; });
  ["gscDisconnectBtn","intDisconnectBtn"].forEach(id => { const el = $(id); if(el) el.hidden = !connected; });
  const controls = $("gscControls"), ga4 = $("ga4Card");
  if(controls) controls.hidden = !connected;
  if(ga4) ga4.hidden = !connected;
  /* When connected the button is a reconnect (switch account / refresh the
     token), not a first-time connect — label it honestly so it does not look
     as if the connection failed. */
  document.querySelectorAll('[data-action="google-connect"]').forEach(b => { b.textContent = connected ? "Reconnect Google" : "Connect Google"; });
}
async function renderGoogleStatus(){
  if(!currentUser){ setGoogleStatusUI(false, "Sign in to SEOForge first, then connect Google."); return; }
  ["gscStatus","intGoogleStatus"].forEach(id => { const el = $(id); if(el) el.textContent = "Checking Google connection…"; });
  try{
    const data = await googleApi("status", {});
    setGoogleStatusUI(!!data.connected, data.connected ? "" : "Google is not connected.");
    /* Auto-load the verified sites once per session when connected, so the
       connected sites flow into My sites and every tab without manual entry. */
    if(data.connected && !gscSitesAutoLoaded){ gscSitesAutoLoaded = true; loadGscSites(true); }
  }catch(e){
    setGoogleStatusUI(false, "Google connection is not available yet — " + (e.message || e));
  }
}
async function disconnectGoogle(source){
  /* No native modal: the first tap arms an inline confirm row ("Disconnect?
     [Yes, disconnect] [Keep connected]"); the row's buttons finish or cancel
     it. A second tap while armed does nothing — the row is already waiting.
     F9: the row is rendered WHERE THE USER CLICKED. The old code always
     wrote into #gscDisconnectConfirm (GSC tab) even when the click came from
     the Settings button — the confirm armed in a hidden tab and the button
     looked dead. source is "int" (Settings) or "gsc" (default). */
  const row = source === "int" ? $("intDisconnectConfirm") : $("gscDisconnectConfirm");
  const other = source === "int" ? elOrNull("gscDisconnectConfirm") : elOrNull("intDisconnectConfirm");
  if(other && other.dataset.armed){ other.innerHTML = ""; delete other.dataset.armed; }
  if(!row){ await doDisconnectGoogle(); return; }
  if(row.dataset.armed){ return; }
  row.dataset.armed = "1";
  row.innerHTML = '<span class="muted">Disconnect Google? SEOForge will delete its stored Google tokens and stop reading your Search Console and Analytics data. </span><button type="button" class="btn small danger" data-action="google-disconnect-yes">Yes, disconnect</button> <button type="button" class="btn small secondary" data-action="google-disconnect-no">Keep connected</button>';
}
function clearDisconnectConfirm(){
  ["gscDisconnectConfirm","intDisconnectConfirm"].forEach(id => {
    const row = elOrNull(id);
    if(row){ row.innerHTML = ""; delete row.dataset.armed; }
  });
}
async function doDisconnectGoogle(){
  clearDisconnectConfirm();
  try{
    await googleApi("disconnect", {});
    showBanner("Google disconnected.", 'ok');
  }catch(e){
    showBanner("Disconnect failed: " + (e.message || e), 'warn');
  }
  renderGoogleStatus();
}
$("gscDisconnectBtn").addEventListener("click", () => disconnectGoogle("gsc"));
$("intDisconnectBtn").addEventListener("click", () => disconnectGoogle("int"));
function defaultDateRange(){
  const end = new Date(), start = new Date(Date.now() - 27*24*3600*1000);
  const iso = d => d.toISOString().slice(0,10);
  if($("gscStart") && !$("gscStart").value) $("gscStart").value = iso(start);
  if($("gscEnd") && !$("gscEnd").value) $("gscEnd").value = iso(end);
}
async function loadGscSites(quiet){
  const prog = $("gscProg"); prog.textContent = "Loading your verified sites from Search Console …";
  try{
    const data = await googleApi("sites", {});
    const sel = $("gscSite");
    const sites = (data.sites || []);
    if(!sites.length){ sel.innerHTML = '<option value="">No verified sites found for this Google account</option>'; prog.textContent = ""; return; }
    sel.innerHTML = sites.map(s => '<option value="' + esc(s.siteUrl) + '">' + esc(s.siteUrl) + '</option>').join("");
    prog.textContent = sites.length + " verified site(s) loaded.";
    /* Connected sites work in every tab: merge them into My sites so the
       header switcher and every tool's URL input pick them up without the
       user re-typing URLs. sc-domain:example.com -> https://example.com
       (normaliseSite drops non-http schemes, so convert first). Manual
       sites keep priority (they stay first); plan limits still apply via
       activeSites(), so a Free user sees only their first site active. */
    const gUrls = sites.map(s => {
      const u = (s.siteUrl || "").trim();
      if(/^sc-domain:/i.test(u)) return "https://" + u.slice(10);
      return u;
    });
    const before = storedSites().length;
    const merged = normalizeSiteList(storedSites().concat(gUrls));
    if(merged.length > before){
      LS.set("sites", merged);
      renderSiteSwitcher();
      applySelectedSite();
      loadSiteSlots();
    }
  }catch(e){ prog.textContent = ""; if(!quiet) $("gscOut").innerHTML = '<div class="err">Could not load sites: ' + esc(e.message || e) + '</div>'; }
}
function gscRowsTable(title, rows, dimLabel){
  if(!rows.length) return '<h3>' + esc(title) + '</h3><p class="muted">No rows in this date range.</p>';
  const trs = rows.map(r => '<tr><td>' + esc((r.keys && r.keys[0]) || "") + '</td><td>' + (r.clicks||0) + '</td><td>' + (r.impressions||0) + '</td><td>' + (((r.ctr||0)*100).toFixed(2)) + '%</td><td>' + ((r.position==null)?"—":(+r.position).toFixed(1)) + '</td></tr>').join("");
  return '<h3>' + esc(title) + '</h3><div style="overflow-x:auto"><table><tr><th>' + esc(dimLabel) + '</th><th>Clicks</th><th>Impressions</th><th>CTR</th><th>Avg position</th></tr>' + trs + '</table></div>';
}
async function runGscReport(){
  const site = ($("gscSite").value || "").trim();
  const start = $("gscStart").value, end = $("gscEnd").value;
  const out = $("gscOut"), prog = $("gscProg");
  if(!site){ out.innerHTML = '<div class="err">Pick a verified site first (Load my sites).</div>'; return; }
  if(!start || !end){ out.innerHTML = '<div class="err">Pick a from/to date first.</div>'; return; }
  prog.textContent = "Asking Search Console for " + site + " …";
  out.innerHTML = "";
  try{
    const data = await googleApi("gsc", { site, startDate: start, endDate: end });
    prog.textContent = "";
    const t = data.totals || {};
    /* A missing total is "not reported", not a zero: the API returns no
       totals object at all when it has nothing to report for the range. */
    const n = v => (v==null ? "—" : v);
    const noTotals = t.clicks==null && t.impressions==null && t.ctr==null && t.position==null;
    out.innerHTML = '<p><span class="pill ok">' + n(t.clicks) + ' clicks</span> <span class="pill info">' + n(t.impressions) + ' impressions</span> <span class="pill info">CTR ' + (t.ctr==null ? "—" : (((t.ctr)*100).toFixed(2)) + '%') + '</span> <span class="pill info">Avg position ' + ((t.position==null)?"—":(+t.position).toFixed(1)) + '</span></p>'
      + (noTotals ? '<p class="muted">Search Console did not report totals for this date range — these are not zeros, they were not reported.</p>' : '')
      + '<p class="muted">Source: Google Search Console API, ' + esc(start) + ' to ' + esc(end) + '. These are your real figures for this site.</p>'
      + gscRowsTable("Top pages", data.pages || [], "Page")
      + gscRowsTable("Top queries", data.queries || [], "Query");
  }catch(e){ prog.textContent = ""; out.innerHTML = '<div class="err">Search Console report failed: ' + esc(e.message || e) + '</div>'; }
}
async function loadGa4Props(){
  const prog = $("ga4Prog"); prog.textContent = "Loading your Analytics properties …";
  try{
    const data = await googleApi("ga4properties", {});
    const sel = $("ga4Prop");
    const props = (data.properties || []);
    if(!props.length){ sel.innerHTML = '<option value="">No GA4 properties found for this Google account</option>'; prog.textContent = ""; return; }
    sel.innerHTML = props.map(p => '<option value="' + esc(p.name) + '">' + esc(p.displayName || p.name) + '</option>').join("");
    prog.textContent = props.length + " propertie(s) loaded.";
  }catch(e){ prog.textContent = ""; $("ga4Out").innerHTML = '<div class="err">Could not load properties: ' + esc(e.message || e) + '</div>'; }
}
async function runGa4Report(){
  const prop = ($("ga4Prop").value || "").trim();
  const out = $("ga4Out"), prog = $("ga4Prog");
  if(!prop){ out.innerHTML = '<div class="err">Pick a property first (Load my properties).</div>'; return; }
  prog.textContent = "Asking Analytics for the last 28 days …";
  out.innerHTML = "";
  try{
    const data = await googleApi("ga4", { property: prop });
    prog.textContent = "";
    /* A missing metric is "not reported", not zero. */
    const n = v => (v==null ? "—" : v);
    out.innerHTML = '<div class="grid"><div class="stat"><b>' + n(data.sessions) + '</b><span>sessions (28 days)</span></div><div class="stat"><b>' + n(data.users) + '</b><span>users (28 days)</span></div></div>'
      + ((data.sessions==null && data.users==null) ? '<p class="muted">Analytics did not report figures for this property — these are not zeros, they were not reported.</p>' : '')
      + '<p class="muted">Source: Google Analytics Data API (GA4), last 28 days, property ' + esc(prop) + '.</p>';
  }catch(e){ prog.textContent = ""; out.innerHTML = '<div class="err">GA4 report failed: ' + esc(e.message || e) + '</div>'; }
}
$("gscLoadSitesBtn").addEventListener("click", () => loadGscSites());
$("gscRunBtn").addEventListener("click", runGscReport);
$("ga4LoadPropsBtn").addEventListener("click", loadGa4Props);
$("ga4RunBtn").addEventListener("click", runGa4Report);
defaultDateRange();

/* ---------- notifications (weekly rank summary email) ---------- */
/* Preference is stored in profiles.weekly_summary when that column exists;
   otherwise it falls back to this browser's localStorage. Either way the
   page never breaks. Weekly mails themselves need a scheduled trigger on the
   server (see README) — until it is set up, this saves the preference only. */
async function loadNotifPref(){
  const box = $("notifWeekly"); if(!box) return;
  let val = LS.get("notifWeekly", false);
  if(currentUser && sb){
    try{
      const { data, error } = await sb.from("profiles").select("weekly_summary").eq("id", currentUser.id).maybeSingle();
      if(!error && data && typeof data.weekly_summary === "boolean") val = data.weekly_summary;
    }catch(e){ /* column may not exist yet — localStorage fallback stands */ }
  }
  box.checked = !!val;
}
async function saveNotifPref(){
  const box=$("notifWeekly"),button=$("notifSaveBtn"),out=$("notifSaved");
  if(!currentUser || !sb){out.textContent="Sign in to save email preferences. Guest mode does not send emails.";return;}
  button.disabled=true;
  try {
    const {error}=await sb.from("profiles").update({weekly_summary:!!box.checked}).eq("id",currentUser.id);
    if(error) throw error;
    out.textContent=box.checked?"Weekly summaries enabled for your account when email service is configured.":"Email summaries disabled for your account.";
  }catch(e){out.textContent="Not saved. Your previous email preference remains active: "+e.message;await loadNotifPref();}
  finally {button.disabled=false;}
}
$("notifSaveBtn").addEventListener("click", saveNotifPref);

/* ---------- share / export (client-side, no keys) ---------- */
/* Share text for a Site Audit. Leads with the SEOForge Speed Score — our own
   deterministic measurement — and shows Google's PageSpeed only as a
   secondary number stamped with the run time, because Google's score varies
   run to run and must never be presented as a stable badge. */
function auditShareText(a){
  const psi = (a.score==null ? "—" : a.score) + "/100" + (a.time ? " at " + a.time : "");
  const stable = a.sfScore!=null
    ? "Speed Score " + a.sfScore + "/100 (our own measurement)"
    : null;
  return "SEOForge audit: " + a.site + " — " + (stable ? stable + "; Google PageSpeed " + psi : "Google PageSpeed " + psi)
    + (a.lcp ? ", LCP " + a.lcp : "") + (a.cls ? ", CLS " + a.cls : "")
    + ". Checked " + a.date + " with SEOForge. (Google's PageSpeed score varies run to run.)";
}
function shareBarHtml(a){
  const host = normHost(a.site.replace(/^https?:\/\//,"").split("/")[0]);
  return '<div class="card" style="margin-top:10px"><h3>Share this audit</h3>'
    + '<div class="row"><button class="btn secondary" data-share="web">Share…</button>'
    + '<button class="btn secondary" data-share="x">Post on X</button>'
    + '<button class="btn secondary" data-share="linkedin">Post on LinkedIn</button>'
    + '<button class="btn secondary" data-share="copy">Copy summary</button> <span id="shareStatus" class="muted" role="status"></span></div>'
    + (host === "lookforit.xyz" ? '<p style="margin-top:8px"><a href="https://www.lookforit.xyz" target="_blank" rel="noopener">Open in LookForIt</a> — this site is listed in the LookForIt directory.</p>' : '')
    + '<p class="muted">Sharing posts only the summary above — no account data leaves the page.</p></div>';
}
async function copyText(t){
  try{ await navigator.clipboard.writeText(t); return true; }
  catch(e){
    try{
      const ta = document.createElement("textarea");
      ta.value = t; document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); document.body.removeChild(ta); return true;
    }catch(e2){ return false; }
  }
}
/* Copy/share confirmation goes into the status span next to the share
   buttons (same pattern as the landing hero's #heroShareNote). */
function shareStatusNote(msg){
  const st = elOrNull("shareStatus");
  if(st) st.textContent = msg;
}
async function shareAudit(kind){
  /* The share bar only renders when an audit exists, so this is near
     unreachable — a banner, never a modal, if it ever fires. */
  if(!lastAudit){ showBanner("Run an audit first, then share it.", "warn"); return; }
  const text = auditShareText(lastAudit);
  const pageUrl = "https://seoforge.syedsenterprises.org/";
  if(kind === "web"){
    if(navigator.share){
      try{ await navigator.share({ title: "SEOForge audit — " + lastAudit.site, text, url: pageUrl }); return; }
      catch(e){ if(e && e.name === "AbortError") return; }
    }
    const ok = await copyText(text + " " + pageUrl);
    shareStatusNote(ok ? "Sharing is not supported in this browser — the summary was copied instead." : "Sharing is not supported in this browser.");
    return;
  }
  if(kind === "copy"){
    const ok = await copyText(text + " " + pageUrl);
    shareStatusNote(ok ? "Audit summary copied." : "Could not copy — select the text manually.");
    return;
  }
  if(kind === "x"){
    window.open("https://twitter.com/intent/tweet?text=" + encodeURIComponent(text + " " + pageUrl), "_blank", "noopener");
    return;
  }
  if(kind === "linkedin"){
    window.open("https://www.linkedin.com/sharing/share-offsite/?url=" + encodeURIComponent(lastAudit.site), "_blank", "noopener");
    return;
  }
}
document.addEventListener("click", e => {
  const t = e.target.closest("[data-share]");
  if(t){ e.preventDefault(); shareAudit(t.dataset.share); }
});

/* ================= v2.5 features ================= */
/* Every Supabase call in this block is defensive: new tables (content_briefs,
   competitors, site_checks) and the keywords.difficulty column may not exist
   yet. A failed call logs to the console and falls back to localStorage —
   the page never breaks because a table is missing. */

/* ---------- export helpers ---------- */
function downloadFile(filename, text, mime){
  const blob = new Blob([text], {type: mime || "text/plain"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const csvCell = SEOForgeCore.csvCell;

function downloadCSV(filename, header, rows){
  const lines = [header.map(csvCell).join(",")].concat(rows.map(r => r.map(csvCell).join(",")));
  downloadFile(filename, lines.join("\r\n"), "text/csv");
}

/* ---------- v2.5 free-plan usage ---------- */
function v25Usage(){
  if(currentUser && cloudUsage) return cloudUsage;
  const m = thisMonthPrefix();
  const briefsUsed = S.get("briefs", []).filter(b => (b.date||"").indexOf(m)===0).length;
  /* Compares are counted by RUNS, not by stored competitor rows: a compare
     saves only its fresh URLs (one new + one already-tracked URL saves a
     single row), so deriving runs from rows undercounts. runCompare records
     one "compare" tool check per run; "compare" rows are excluded from the
     tool-checks limit count so the two limits stay independent. */
  const checks = S.get("toolChecks", []).filter(t => (t.date||"").indexOf(m)===0);
  const comparesUsed = checks.filter(t => t.type==="compare").length;
  const toolChecksUsed = checks.filter(t => t.type!=="compare").length;
  return { briefsUsed, comparesUsed, toolChecksUsed };
}
function limitBlocked(outEl, used, limit, what){
  outEl.innerHTML = '<div class="warn"><b>Free plan limit reached.</b> You have used ' + used + ' of ' + limit + ' ' + what + ' this month. <button class="btn small" data-action="upgrade">Upgrade to Pro — $9/month</button> for unlimited use.</div>';
}
function checkToolLimit(outEl){
  if(isAdmin() || S.mode!=='cloud' || isPaidPlan()) return true;
  const used = v25Usage().toolChecksUsed;
  if(used >= PLAN_LIMITS.toolChecksPerMonth){ limitBlocked(outEl, used, PLAN_LIMITS.toolChecksPerMonth, "tool checks"); return false; }
  return true;
}
function checkBriefLimit(outEl){
  if(isAdmin() || S.mode!=='cloud' || isPaidPlan()) return true;
  const used = v25Usage().briefsUsed;
  if(used >= PLAN_LIMITS.briefsPerMonth){ limitBlocked(outEl, used, PLAN_LIMITS.briefsPerMonth, "content briefs"); return false; }
  return true;
}
function checkCompareLimit(outEl){
  if(isAdmin() || S.mode!=='cloud' || isPaidPlan()) return true;
  const used = v25Usage().comparesUsed;
  if(used >= PLAN_LIMITS.comparesPerMonth){ limitBlocked(outEl, used, PLAN_LIMITS.comparesPerMonth, "competitor compares"); return false; }
  return true;
}
async function recordToolCheck(type, url, summary){
  const rec = { date:todayISO(), type, url, summary:summary||"" };
  if(S.mode === "cloud"){
    const { data, error } = await sb.from("site_checks").insert({user_id:currentUser.id, check_type:type, url, result:{summary:rec.summary}}).select("id").single();
    if(error) throw new Error("Result could not be saved: " + error.message);
    rec.id = data.id; S.cache.toolChecks.unshift(rec);
  } else LS.set("toolChecks", [rec].concat(LS.get("toolChecks", [])).slice(0,100));
  renderLimitNotes();
}

/* ---------- shared live-page helpers ---------- */
async function fetchPageDoc(url, timeoutMs, scope){
  const r = await fetchViaProxy(url, timeoutMs||20000, scope);
  if(!r.status || r.status < 200 || r.status >= 300) throw new Error("Page fetch failed (HTTP " + (r.status||"proxy error") + "). Check the URL and retry.");
  const doc = new DOMParser().parseFromString(r.text, "text/html");
  return { doc, status:r.status, text:r.text, ttfbMs:r.ttfbMs, totalMs:r.totalMs, bytes:r.bytes, compressed:r.compressed, headers:r.headers||null };
}
function pageWordCount(doc){
  const body = doc.body; if(!body) return 0;
  const clone = body.cloneNode(true);
  clone.querySelectorAll("script,style,noscript,svg").forEach(n => n.remove());
  return (clone.textContent||"").trim().split(/\s+/).filter(Boolean).length;
}
/* ---------- SERP sources: Bing first, DuckDuckGo last (Brave excluded) ---------- */
/* Why Bing first: DuckDuckGo's html endpoint returns HTTP 202 with a block page
   (zero result links) to our server-side fetch-proxy — a datacenter-IP block,
   proven 23 Nov 2026 (direct curl from a normal IP returns 11 results).
   Bing via the same proxy returns HTTP 200 with 10 li.b_algo blocks.
   Brave was tested the same way and is NOT usable: it returns 200 but hides
   every destination behind opaque /go/v1/<token> redirect URLs with no
   data-url, so no real URL can be recovered — it is deliberately not a source.
   Parsers below are pure string functions (no DOMParser) so they are unit
   testable in Node. */
function b64urlDecode(s){
  let t = String(s||"").replace(/-/g,"+").replace(/_/g,"/").replace(/[^A-Za-z0-9+/=]/g,"");
  while(t.length % 4) t += "=";
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const idx = c => A.indexOf(c);
  const bytes = [];
  for(let i=0;i<t.length;i+=4){
    const g = t.slice(i, i+4);
    const pad = (g.match(/=+$/)||[""])[0].length;
    const v = [idx(g[0]), idx(g[1]), g[2]==="="?0:idx(g[2]), g[3]==="="?0:idx(g[3])];
    const n = (v[0]<<18)|(v[1]<<12)|(v[2]<<6)|v[3];
    bytes.push((n>>16)&255);
    if(pad<2) bytes.push((n>>8)&255);
    if(pad<1) bytes.push(n&255);
  }
  let str = "";
  for(const b of bytes) str += "%" + b.toString(16).padStart(2,"0");
  try{ return decodeURIComponent(str); }catch(e){ return ""; }
}
/* Bing hides the real URL in the u= param of a /ck/a redirect link, base64url
   encoded with a 2-character prefix ("a1") — e.g.
   u=a1aHR0cHM6Ly9idWlsdGluLmNvbS9hcnRpZmljaWFsLWludGVsbGlnZW5jZS9haS10b29scw
   decodes (after stripping "a1") to https://builtin.com/artificial-intelligence/ai-tools.
   Tries the raw value first, then the value with the 2-char prefix stripped;
   returns "" when neither decodes to an http(s) URL. A direct http(s) href
   that is not on bing.com passes through untouched. */
function decodeBingUrl(href){
  if(!href) return "";
  /* Bing's raw HTML escapes ampersands in hrefs (&amp;). new URL() must see
     the real "&" — with "&amp;" intact, searchParams.get("u") misses (the
     param reads as "amp;u"), the decoder returns "", and the caller falls
     back to the cite text, which produced "https://https://…" URLs. */
  href = String(href).replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">");
  try{
    const u = new URL(href, "https://www.bing.com");
    if(u.hostname !== "www.bing.com" && u.hostname !== "bing.com") return /^https?:\/\//i.test(href) ? href : "";
    const enc = u.searchParams.get("u");
    if(!enc) return "";
    for(const cand of [enc, enc.slice(2)]){
      const decoded = b64urlDecode(cand);
      if(!/^https?:\/\//i.test(decoded)) continue;
      try{ const du = new URL(decoded); if(du.hostname && du.hostname !== "https" && du.hostname !== "http") return decoded; }
      catch(e){ /* malformed decoded value — try the next candidate */ }
    }
    return "";
  }catch(e){ return /^https?:\/\//i.test(href) ? href : ""; }
}
function stripTags(s){ return String(s||"").replace(/<[^>]+>/g,"").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").trim(); }
function parseBingResults(html, n){
  const out = [];
  const blocks = String(html||"").match(/<li\b[^>]*\bb_algo\b[^>]*>[\s\S]*?<\/li>/gi) || [];
  for(const b of blocks){
    if(out.length >= n) break;
    const m = /<h2\b[^>]*>\s*<a\b([^>]*)>([\s\S]*?)<\/a>/i.exec(b);
    if(!m) continue;
    const hrefM = /href="([^"]+)"/i.exec(m[1]||"");
    if(!hrefM) continue;
    let url = decodeBingUrl(hrefM[1]);
    if(!url){
      /* Fallback: rebuild from the <cite> display text
         ("example.com › path › page" -> https://example.com/path/page).
         Bing's cite text often already includes the scheme
         ("https://example.com › path") and is sometimes truncated with "…" —
         blindly prepending "https://" produced "https://https://…" URLs and
         URLs containing "…". Strip any scheme first, reject a truncated
         cite outright (its URL is unknowable), and validate the result has
         a real hostname. */
      const cite = /<cite\b[^>]*>([\s\S]*?)<\/cite>/i.exec(b);
      if(cite){
        const parts = stripTags(cite[1]).split(/\s*›\s*/).map(s=>s.trim()).filter(Boolean);
        if(parts.length && !parts.some(s=>s.includes("…"))){
          const joined = parts.join("/").replace(/^https?:\/\//i,"");
          try{
            const cand = new URL("https://" + joined);
            if(cand.hostname && cand.hostname !== "https" && cand.hostname !== "http") url = "https://" + joined;
          }catch(e){ /* not a usable URL — leave url empty, block is skipped */ }
        }
      }
    }
    const title = stripTags(m[2]);
    if(/^https?:\/\//i.test(url) && title) out.push({url, title});
  }
  return out;
}
function parseDdgResults(html, n){
  const out = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while((m = re.exec(String(html||""))) && out.length < n){
    if(!/\bresult__a\b/.test(m[1]||"")) continue;
    const hrefM = /href="([^"]+)"/i.exec(m[1]||"");
    if(!hrefM) continue;
    let href = hrefM[1];
    const u = href.match(/[?&]uddg=([^&]+)/);
    if(u){ try{ href = decodeURIComponent(u[1]); }catch(e){} }
    const title = stripTags(m[2]);
    if(/^https?:\/\//i.test(href) && title) out.push({url: href, title});
  }
  return out;
}
/* Relevance guard for parsed SERP results: for a query with no real matches
   Bing serves generic trending pages, query-independent (proven 24 Nov 2026:
   "SEOForge" returned Hyundai Tucson / Tbilisi travel / KB Home, rotating per
   request, while established keywords return real results). Presenting those
   as the keyword's ranking pages would be a false report. At least one
   result's title or URL must contain a significant token from the keyword.
   Significant = lowercased, split on non-alphanumerics, 3+ chars, not a
   question/stopword. A total mismatch means the source served trending pages,
   not results for this keyword. */
const SERP_STOPWORDS = ["best","top","free","how","what","why","when","where","who"];
function serpKeywordTokens(keyword){
  return String(keyword||"").toLowerCase().split(/[^a-z0-9]+/).filter(t=>t.length>=3 && !SERP_STOPWORDS.includes(t));
}
function serpResultsMatchKeyword(results, keyword){
  const tokens = serpKeywordTokens(keyword);
  if(!tokens.length) return true; /* nothing significant to check against */
  const hay = results.map(r=>((r.title||"")+" "+(r.url||"")).toLowerCase()).join(" ");
  return tokens.some(t=>hay.includes(t));
}
/* Multi-source top results: Bing first, DuckDuckGo as last resort. Each
   source is tried in turn; a source that returns no parseable results (e.g.
   DuckDuckGo's 202 block page) simply falls through to the next. Throws only
   when every source fails. */
async function serpTopResults(keyword, n, timeoutMs){
  const q = encodeURIComponent(keyword);
  const sources = [
    { name:"Bing", url:"https://www.bing.com/search?q="+q, parse:parseBingResults },
    { name:"DuckDuckGo", url:"https://html.duckduckgo.com/html/?q="+q, parse:parseDdgResults }
  ];
  let lastErr = null;
  let irrelevant = false;
  for(const s of sources){
    try{
      const res = await fetchViaProxy(s.url, timeoutMs||20000);
      /* A non-2xx body is a block/error page, not results — never parse it
         as if it were a results page. */
      if(res.status && (res.status < 200 || res.status >= 300)) throw new Error("No results could be parsed from " + s.name + " (HTTP " + res.status + ") — it may be blocking automated requests.");
      const out = s.parse(res.text, n);
      if(out.length){
        if(serpResultsMatchKeyword(out, keyword)) return out;
        /* Results parsed but about something else entirely (Bing's trending
           fallback for queries with no real matches) — never present them as
           this keyword's rankings. Try the next source; if none matches,
           the throw below says so plainly. */
        irrelevant = true;
        continue;
      }
      lastErr = new Error("No results could be parsed from " + s.name + " — it may be blocking automated requests.");
    }catch(e){ lastErr = e; }
  }
  if(irrelevant) throw new Error("No verifiable ranking data for \"" + keyword + "\" — the search results returned do not relate to this keyword.");
  throw lastErr || new Error("Search results unavailable or blocked; no ranking can be inferred.");
}

/* ---------- 1. SERP Preview + Meta/OG checker ---------- */
async function runSerp(){
  const btn = $("serpBtn"); if(btn.disabled) return; btn.disabled = true;
  const out = $("serpOut"), prog = $("serpProg");
  out.innerHTML = ""; prog.textContent = "Fetching page…";
  const url = normaliseSite($("serpUrl").value);
  if(!url){ out.innerHTML = '<div class="err">Enter a page URL first.</div>'; prog.textContent=""; btn.disabled = false; return; }
  out.innerHTML = skeletonHtml(3);
  try{
    const { doc } = await fetchPageDoc(url);
    const title = ((doc.querySelector("title")||{}).textContent||"").trim();
    const meta = name => { const el = doc.querySelector('meta[name="'+name+'"], meta[property="'+name+'"]'); return el ? (el.getAttribute("content")||"") : ""; };
    const desc = meta("description");
    const og = { title: meta("og:title"), description: meta("og:description"), image: meta("og:image"), type: meta("og:type") };
    const tw = { card: meta("twitter:card"), title: meta("twitter:title"), description: meta("twitter:description"), image: meta("twitter:image") };
    const dispUrl = url.replace(/^https?:\/\//,"");
    const gTitle = title || "(no title tag)";
    const gDesc = desc || "(no meta description — Google will pick text from the page instead)";
    const ogImg = og.image || tw.image || "";
    let html = '<div class="g-preview"><div class="g-url">' + esc(dispUrl) + '</div><div class="g-title">' + esc(gTitle.length>60 ? gTitle.slice(0,57)+"…" : gTitle) + '</div><div class="g-desc">' + esc(gDesc.length>160 ? gDesc.slice(0,157)+"…" : gDesc) + '</div><p class="muted">Google preview — title ' + title.length + ' characters (ideal 30–60), description ' + desc.length + ' characters (ideal 120–160).</p></div>';
    html += '<div class="soc-card">' + (ogImg ? '<img src="' + esc(ogImg) + '" alt="" onerror="this.style.display=\'none\'">' : '<div class="note">No og:image / twitter:image found — shares will show no image.</div>') + '<div class="soc-body"><div class="soc-host">' + esc(new URL(url).hostname) + '</div><div class="soc-title">' + esc(og.title || tw.title || title || "(no social title)") + '</div><div class="soc-desc">' + esc(og.description || tw.description || desc || "(no social description)") + '</div></div></div>';
    const rows = [["title", title],["meta description", desc],["og:title", og.title],["og:description", og.description],["og:image", og.image],["og:type", og.type],["twitter:card", tw.card],["twitter:title", tw.title],["twitter:description", tw.description],["twitter:image", tw.image]];
    html += '<h3>Tags found</h3><div style="overflow-x:auto"><table><tr><th>Tag</th><th>Value</th></tr>' + rows.map(r => '<tr><td>' + esc(r[0]) + '</td><td>' + (r[1] ? esc(r[1]) : '<span class="muted">missing</span>') + '</td></tr>').join("") + '</table></div>';
    out.innerHTML = html;
    prog.textContent = "";
  }catch(e){
    out.innerHTML = '<div class="err"><b>Preview failed:</b> ' + esc(e.message||e) + '</div>'; prog.textContent = "";
  }finally{ btn.disabled = false; }
}
$("serpBtn").addEventListener("click", runSerp);

/* ---------- 2. Broken Link Checker ---------- */
async function runBrokenLinks(){
  const btn = $("blBtn"); if(btn.disabled) return; btn.disabled = true;
  const out = $("blOut"), prog = $("blProg");
  out.innerHTML = ""; prog.textContent = "";
  const page = normaliseSite($("blUrl").value);
  if(!page){ out.innerHTML = '<div class="err">Enter a page URL first.</div>'; btn.disabled = false; return; }
  if(!checkToolLimit(out)){ btn.disabled = false; return; }
  out.innerHTML = skeletonHtml(3);
  prog.textContent = "Fetching " + page + " …";
  try{
    const { doc } = await fetchPageDoc(page);
    const seen = new Map();
    doc.querySelectorAll("a[href]").forEach(a => {
      const href = a.getAttribute("href")||"";
      if(!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) return;
      let abs;
      try{ abs = new URL(href, page).toString(); }catch(e){ return; }
      if(!seen.has(abs)) seen.set(abs, (a.textContent||"").trim().slice(0,80));
    });
    let links = [...seen.entries()].map(([url, anchor]) => ({url, anchor}));
    const totalFound = links.length;
    links = links.slice(0, 100);
    prog.textContent = "Found " + totalFound + " links" + (totalFound>100 ? " — checking the first 100" : "") + ". Checking each one …";
    const results = new Array(links.length);
    const BATCH = 5;
    for(let i=0;i<links.length;i+=BATCH){
      await Promise.all(links.slice(i, i+BATCH).map(async (l, j) => {
        try{
          const r = await fetchViaProxy(l.url, 10000);
          results[i+j] = { url:l.url, anchor:l.anchor, status: r.status, ok: r.ok, rateLimited: r.status===429, proxyErr: false };
        }catch(e){ results[i+j] = { url:l.url, anchor:l.anchor, status: null, ok: false, proxyErr: true, err: String(e.message||e) }; }
      }));
      prog.textContent = "Checked " + Math.min(i+BATCH, links.length) + " of " + links.length + " links …";
    }
    const broken = results.filter(r => !r.ok && !r.proxyErr && !r.rateLimited);
    const rateLimited = results.filter(r => r.rateLimited);
    const unverified = results.filter(r => r.proxyErr);
    const okN = results.filter(r => r.ok).length;
    let html = '<p><span class="pill ok">' + okN + ' OK</span> <span class="pill bad">' + broken.length + ' broken</span>' + (rateLimited.length ? ' <span class="pill warn">' + rateLimited.length + ' rate-limited (429)</span>' : '') + ' <span class="pill warn">' + unverified.length + ' unverified (proxy error)</span></p>'
      + measuredLine('each link on the page was fetched live — the status is the real HTTP status the link returned; click any link to open it yourself');
    html += '<button class="btn secondary" id="blCsvBtn">Export results (CSV)</button>';
    html += '<div style="overflow-x:auto"><table><tr><th>Link</th><th>Status</th><th>Anchor</th></tr>' + results.map(r => {
      const pill = r.ok ? '<span class="pill ok">OK ' + r.status + '</span>' : r.proxyErr ? '<span class="pill warn">Unverified</span>' : r.rateLimited ? '<span class="pill warn">Rate-limited 429</span>' : '<span class="pill bad">Broken ' + (r.status||"") + '</span>';
      const note = r.proxyErr ? ' <span class="muted">free proxy could not reach it</span>' : r.rateLimited ? ' <span class="muted">the site throttled the check — retry later, not a broken link</span>' : '';
      return '<tr><td><a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.url) + '</a></td><td>' + pill + note + '</td><td>' + esc(r.anchor||"") + '</td></tr>';
    }).join("") + '</table></div>';
    out.innerHTML = html;
    $("blCsvBtn").addEventListener("click", () => downloadCSV("seoforge-broken-links.csv", ["url","status","anchor"], results.map(r => [r.url, r.ok ? ("OK " + r.status) : r.proxyErr ? "Unverified" : r.rateLimited ? "Rate-limited 429" : ("Broken " + (r.status||"")), r.anchor||""])));
    prog.textContent = "";
    try{ await recordToolCheck("broken-links", page, okN + " OK, " + broken.length + " broken, " + rateLimited.length + " rate-limited, " + unverified.length + " unverified of " + links.length + " checked"); }
    catch(e){ out.innerHTML += '<div class="warn">Result shown above, but it could not be saved to your history: ' + esc(e.message||e) + '</div>'; }
  }catch(e){
    out.innerHTML = '<div class="err"><b>Check failed:</b> ' + esc(e.message||e) + '</div>'; prog.textContent = "";
  }finally{ btn.disabled = false; }
}
$("blBtn").addEventListener("click", runBrokenLinks);

/* ---------- 3. Redirect Chain Checker ---------- */
async function runRedirects(){
  const btn = $("rdBtn"); if(btn.disabled) return; btn.disabled = true;
  const out = $("rdOut"), prog = $("rdProg");
  out.innerHTML = ""; prog.textContent = "";
  const start = normaliseSite($("rdUrl").value);
  if(!start){ out.innerHTML = '<div class="err">Enter a URL first.</div>'; btn.disabled = false; return; }
  if(!checkToolLimit(out)){ btn.disabled = false; return; }
  prog.textContent = "Following redirects…";
  const hops = [];
  let current = start;
  /* ONE total cap for the whole tool (F15): 60 s from run start covering the
     hop walk AND the allorigins supplement AND the optional PageSpeed final-
     URL check. The old 45 s cap covered the walk only, so the supplement
     (15 s) + PageSpeed (120 s) could push the tool to ~3 min. Every leg
     clamps its own timeout to the time remaining. */
  const deadline = Date.now() + 60000;
  try{
    for(let hop=0; hop<10 && Date.now() < deadline; hop++){
      let moved = false, finished = false;
      for(const p of PROXIES){
        if(Date.now() >= deadline) break;
        try{
          const c = new AbortController();
          const t = setTimeout(() => c.abort(), Math.max(1000, Math.min(12000, deadline - Date.now())));
          let res;
          try{ res = await fetch(p(current), { signal: c.signal, redirect: "manual" }); }
          finally{ clearTimeout(t); }
          /* A 5xx from a free proxy is usually the PROXY failing, not the
             target — recognise its error page and try the next proxy instead
             of recording the proxy's 500 as the site's status. */
          if(res.status >= 500){
            let t2 = "";
            try{ t2 = await res.text(); }catch(e){}
            if(isProxyErrorPage(res.status, t2)) continue;
          }
          if(res.status===522 || res.status===408) continue;
          const loc = res.headers.get("location");
          if(res.status >= 300 && res.status < 400 && loc){
            let next;
            try{ next = new URL(loc, current).toString(); }catch(e){ next = loc; }
            hops.push({ from: current, status: res.status, to: next });
            current = next; moved = true;
          }else if(res.status >= 300 && res.status < 400){
            hops.push({ from: current, status: res.status, to: null, note: "redirect, but the proxy did not expose the destination" });
            finished = true;
          }else{
            hops.push({ from: current, status: res.status, to: null, note: "final response — the proxy followed the redirect(s) on its server" });
            finished = true;
          }
          break;
        }catch(e){ /* try the next proxy */ }
      }
      if(finished || !moved) break;
    }
    /* The walk knows the final STATUS (last hop) and the final URL only when
       a hop exposed an explicit destination. A "final response" hop means the
       proxy followed redirect(s) server-side, so its final URL is unknown to
       us — never claim the fetched URL is the final one. The allorigins /get
       call below is the supplement that reports the true final URL. */
    let finalUrl = null, finalStatus = null;
    if(hops.length){
      const last = hops[hops.length-1];
      finalStatus = last.status;
      if(last.to) finalUrl = last.to;
    }
    if(!finalUrl && Date.now() < deadline){
      try{
        const r = await fetchTimeout("https://api.allorigins.win/get?url=" + encodeURIComponent(start), Math.max(1000, Math.min(15000, deadline - Date.now())));
        if(r.ok){
          const j = await r.json();
          if(j.status){ finalUrl = j.status.url || null; finalStatus = j.status.http_code || finalStatus; }
        }
      }catch(e){ /* ignore — the fallback below still reports honestly */ }
    }
    /* If the hop walk saw nothing at all, fall back to our own fetch-proxy
       (edge + public routes) so a flaky public proxy can never leave this
       tool with no result. Its status is real and measured; its final URL
       stays unknown (same server-side-follow reason) and is said so. */
    if(!hops.length && !finalUrl){
      /* The fallback is part of the 60 s cap too: past the deadline there is
         no time left to fetch, so the tool says so honestly instead of
         adding up to 15 s more. */
      if(Date.now() >= deadline){
        out.innerHTML = '<div class="err"><b>Check failed:</b> Could not follow redirects for ' + esc(start) + ' — the 60 s overall limit for this tool was reached without a result. The site may be slow or blocking automated requests; retry later.</div>';
        prog.textContent = "";
        return;
      }
      try{
        const r = await fetchViaProxy(start, Math.max(1000, Math.min(15000, deadline - Date.now())));
        finalStatus = r.status;
      }catch(e){
        out.innerHTML = '<div class="err"><b>Check failed:</b> Could not follow redirects for ' + esc(start) + ' — every fetch route failed (' + esc(e.message||e) + '). The site may block automated requests; retry later.</div>';
        prog.textContent = "";
        return;
      }
    }
    let html = "";
    if(hops.length){
      html += '<div style="overflow-x:auto"><table><tr><th>#</th><th>From</th><th>Status</th><th>To</th></tr>' + hops.map((h, i) =>
        '<tr><td>' + (i+1) + '</td><td>' + esc(h.from) + '</td><td>' + (h.status==null ? "—" : h.status) + '</td><td>' + (h.to ? esc(h.to) : '<span class="muted">' + esc(h.note||"final response") + '</span>') + '</td></tr>').join("") + '</table></div>';
    }
    if($("rdPsi").checked){
      /* The PSI leg is clamped to the time left on the cap (and skipped when
         under 5 s remain — a PageSpeed call cannot finish in that window, so
         starting it would only blow the cap). */
      if(Date.now() >= deadline || deadline - Date.now() < 5000){
        html += '<div class="warn">PageSpeed final-URL check skipped — the 60 s overall limit for this tool was reached.</div>';
      }else{
        try{
          const psi = await runPSI(start, "mobile", undefined, Math.max(5000, deadline - Date.now()));
          finalUrl = psi.finalUrl || finalUrl;
          html += '<p class="note">Final URL via PageSpeed: <b>' + esc(finalUrl||"not reported") + '</b></p>';
        }catch(e){
          html += '<div class="warn">PageSpeed final-URL check failed (it only counts against your monthly audits if it ran): ' + esc(e.message||e) + '</div>';
        }
      }
    }
    if(finalUrl) html += '<p><b>Final URL:</b> ' + esc(finalUrl) + (finalStatus ? ' <span class="pill ok">HTTP ' + finalStatus + '</span>' : '') + '</p>';
    else if(finalStatus) html += '<p><b>Final status:</b> <span class="pill ok">HTTP ' + finalStatus + '</span> <span class="muted">(final URL not reported — the proxy followed the redirect(s) on its own server)</span></p>';
    html += '<p class="muted">Note: free proxies follow redirects on their own servers, so intermediate hops are only shown when the proxy exposes them. If the chain above stops at one hop, the site redirected but the proxy did not report each step.</p>'
      + measuredLine('the chain was followed live hop by hop — every status is the real HTTP status the server returned, and the final URL is the real destination when it could be read');
    out.innerHTML = html;
    prog.textContent = "";
    try{
      await recordToolCheck("redirect-chain", start, hops.length + " hop(s) observed; final: " + (finalUrl||"unknown"));
    }catch(e){
      /* A save failure must never erase a good result — small warning only. */
      out.innerHTML += '<div class="warn">Result shown above, but it could not be saved to your history: ' + esc(e.message||e) + '</div>';
    }
  }catch(e){
    out.innerHTML = '<div class="err"><b>Check failed:</b> ' + esc(e.message||e) + '</div>'; prog.textContent = "";
  }finally{ btn.disabled = false; }
}
$("rdBtn").addEventListener("click", runRedirects);

/* ---------- 4. Schema / JSON-LD Detector ---------- */
async function runSchema(){
  const btn = $("scBtn"); if(btn.disabled) return; btn.disabled = true;
  const out = $("scOut"), prog = $("scProg");
  out.innerHTML = ""; prog.textContent = "";
  const url = normaliseSite($("scUrl").value);
  if(!url){ out.innerHTML = '<div class="err">Enter a page URL first.</div>'; btn.disabled = false; return; }
  if(!checkToolLimit(out)){ btn.disabled = false; return; }
  out.innerHTML = skeletonHtml(3);
  prog.textContent = "Fetching " + url + " …";
  try{
    const { doc } = await fetchPageDoc(url);
    const blocks = [];
    doc.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
      const raw = (s.textContent||"").trim();
      if(!raw) return;
      try{
        const parsed = JSON.parse(raw);
        const items = parsed["@graph"] && Array.isArray(parsed["@graph"]) ? parsed["@graph"] : [parsed];
        blocks.push({ raw, types: items.map(it => it["@type"] ? (Array.isArray(it["@type"]) ? it["@type"].join(", ") : it["@type"]) : "(no @type)").filter(Boolean) });
      }catch(e){ blocks.push({ raw, types: ["(invalid JSON — could not be parsed)"], parseError: String(e.message||e) }); }
    });
    prog.textContent = "";
    if(!blocks.length){
      out.innerHTML = '<div class="warn"><b>No JSON-LD found.</b> This page has no <code>application/ld+json</code> structured data. It may still use Microdata or RDFa, which this checker does not read.</div>';
    }else{
      const allTypes = [...new Set(blocks.flatMap(b => b.types))];
      let html = '<div class="okbox"><b>' + blocks.length + ' JSON-LD block(s) found.</b> Types: ' + esc(allTypes.join(", ")) + '</div>';
      blocks.forEach((b, i) => {
        html += '<div class="card" style="margin-top:10px"><h3>Block ' + (i+1) + ' — ' + esc(b.types.join(", ")) + '</h3>'
          + (b.parseError ? '<p class="err">Parse error: ' + esc(b.parseError) + '</p>' : '')
          + '<details><summary>Raw JSON-LD</summary><pre class="raw">' + esc(b.raw) + '</pre></details></div>';
      });
      out.innerHTML = html;
    }
    try{ await recordToolCheck("schema", url, blocks.length + " JSON-LD block(s)"); }
    catch(e){ out.innerHTML += '<div class="warn">Result shown above, but it could not be saved to your history: ' + esc(e.message||e) + '</div>'; }
  }catch(e){
    out.innerHTML = '<div class="err"><b>Check failed:</b> ' + esc(e.message||e) + '</div>'; prog.textContent = "";
  }finally{ btn.disabled = false; }
}
$("scBtn").addEventListener("click", runSchema);

/* ---------- 5. Robots.txt tester + generator, 6. Sitemap generator ---------- */
let robotsGroups = null;
function parseRobots(txt){
  const groups = [];
  let cur = null;
  txt.split(/\r?\n/).forEach(line => {
    const l = line.trim();
    if(!l || l.startsWith("#")) return;
    const m = l.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if(!m) return;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if(k === "user-agent"){ cur = { agents:[v.toLowerCase()], rules:[], sitemaps:[] }; groups.push(cur); }
    else if(cur && (k==="allow" || k==="disallow")){ cur.rules.push({ type:k, path:v }); }
    else if(cur && k==="sitemap"){ cur.sitemaps.push(v); }
  });
  return groups;
}
function robotsPathMatches(pattern, path){
  let p = pattern;
  let endAnchor = false;
  if(p.endsWith("$")){ endAnchor = true; p = p.slice(0, -1); }
  const re = new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + (endAnchor ? "$" : ""));
  return re.test(path);
}
function robotsAllows(groups, agent, path){
  const a = agent.toLowerCase();
  const g = groups.find(g => g.agents.some(x => x === a)) || groups.find(g => g.agents.includes("*"));
  if(!g) return { allowed: true, rule: null };
  let best = null;
  for(const r of g.rules){
    if(r.path === "") continue;
    if(robotsPathMatches(r.path, path)){
      if(!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.type === "allow")) best = r;
    }
  }
  if(!best) return { allowed: true, rule: null };
  return { allowed: best.type === "allow", rule: best };
}
async function runRobotsFetch(){
  const btn = $("rbFetchBtn"); if(btn.disabled) return; btn.disabled = true;
  const out = $("rbOut"), prog = $("rbProg");
  out.innerHTML = ""; $("rbTest").hidden = true; robotsGroups = null;
  const site = normaliseSite($("rbSite").value);
  if(!site){ out.innerHTML = '<div class="err">Enter a site URL first.</div>'; btn.disabled = false; return; }
  if(!checkToolLimit(out)){ btn.disabled = false; return; }
  prog.textContent = "Fetching robots.txt…";
  try{
    const { text, status } = await fetchViaProxy(site + "/robots.txt", 15000);
    if(status === 404){
      out.innerHTML = '<div class="warn"><b>No robots.txt found</b> (HTTP 404 at ' + esc(site) + '/robots.txt). That means everything is allowed to crawlers.</div>';
      robotsGroups = []; $("rbTest").hidden = false;
      try{ await recordToolCheck("robots", site, "no robots.txt (404)"); }
      catch(e){ out.innerHTML += '<div class="warn">Result shown above, but it could not be saved to your history: ' + esc(e.message||e) + '</div>'; }
      return;
    }
    if(!status || status < 200 || status >= 300) throw new Error("robots.txt fetch failed (HTTP " + (status||"proxy error") + "). The site may be blocking automated requests — nothing below is from the real robots.txt.");
    robotsGroups = parseRobots(text);
    const sm = [];
    robotsGroups.forEach(g => (g.sitemaps||[]).forEach(s => sm.push(s)));
    out.innerHTML = '<p><span class="pill ok">robots.txt found</span> ' + (sm.length ? 'Sitemaps listed: ' + esc(sm.join(", ")) : 'No sitemap listed in robots.txt.') + '</p><pre class="raw">' + esc(text.slice(0, 8000)) + '</pre>';
    $("rbTest").hidden = false;
    try{ await recordToolCheck("robots", site, "robots.txt fetched (" + text.length + " chars)"); }
    catch(e){ out.innerHTML += '<div class="warn">Result shown above, but it could not be saved to your history: ' + esc(e.message||e) + '</div>'; }
  }catch(e){
    out.innerHTML = '<div class="err"><b>Fetch failed:</b> ' + esc(e.message||e) + '</div>';
  }finally{
    prog.textContent = "";
    btn.disabled = false;
  }
}
function robotsTest(){
  const out = $("rbTestOut");
  const agent = ($("rbAgent").value||"*").trim() || "*";
  let path = ($("rbPath").value||"/").trim();
  if(!path.startsWith("/")) path = "/" + path;
  if(!robotsGroups){ out.innerHTML = '<div class="err">Fetch a robots.txt first.</div>'; return; }
  const res = robotsAllows(robotsGroups, agent, path);
  out.innerHTML = res.allowed
    ? '<div class="okbox"><b>ALLOWED</b> — ' + esc(agent) + ' may crawl <b>' + esc(path) + '</b>.' + (res.rule ? ' Matched rule: <code>' + esc(res.rule.type + ": " + res.rule.path) + '</code>.' : ' No matching rule — allowed by default.') + '</div>'
    : '<div class="warn"><b>BLOCKED</b> — ' + esc(agent) + ' may <b>not</b> crawl <b>' + esc(path) + '</b>. Matched rule: <code>' + esc(res.rule.type + ": " + res.rule.path) + '</code>.</div>';
}
function runRobotsGen(){
  const lines = ["User-agent: *"];
  if($("rgAdmin").checked) lines.push("Disallow: /admin/");
  if($("rgWp").checked) lines.push("Disallow: /wp-admin/");
  if($("rgSearch").checked) lines.push("Disallow: /search");
  const sm = ($("rgSitemap").value||"").trim();
  if(sm) lines.push("", "Sitemap: " + sm);
  const txt = lines.join("\n") + "\n";
  $("rgOut").innerHTML = '<pre class="raw">' + esc(txt) + '</pre><div class="row"><button class="btn secondary" id="rgCopyBtn">Copy</button><button class="btn secondary" id="rgDlBtn">Download robots.txt</button></div><p class="muted">Upload this as robots.txt at your site root. It only controls well-behaved crawlers (Google, Bing) — it does not block scrapers.</p>';
  $("rgCopyBtn").addEventListener("click", () => { if(navigator.clipboard) navigator.clipboard.writeText(txt); });
  $("rgDlBtn").addEventListener("click", () => downloadFile("robots.txt", txt, "text/plain"));
}
async function runSitemapGen(){
  const btn = $("smBtn"); if(btn.disabled) return; btn.disabled = true;
  const out = $("smOut"), prog = $("smProg");
  out.innerHTML = ""; prog.textContent = "";
  const site = normaliseSite($("smSite").value);
  if(!site){ out.innerHTML = '<div class="err">Enter a site URL first.</div>'; btn.disabled = false; return; }
  if(!checkToolLimit(out)){ btn.disabled = false; return; }
  prog.textContent = "Fetching homepage…";
  try{
    const { doc } = await fetchPageDoc(site);
    const host = new URL(site).hostname;
    const urls = new Set([site]);
    doc.querySelectorAll("a[href]").forEach(a => {
      const href = a.getAttribute("href")||"";
      if(!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) return;
      try{
        const u = new URL(href, site);
        if(u.hostname === host && (u.protocol === "http:" || u.protocol === "https:")){
          u.hash = "";
          urls.add(u.toString());
        }
      }catch(e){}
    });
    const list = [...urls].slice(0, 50);
    /* No <lastmod>: the generator never reads any page's real modification
       date, so stamping every URL as modified today would be invented data
       handed to search engines. <lastmod> is optional in the sitemap spec. */
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
      + list.map(u => '  <url><loc>' + esc(u) + '</loc></url>').join("\n")
      + '\n</urlset>\n';
    out.innerHTML = '<div class="okbox"><b>' + list.length + ' internal URL(s) found</b> on the homepage' + (urls.size > 50 ? ' (showing the first 50)' : '') + '. Only links from the homepage are included — deeper pages are not crawled.</div>'
      + '<pre class="raw">' + esc(xml) + '</pre>'
      + '<div class="row"><button class="btn secondary" id="smCopyBtn">Copy XML</button><button class="btn" id="smDlBtn">Download sitemap.xml</button></div>';
    $("smCopyBtn").addEventListener("click", () => { if(navigator.clipboard) navigator.clipboard.writeText(xml); });
    $("smDlBtn").addEventListener("click", () => downloadFile("sitemap.xml", xml, "application/xml"));
    prog.textContent = "";
    try{ await recordToolCheck("sitemap", site, list.length + " internal URLs"); }
    catch(e){ out.innerHTML += '<div class="warn">Result shown above, but it could not be saved to your history: ' + esc(e.message||e) + '</div>'; }
  }catch(e){
    out.innerHTML = '<div class="err"><b>Generation failed:</b> ' + esc(e.message||e) + '</div>'; prog.textContent = "";
  }finally{ btn.disabled = false; }
}
$("rbFetchBtn").addEventListener("click", runRobotsFetch);
$("rbTestBtn").addEventListener("click", robotsTest);
$("rgBtn").addEventListener("click", runRobotsGen);
$("smBtn").addEventListener("click", runSitemapGen);

/* ---------- 7. Keyword Difficulty estimator ---------- */
const AUTHORITY_DOMAINS = ["wikipedia.org","amazon.com","amazon.in","youtube.com","google.com","facebook.com","instagram.com","reddit.com","medium.com","forbes.com","nytimes.com","bbc.com","bbc.co.uk","linkedin.com","twitter.com","x.com","quora.com","stackoverflow.com","github.com","apple.com","microsoft.com","adobe.com","shopify.com","hubspot.com","moz.com","semrush.com","ahrefs.com","neilpatel.com","searchengineland.com","healthline.com","webmd.com","mayoclinic.org","investopedia.com","nerdwallet.com","bankrate.com","cnet.com","techcrunch.com","theverge.com","wired.com","coursera.org","udemy.com","khanacademy.org","etsy.com","ebay.com","walmart.com","target.com","theguardian.com","cnn.com"];
async function estimateDifficulty(keyword){
  const results = await serpTopResults(keyword, 10);
  if(!results.length) throw new Error("No search results returned for that keyword.");
  const kw = keyword.toLowerCase();
  let authority = 0, exact = 0, govEdu = 0;
  const domains = results.map(r => {
    let host = "";
    try{ host = normHost(new URL(r.url).hostname); }catch(e){}
    if(AUTHORITY_DOMAINS.includes(host)) authority++;
    if(/\.(gov|edu|ac\.uk|gov\.uk)$/.test(host)) govEdu++;
    if((r.title||"").toLowerCase().includes(kw)) exact++;
    return host;
  });
  let score = 10 + 7*authority + 5*exact + 6*govEdu;
  score = Math.max(5, Math.min(95, score));
  const label = score < 30 ? "Easy" : score <= 60 ? "Medium" : "Hard";
  return { score, label, authority, exact, govEdu, domains };
}

/* ---------- 8. Content Brief generator ---------- */
function briefHtml(b){
  let html = '<div class="card" style="margin-top:10px"><h3>Content brief — “' + esc(b.keyword) + '”</h3>';
  html += b.targetWordCount ? '<p>Target length: <b>about ' + b.targetWordCount + ' words</b> (median of the top-ranking pages, rounded up — an estimate, not a rule).</p>' : '<p class="muted">Target length could not be estimated — the top pages could not be read.</p>';
  if(b.headings.length) html += '<h3>Suggested headings (from the top pages’ H2s)</h3><ul>' + b.headings.map(h => '<li>' + esc(h) + '</li>').join("") + '</ul>';
  if(b.questions.length) html += '<h3>Questions to answer (real Google suggestions)</h3><ul>' + b.questions.map(q => '<li>' + esc(q) + '</li>').join("") + '</ul>';
  html += '<h3>Pages to beat</h3><table><tr><th>Page</th><th>H1 / title</th><th>Words (est.)</th></tr>' + b.competitors.map(p => '<tr><td>' + esc(p.url) + '</td><td>' + esc(p.words==null ? "could not read" : (p.h1 || p.serpTitle || "—")) + '</td><td>' + (p.words==null ? "could not read" : p.words.toLocaleString("en-GB")) + '</td></tr>').join("") + '</table></div>';
  return html;
}
function briefText(b){
  const lines = ["SEOForge content brief", "Keyword: " + b.keyword, ""];
  if(b.targetWordCount) lines.push("Target length: about " + b.targetWordCount + " words (median of top pages, rounded up — estimate).", "");
  if(b.headings.length){ lines.push("Suggested headings:"); b.headings.forEach(h => lines.push("- " + h)); lines.push(""); }
  if(b.questions.length){ lines.push("Questions to answer:"); b.questions.forEach(q => lines.push("- " + q)); lines.push(""); }
  lines.push("Pages to beat:");
  b.competitors.forEach(p => lines.push("- " + p.url + " — " + (p.words==null ? "could not read" : (p.h1 || p.serpTitle || "")) + (p.words!=null ? " (" + p.words + " words, est.)" : "")));
  return lines.join("\n");
}
async function recordBrief(keyword, brief){
  const rec = { date: todayISO(), keyword, brief };
  if(S.mode === "cloud"){
    const { data, error } = await sb.from("content_briefs").insert({user_id:currentUser.id, keyword, brief}).select("id").single();
    if(error){ showBanner("Brief was not saved: " + error.message, "warn"); return false; }
    rec.id = data.id; S.cache.briefs.unshift(rec); return true;
  }
  LS.set("briefs", [rec].concat(LS.get("briefs", [])).slice(0,100)); return true;
}

async function runBrief(){
  const btn = $("brBtn"); if(btn.disabled) return; btn.disabled = true;
  const out = $("brOut"), prog = $("brProg");
  out.innerHTML = ""; prog.textContent = "";
  const kw = ($("brKw").value||"").trim();
  if(!kw){ out.innerHTML = '<div class="err">Enter a target keyword first.</div>'; btn.disabled = false; return; }
  if(!checkBriefLimit(out)){ btn.disabled = false; return; }
  out.innerHTML = skeletonHtml(3);
  prog.textContent = "Finding the top 5 pages for “" + kw + "” …";
  try{
    const top = await serpTopResults(kw, 5);
    if(!top.length) throw new Error("No search results returned for that keyword.");
    const pages = [];
    for(let i=0;i<top.length;i++){
      prog.textContent = "Reading page " + (i+1) + " of " + top.length + ": " + top[i].url + " …";
      try{
        const { doc } = await fetchPageDoc(top[i].url, 15000);
        const h1 = ((doc.querySelector("h1")||{}).textContent||"").trim();
        const h2s = [...doc.querySelectorAll("h2")].map(h => (h.textContent||"").trim()).filter(Boolean).slice(0,8);
        pages.push({ url: top[i].url, title: top[i].title, h1, h2s, words: pageWordCount(doc) });
      }catch(e){
        pages.push({ url: top[i].url, title: top[i].title, h1:"", h2s:[], words:null, error: String(e.message||e) });
      }
    }
    prog.textContent = "Pulling real question suggestions …";
    const questions = [];
    for(const qw of ["who ","what ","why ","how ","when ","where "]){
      try{
        const list = await suggestOne(qw + kw);
        list.slice(0,3).forEach(s => { if(!questions.includes(s)) questions.push(s); });
      }catch(e){ /* skip failed expansion */ }
    }
    const counts = pages.map(p => p.words).filter(w => w!=null).sort((a,b)=>a-b);
    const median = counts.length ? counts[Math.floor(counts.length/2)] : null;
    const targetWords = median ? Math.ceil(median/100)*100 : null;
    const headings = [];
    pages.forEach(p => p.h2s.forEach(h => { const t = h.toLowerCase(); if(t && !headings.some(x => x.toLowerCase()===t)) headings.push(h); }));
    const brief = { keyword: kw, targetWordCount: targetWords, headings: headings.slice(0,12), questions: questions.slice(0,10), competitors: pages.map(p => ({ url:p.url, h1:p.h1||null, serpTitle:p.title||null, words:p.words, error:p.error||null })) };
    /* An empty brief (every top page unreadable, no headings, no questions)
       is a failed brief, not a saved one — recording it as "0 headings ·
       0 questions" pretends a real brief exists. Don't save it. */
    const emptyBrief = pages.every(p=>p.words==null) && !brief.headings.length && !brief.questions.length;
    const saved = emptyBrief ? false : await recordBrief(kw, brief);
    out.innerHTML = briefHtml(brief) + '<div class="row"><button class="btn secondary" id="brTxtBtn">Export brief (.txt)</button></div>'
      + (emptyBrief ? '<p class="warn">Brief could not be built — the top pages could not be read. Nothing was saved.</p>'
        : saved ? '<p class="muted">Saved to your briefs.</p>' : '<p class="warn">This brief could not be saved to your account (cloud table missing or offline) — the text above is still yours to copy.</p>');
    $("brTxtBtn").addEventListener("click", () => downloadFile("seoforge-brief-" + kw.replace(/[^a-z0-9]+/gi,"-").toLowerCase() + ".txt", briefText(brief), "text/plain"));
    prog.textContent = "";
    renderBriefs(); renderLimitNotes();
  }catch(e){
    out.innerHTML = '<div class="err"><b>Brief failed:</b> ' + esc(e.message||e) + '</div>'; prog.textContent = "";
  }finally{ btn.disabled = false; }
}
function renderBriefs(){
  const list = S.get("briefs", []);
  $("brList").innerHTML = list.length ? list.map((b, i) =>
    '<div class="listing"><b>' + esc(b.keyword) + '</b> <span class="muted">— ' + fmtDate(b.date) + '</span><br>'
    + '<span class="muted">' + (b.brief && b.brief.targetWordCount ? 'Target ~' + b.brief.targetWordCount + ' words · ' : '') + (b.brief && b.brief.headings ? b.brief.headings.length + ' headings · ' : '') + (b.brief && b.brief.questions ? b.brief.questions.length + ' questions' : '') + '</span><br>'
    + '<button class="btn small secondary" data-view-brief="' + i + '">View</button> <button class="btn small secondary" data-dl-brief="' + i + '">Export .txt</button></div>').join("")
    : '<p class="muted">No briefs saved yet.</p>';
  $("brList").querySelectorAll("[data-view-brief]").forEach(btn => btn.addEventListener("click", () => {
    const b = S.get("briefs", [])[+btn.dataset.viewBrief];
    if(b){ $("brOut").innerHTML = briefHtml(b.brief); window.scrollTo({top:0}); }
  }));
  $("brList").querySelectorAll("[data-dl-brief]").forEach(btn => btn.addEventListener("click", () => {
    const b = S.get("briefs", [])[+btn.dataset.dlBrief];
    if(b) downloadFile("seoforge-brief-" + b.keyword.replace(/[^a-z0-9]+/gi,"-").toLowerCase() + ".txt", briefText(b.brief), "text/plain");
  }));
}
$("brBtn").addEventListener("click", runBrief);

/* ---------- 9. Competitor Compare ---------- */
async function runCompare(){
  const btn = $("cpBtn"); if(btn.disabled) return; btn.disabled = true;
  const out = $("cpOut"), prog = $("cpProg");
  out.innerHTML = ""; prog.textContent = "";
  const aUrl = normaliseSite($("cpA").value), bUrl = normaliseSite($("cpB").value);
  if(!aUrl || !bUrl){ out.innerHTML = '<div class="err">Enter both URLs first.</div>'; btn.disabled = false; return; }
  if(!checkCompareLimit(out)){ btn.disabled = false; return; }
  out.innerHTML = skeletonHtml(3);
  prog.textContent = "Comparing… (PageSpeed runs one after the other — up to a minute each)";
  const rows = [];
  for(const u of [aUrl, bUrl]){
    let psiScore = null, psiErr = null;
    try{ const p = await runPSI(u, "mobile"); psiScore = p.score; }catch(e){ psiErr = e.message||e; }
    /* Genuine-report rule: when a page cannot be read, NOTHING about it is
       measured or shown as data. The old code put the error message itself
       into `title` and then rendered "75 chars" — the error's length
       presented as the page's title length. Now title/desc/h1s/words all stay
       null and the row says "Could not read — retry" with the reason. */
    let title = null, desc = null, h1s = null, words = null, readErr = null;
    try{
      const { doc } = await fetchPageDoc(u, 15000);
      title = ((doc.querySelector("title")||{}).textContent||"").trim();
      const m = doc.querySelector('meta[name="description"]');
      desc = m ? (m.getAttribute("content")||"") : "";
      h1s = doc.querySelectorAll("h1").length;
      words = pageWordCount(doc);
    }catch(e){ readErr = e.message||e; }
    rows.push({ url: u, psiScore, psiErr, title, desc, h1s, words, readErr });
  }
  const cell = (r, key) => {
    if(key === 'psi') return r.psiScore==null ? '<span class="pill warn">Not checked</span><br><span class="muted">' + esc((r.psiErr||"").slice(0,140)) + '</span>' : '<span class="score" style="font-size:24px">' + r.psiScore + '</span><span class="muted"> /100</span>';
    if(r.readErr){
      if(key === 'title') return '<span class="pill warn">Could not read — retry</span><br><span class="muted">' + esc(r.readErr.slice(0,140)) + '</span>';
      return '<span class="muted">Could not read</span>';
    }
    if(key === 'title') return '<b>' + esc(r.title) + '</b><br><span class="muted">' + r.title.length + ' chars</span>';
    if(key === 'desc') return esc(r.desc||"(no meta description)") + '<br><span class="muted">' + r.desc.length + ' chars</span>';
    if(key === 'h1') return r.h1s + (r.h1s === 1 ? ' <span class="pill ok">exactly one</span>' : r.h1s === 0 ? ' <span class="pill bad">none</span>' : ' <span class="pill warn">more than one</span>');
    if(key === 'words') return r.words==null ? "could not read" : r.words.toLocaleString("en-GB") + " words (est.)";
    return "";
  };
  out.innerHTML = '<div style="overflow-x:auto"><table><tr><th></th><th>' + esc(rows[0].url) + '</th><th>' + esc(rows[1].url) + '</th></tr>'
    + '<tr><td><b>PageSpeed (mobile)</b></td><td>' + cell(rows[0],'psi') + '</td><td>' + cell(rows[1],'psi') + '</td></tr>'
    + '<tr><td><b>Title</b></td><td>' + cell(rows[0],'title') + '</td><td>' + cell(rows[1],'title') + '</td></tr>'
    + '<tr><td><b>Meta description</b></td><td>' + cell(rows[0],'desc') + '</td><td>' + cell(rows[1],'desc') + '</td></tr>'
    + '<tr><td><b>H1 tags</b></td><td>' + cell(rows[0],'h1') + '</td><td>' + cell(rows[1],'h1') + '</td></tr>'
    + '<tr><td><b>Word count</b></td><td>' + cell(rows[0],'words') + '</td><td>' + cell(rows[1],'words') + '</td></tr>'
    + '</table></div>' + measuredLine('each page was read live — the title, meta description, H1 count and word count above are the real values from the pages. PageSpeed is Google\u2019s API: <a href="' + esc(pagespeedVerifyUrl(rows[0].url)) + '" target="_blank" rel="noopener">verify the first score</a> · <a href="' + esc(pagespeedVerifyUrl(rows[1].url)) + '" target="_blank" rel="noopener">verify the second score</a>')
    + '<p class="muted">PageSpeed scores come from Google; the on-page numbers come from reading each page live. Word counts are estimates from visible text.</p>';
  prog.textContent = "";
  try {
    await recordCompetitors([aUrl, bUrl]);
    /* Record the run itself (see v25Usage): compares are counted by runs,
       not by the fresh rows recordCompetitors happened to insert. */
    await recordToolCheck("compare", aUrl + " vs " + bUrl, "Compared " + aUrl + " with " + bUrl);
    renderCompetitors(); renderLimitNotes();
  } catch(e) {
    out.innerHTML += '<div class="warn" role="alert"><b>Comparison not saved.</b> ' + esc(e.message) + ' The results above are available to copy, but will not survive a reload.</div>';
  } finally { btn.disabled = false; }
}
/* Competitor identity (v2.11.0): a competitor is its host+path, ignoring
   protocol, a leading www., a trailing slash and host case — "www.lookforit.xyz"
   and "lookforit.xyz" are one site, so they can never list twice. Pure, so it
   is unit testable. */
function normCompetitorKey(u){
  try{
    const s = String(u||"").trim();
    if(!s) return "";
    const norm = normaliseSite(s);
    if(!norm) return s.toLowerCase().replace(/^https?:\/\//,"").replace(/^www\./,"").replace(/\/+$/,"");
    const p = new URL(norm);
    return (p.hostname.replace(/^www\./,"") + p.pathname.replace(/\/+$/,"") + p.search).toLowerCase();
  }catch(e){ return String(u||"").trim().toLowerCase(); }
}
function dedupeCompetitors(list){
  const seen = new Set(), out = [];
  (list||[]).forEach(c => { const k = normCompetitorKey(c.url||""); if(!k || seen.has(k)) return; seen.add(k); out.push(c); });
  return out;
}
async function recordCompetitors(urls){
  /* Dedupe by normalized identity (host+path, no www/protocol/case), not by
     raw URL string — "www.lookforit.xyz" and "lookforit.xyz" in the SAME run
     used to insert as two rows. */
  const seen = new Set(), clean = [];
  urls.map(url => normaliseSite(url)).filter(Boolean).forEach(u => { const k = normCompetitorKey(u); if(!k || seen.has(k)) return; seen.add(k); clean.push(u); });
  /* Drop any URL already tracked (by normalized key) — the old code inserted
     both URLs unconditionally, so "www.lookforit.xyz" and "lookforit.xyz"
     compared on different days became two rows. */
  const existing = new Set(dedupeCompetitors(S.get("competitors", [])).map(c => normCompetitorKey(c.url)));
  const fresh = clean.filter(u => !existing.has(normCompetitorKey(u)));
  if(!fresh.length) return;
  if(S.mode === "cloud"){
    const {data,error} = await sb.from("competitors").insert(fresh.map(url=>({user_id:currentUser.id,url}))).select("*");
    if(error) throw new Error("Comparison could not be saved: " + error.message);
    S.cache.competitors.unshift(...data.map(r=>({id:r.id,date:todayISO(),url:r.url})));
  } else LS.set("competitors", fresh.map(url=>({date:todayISO(),url})).concat(LS.get("competitors",[])).slice(0,100));
}

function renderCompetitors(){
  /* Dedupe at render too, so the two existing rows ("www.lookforit.xyz" /
     "lookforit.xyz") collapse to one without any database delete. */
  const list = dedupeCompetitors(S.get("competitors", []));
  $("cpList").innerHTML = list.length ? list.slice(0,20).map(c => '<div class="listing"><b>' + esc(c.url) + '</b> <span class="muted">— ' + fmtDate(c.date) + '</span></div>').join("") : '<p class="muted">No competitors saved yet.</p>';
}
$("cpBtn").addEventListener("click", runCompare);

/* ---------- 11. Ad Revenue Estimator ---------- */
const RPM_RANGES = {
  "Finance & insurance": [10, 30],
  "Technology & software": [5, 15],
  "Health & fitness": [5, 20],
  "Real estate": [5, 15],
  "Education": [3, 10],
  "Entertainment & media": [1, 5],
  "Lifestyle & general": [2, 8]
};
function runEstimator(){
  const views = parseFloat($("estViews").value);
  const niche = $("estNiche").value;
  const out = $("estOut");
  if(isNaN(views) || views < 0){ out.innerHTML = '<div class="err">Enter your monthly pageviews (0 or more).</div>'; return; }
  const range = RPM_RANGES[niche] || [2, 8];
  const lo = range[0], hi = range[1];
  const low = views/1000*lo, high = views/1000*hi;
  const m = thisMonthPrefix();
  const logged = S.get("revenue", []).filter(e => (e.date||"").indexOf(m)===0).reduce((a,e)=>a+(+e.amount||0),0);
  out.innerHTML = '<div class="card" style="margin-top:10px"><h3>Estimate — ' + esc(niche) + '</h3>'
    + '<p><span class="score">$' + low.toFixed(2) + ' – $' + high.toFixed(2) + '</span> <span class="muted">per month</span></p>'
    + '<p class="muted">That is $' + (low*12).toFixed(2) + ' – $' + (high*12).toFixed(2) + ' per year at the same traffic.</p>'
    + '<p>How it was computed: ' + views.toLocaleString("en-GB") + ' pageviews ÷ 1,000 × $' + lo + '–$' + hi + ' RPM (typical published AdSense RPM range for ' + esc(niche) + ').</p>'
    + (logged > 0 ? '<p>You logged <b>$' + logged.toFixed(2) + '</b> of ad revenue this month. ' + (logged < low ? 'That is below the low end of this estimate — your traffic may be in lower-RPM countries, or ad placement may be leaving money on the table.' : logged > high ? 'That is above the high end of this estimate — your traffic or placement is beating the typical range.' : 'That sits inside the estimated range.') + '</p>' : '<p class="muted">You have not logged any ad revenue this month yet — log it in Ad Revenue to compare reality with this estimate.</p>')
    + '<p class="muted">Estimate only — not a promise. Real RPM depends on traffic country, ad placement, season, and network.</p></div>';
}
Object.keys(RPM_RANGES).forEach(n => { const o = document.createElement("option"); o.textContent = n; $("estNiche").appendChild(o); });
$("estBtn").addEventListener("click", runEstimator);

/* ---------- SEOForge Speed Score (our own measurement) ---------- */
/* Our own speed score — NOT Google's Lighthouse score. It scores only what we
   can measure ourselves from the fetched page: server response, page weight,
   render-blocking resources, compression/caching, images, request count. Every
   sub-score shows its raw number, so nothing is invented. True LCP/CLS need a
   real browser render, which this does not do — that is what the Google
   PageSpeed line is for. */
/* Speed Score + Health Check rules live in core.js (shared with the landing
   hero widget) — these thin wrappers keep the existing call sites and the
   vm tests unchanged. */
function extractSpeedMetrics(doc, text, timings){ return SEOForgeCore.extractSpeedMetrics(doc, text, timings); }
function scoreSpeedMetrics(m){ return SEOForgeCore.scoreSpeedMetrics(m); }
function seoforgeSpeedScore(page){
  return scoreSpeedMetrics(extractSpeedMetrics(page.doc, page.text||"", page));
}
function speedScoreHtml(sf){
  return '<div class="card" style="margin-top:10px"><h3>SEOForge Speed Score — ' + sf.score + '/100 (' + esc(sf.grade) + ')</h3>'
    + '<p class="muted">Our own measurement, not Google\u2019s Lighthouse score — measured just now (' + runStamp() + ') from the page fetched live. It measures the server response, page weight and page structure; every sub-score below shows its raw number. It does not render the page, so it cannot measure true LCP/CLS — that is what the Google PageSpeed line is for.</p>'
    + '<table><tr><th>Metric</th><th>Score</th><th>Detail</th></tr>' + sf.rows.map(r => '<tr><td><b>' + esc(r.name) + '</b></td><td>' + (r.na ? 'N/A' : r.pts + ' / ' + r.max) + '</td><td>' + esc(r.detail) + '</td></tr>').join("") + '</table></div>';
}

/* ---------- 12. SEO Health Checklist ---------- */
async function runHealth(){
  const btn = $("hcBtn"); if(btn.disabled) return; btn.disabled = true;
  const out = $("hcOut"), prog = $("hcProg");
  out.innerHTML = ""; prog.textContent = "";
  const url = normaliseSite($("hcUrl").value);
  if(!url){ out.innerHTML = '<div class="err">Enter a page URL first.</div>'; btn.disabled = false; return; }
  /* The PageSpeed check inside the health check counts as one site audit. */
  if(planLimitApplies()){
    const used = usageThisMonth().auditsUsed;
    if(used >= PLAN_LIMITS.auditsPerMonth){
      out.innerHTML = '<div class="warn"><b>Free plan limit reached.</b> The health check runs PageSpeed, which counts as a site audit — you have used ' + used + ' of ' + PLAN_LIMITS.auditsPerMonth + ' this month. <button class="btn small" data-action="upgrade">Upgrade to Pro — $9/month</button> for unlimited audits.</div>';
      btn.disabled = false; return;
    }
  }
  prog.textContent = "Reading the page…";
  out.innerHTML = skeletonHtml(3);
  try{
    const page = await fetchPageDoc(url, 20000);
    const doc = page.doc;
    const title = ((doc.querySelector("title")||{}).textContent||"").trim();
    const descEl = doc.querySelector('meta[name="description"]');
    const desc = descEl ? (descEl.getAttribute("content")||"") : "";
    const h1s = doc.querySelectorAll("h1").length;
    const imgs = [...doc.querySelectorAll("img")];
    const noAlt = imgs.filter(i => !(i.getAttribute("alt")||"").trim()).length;
    const viewport = !!doc.querySelector('meta[name="viewport"]');
    prog.textContent = "Running PageSpeed (mobile)…";
    let psiScore = null, psiErr = null, psiFinalUrl = null;
    try{ const p = await runPSI(url, "mobile"); psiScore = p.score; psiFinalUrl = p.finalUrl||null; }catch(e){ psiErr = e.message||e; }
    const sf = seoforgeSpeedScore(page);
    /* The 8 checks are computed by the shared core rule (SEOForgeCore.healthChecks)
       — the same rule the landing hero widget uses, so the free hero audit and
       this Health Check can never disagree. The final URL (after redirects)
       is passed so an https→http downgrade fails the HTTPS check (F14d). */
    const checks = SEOForgeCore.healthChecks({url, title, desc, h1s, imgs: imgs.length, noAlt, viewport, psiScore, psiErr, sfScore: sf.score, sfGrade: sf.grade, finalUrl: psiFinalUrl});
    const passed = checks.filter(c => c.pass).length;
    out.innerHTML = '<p><b>' + passed + ' of ' + checks.length + ' checks passed.</b></p>'
      + measuredLine('the live page was read — the title, meta description, H1 count, image alt text and viewport above are the real values from the page. PageSpeed is Google\u2019s API: <a href="' + esc(pagespeedVerifyUrl(url)) + '" target="_blank" rel="noopener">verify the PageSpeed score yourself</a>')
      + '<table><tr><th>Check</th><th>Result</th><th>Detail</th></tr>' + checks.map(c => {
      const pill = c.pass ? '<span class="pill ok">Pass</span>' : c.warn ? '<span class="pill warn">Check</span>' : '<span class="pill bad">Fail</span>';
      return '<tr><td><b>' + esc(c.name) + '</b></td><td>' + pill + '</td><td>' + esc(c.detail) + '</td></tr>';
    }).join("") + '</table>' + speedScoreHtml(sf);
    prog.textContent = "";
    const rec = { date: todayISO(), url, total: null, ok: null, failed: null, psi: psiScore, lcp: null, cls: null };
    /* F7: the save is wrapped — a failed insert used to throw into the outer
       catch and replace the rendered 8-check table with "Health check
       failed", although the check itself succeeded. The result stays; a
       warning is appended instead (same pattern as the N4 tools). */
    try{
      if(S.mode==='cloud'){
        const id = await cloudInsertAudit(rec);
        if(id) rec.id = id;
        S.cache.audits = [rec].concat(S.cache.audits).slice(0,20);
      }else{
        LS.set("audits", [rec].concat(LS.get("audits", [])).slice(0,20));
      }
    }catch(saveErr){
      out.innerHTML += '<div class="warn">This health check ran, but saving it failed — the result above is still valid.</div>';
    }
    renderAuditHistory(); renderLimitNotes();
  }catch(e){
    out.innerHTML = '<div class="err"><b>Health check failed:</b> ' + esc(e.message||e) + '</div>'; prog.textContent = "";
  }finally{ btn.disabled = false; }
}
$("hcBtn").addEventListener("click", runHealth);

/* ---------- 14. Bulk Audit ---------- */
async function runBulkAudit(){
  const btn = $("bkBtn"); if(btn.disabled) return; btn.disabled = true;
  const out = $("bkOut"), prog = $("bkProg");
  out.innerHTML = ""; prog.textContent = "";
  let urls = ($("bkUrls").value||"").split("\n").map(s => normaliseSite(s)).filter(Boolean).slice(0, 5);
  if(!urls.length){ out.innerHTML = '<div class="err">Enter at least one URL (one per line, max 5).</div>'; btn.disabled = false; return; }
  if(planLimitApplies()){
    const used = usageThisMonth().auditsUsed;
    const remaining = PLAN_LIMITS.auditsPerMonth - used;
    if(remaining <= 0){
      out.innerHTML = '<div class="warn"><b>Free plan limit reached.</b> You have used ' + used + ' of ' + PLAN_LIMITS.auditsPerMonth + ' site audits this month. <button class="btn small" data-action="upgrade">Upgrade to Pro — $9/month</button> for unlimited audits.</div>';
      btn.disabled = false; return;
    }
    if(urls.length > remaining){
      out.innerHTML = '<div class="warn">Free plan: you have ' + remaining + ' audit(s) left this month, so only the first ' + remaining + ' URL(s) will run.</div>';
      urls = urls.slice(0, remaining);
    }
  }
  const rows = [];
  let saveFailed = false;
  for(let i=0;i<urls.length;i++){
    prog.textContent = "Auditing " + (i+1) + " of " + urls.length + ": " + urls[i] + " …";
    try{
      const psi = await runPSI(urls[i], "mobile");
      /* F7: the save is wrapped INSIDE the per-URL try's success path — a
         failed insert used to land in the same catch as a failed PageSpeed
         run, so the URL was listed as "Not scored" with the save error as
         its Note and the score was dropped. The score stays; the Note says
         the save failed. */
      let saveNote = null;
      try{
        const rec = { date: todayISO(), url: urls[i], total: null, ok: null, failed: null, psi: psi.score, lcp: psi.lcp, cls: psi.cls };
        if(S.mode==='cloud'){
          const id = await cloudInsertAudit(rec);
          if(id) rec.id = id;
          S.cache.audits = [rec].concat(S.cache.audits).slice(0,20);
        }else{
          LS.set("audits", [rec].concat(LS.get("audits", [])).slice(0,20));
        }
      }catch(saveErr){ saveNote = "Scored " + psi.score + "/100 but could not be saved: " + (saveErr.message||saveErr); saveFailed = true; }
      rows.push({ url: urls[i], score: psi.score, lcp: psi.lcp, cls: psi.cls, error: saveNote });
    }catch(e){
      rows.push({ url: urls[i], score: null, lcp: null, cls: null, error: e.message||e });
    }
  }
  out.innerHTML = '<div style="overflow-x:auto"><table><tr><th>URL</th><th>PageSpeed (mobile)</th><th>LCP</th><th>CLS</th><th>Note</th></tr>' + rows.map(r =>
    '<tr><td>' + esc(r.url) + '</td><td>' + (r.score==null ? '<span class="pill warn">Not scored</span>' : '<b>' + r.score + '</b>/100 <a href="' + esc(pagespeedVerifyUrl(r.url)) + '" target="_blank" rel="noopener">verify</a>') + '</td><td>' + esc(r.lcp||"—") + '</td><td>' + esc(r.cls||"—") + '</td><td class="muted">' + (r.error ? esc(r.error) : "") + '</td></tr>').join("") + '</table></div>'
    + measuredLine('every score is Google PageSpeed Insights (Google\u2019s API) — verify any of them on Google\u2019s own tool via the link next to the score')
    + '<p class="muted">' + (saveFailed ? 'Some scored checks could not be saved to audit history (see the Notes above) — the scores shown are still valid.' : 'Successful checks were saved to audit history;') + ' failed checks are listed above. PageSpeed errors are shown exactly as Google returned them — a quota error (429) means retry later or add a free API key in Workspace settings.</p>';
  prog.textContent = "";
  btn.disabled = false;
  renderAuditHistory(); renderLimitNotes();
}
$("bkBtn").addEventListener("click", runBulkAudit);

/* ---------- 10. Audit history chart ---------- */
function renderAuditChart(){
  const chartEl = $("auditChart");
  if(!chartEl) return;
  const withPsi = S.get("audits", []).filter(a => a.psi!=null).slice(0,10);
  if(!withPsi.length){ chartEl.innerHTML = '<p class="muted">No PageSpeed scores yet — run an audit or a health check to see the trend.</p>'; return; }
  chartEl.innerHTML = '<h3>PageSpeed history (latest ' + withPsi.length + ' scored audits)</h3>' + withPsi.map(a => {
    const label = fmtDate(a.date) + ' · ' + (a.url||"").replace(/^https?:\/\//,"").slice(0,34);
    return '<div class="chart-row"><span class="lbl" title="' + esc(a.url||"") + '">' + esc(label) + '</span><span class="bar"><i style="width:' + a.psi + '%"></i></span><span class="val">' + a.psi + '/100</span></div>';
  }).join("") + '<p class="muted">Scores are from Google PageSpeed Insights, stored with each audit. Export the CSV to compare one URL over time.</p>';
}

/* ---------- 15. Dashboard: rank movement + revenue compare ---------- */
function renderDashboardExtras(){
  /* Same cloud-load gate as renderDashboard: no movement or revenue
     comparison until the account data has actually loaded. */
  if(S.mode === "cloud" && !cloudDataLoaded){
    const rm = $("rankMovement"), rc = $("revCompare");
    const note = cloudDataFailed ? "Account data could not load — reload to retry." : "Loading your account data…";
    if(rm) rm.innerHTML = '<p class="muted"><b>Rank movement:</b> ' + note + '</p>';
    if(rc) rc.innerHTML = '<p class="muted"><b>Ad revenue:</b> ' + note + '</p>';
    return;
  }
  const kws = S.get("keywords", []);
  let up = 0, down = 0, same = 0;
  const movers = [];
  kws.forEach(k => {
    const c = k.checks||[];
    if(c.length < 2) return;
    const last = c[c.length-1].position, prev = c[c.length-2].position;
    if(last==null && prev==null){ same++; return; }
    if(last!=null && prev==null){ up++; movers.push({ kw:k.keyword, from:null, to:last, dir:"up" }); return; }
    if(last==null && prev!=null){ down++; movers.push({ kw:k.keyword, from:prev, to:null, dir:"down" }); return; }
    if(last < prev){ up++; movers.push({ kw:k.keyword, from:prev, to:last, dir:"up" }); }
    else if(last > prev){ down++; movers.push({ kw:k.keyword, from:prev, to:last, dir:"down" }); }
    else same++;
  });
  const rm = $("rankMovement");
  if(rm){
    if(!kws.length) rm.innerHTML = '<p class="muted"><b>Rank movement:</b> no keywords tracked yet.</p>';
    else if(up+down+same === 0) rm.innerHTML = '<p class="muted"><b>Rank movement:</b> check each keyword at least twice to see movement (last check vs the one before).</p>';
    else{
      rm.innerHTML = '<p><b>Rank movement (last check vs previous):</b> <span class="pill ok">' + up + ' up</span> <span class="pill bad">' + down + ' down</span> <span class="pill info">' + same + ' unchanged</span></p>'
        + (movers.length ? '<ul class="muted">' + movers.slice(0,10).map(m => '<li>' + esc(m.kw) + ': ' + (m.from==null ? 'not ranked' : '#' + m.from) + ' → ' + (m.to==null ? 'not ranked' : '#' + m.to) + ' ' + (m.dir==="up" ? '▲' : '▼') + '</li>').join("") + '</ul>' : '');
    }
  }
  const rc = $("revCompare");
  if(rc){
    const now = new Date();
    const thisM = now.toISOString().slice(0,7);
    const lastD = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth()-1, 1));
    const lastM = lastD.toISOString().slice(0,7);
    const entries = m => S.get("revenue", []).filter(e => (e.date||"").indexOf(m)===0);
    const sum = m => entries(m).reduce((a,e)=>a+(+e.amount||0),0);
    const t = sum(thisM), l = sum(lastM);
    /* $0.00 vs $0.00 with no entries at all is not a real comparison — it
       only says nothing was ever logged. Say so instead of printing two
       bare zeros that read as measured revenue. */
    if(!entries(thisM).length && !entries(lastM).length){
      rc.innerHTML = '<p class="muted"><b>Ad revenue:</b> nothing logged for this month or last month — add entries in the Revenue Estimator to track it.</p>';
    }else{
      let delta = "";
      if(l > 0){
        const pct = Math.round((t-l)/l*100);
        delta = ' (' + (pct>=0?'+':'') + pct + '% vs last month)';
      }else if(t > 0){
        delta = ' (up from $0.00 last month)';
      }
      rc.innerHTML = '<p><b>Ad revenue:</b> $' + t.toFixed(2) + ' this month vs $' + l.toFixed(2) + ' last month' + delta + '.</p>';
    }
  }
}

/* ---------- 13. CSV exports ---------- */
$("auditExportBtn").addEventListener("click", () => {
  const rows = S.get("audits", []).map(a => [a.date, a.url, (a.total==null?"":a.total), (a.ok==null?"":a.ok), (a.failed==null?"":a.failed), (a.psi==null?"":a.psi), a.lcp||"", a.cls||""]);
  if(!rows.length){ $("auditHistory").innerHTML = '<p class="muted">No audits to export yet — run an audit first.</p>'; return; }
  downloadCSV("seoforge-audits.csv", ["date","url","urls_checked","ok","failed","pagespeed_score","lcp","cls"], rows);
});
$("rkExportBtn").addEventListener("click", () => {
  const rows = [];
  S.get("keywords", []).forEach(k => {
    if(k.checks && k.checks.length) k.checks.forEach(c => rows.push([k.keyword, k.url||"", (k.difficulty==null?"":k.difficulty), c.date, (c.position==null?"not in top results":c.position)]));
    else rows.push([k.keyword, k.url||"", (k.difficulty==null?"":k.difficulty), "", "never checked"]);
  });
  if(!rows.length){ $("rkList").innerHTML = '<p class="muted">No keywords to export yet — add a keyword in the Rank Tracker first.</p>'; return; }
  downloadCSV("seoforge-rank-history.csv", ["keyword","target_url","difficulty","check_date","position"], rows);
});
$("lvExportBtn").addEventListener("click", () => {
  const rows = S.get("links", []).map(l => [l.date, l.page, l.domain, l.count, l.types||""]);
  if(!rows.length){ $("lvHistory").innerHTML = '<p class="muted">No verified links to export yet — verify a link first.</p>'; return; }
  downloadCSV("seoforge-verified-links.csv", ["date","linking_page","domain","links_found","types"], rows);
});
$("revExportBtn").addEventListener("click", () => {
  const rows = S.get("revenue", []).map(e => [e.date, e.network, e.amount]);
  if(!rows.length){ $("revList").innerHTML = '<p class="muted">No revenue entries to export yet — log revenue first.</p>'; return; }
  downloadCSV("seoforge-revenue.csv", ["date","network","amount_usd"], rows);
});


/* ---------- Site switcher (header) + global search ---------- */
/* Sites are stored in localStorage, capped at the plan limit (Free 1, Pro 3,
   Agency 10, Business/Admin 50) — never at a hardcoded 3, or a re-save after
   reload would silently delete sites 4+. The switcher defaults every tool's
   URL input to the selected site (only empty inputs, or ones still holding
   the previous default, are overwritten — a typed URL is never clobbered). */
function normalizeSiteList(arr){
  /* Normalise + dedupe ONLY — never slice to the plan limit here. Slicing on
     read is what deleted sites 11–50 on a downgrade save (F2): storedSites()
     returned 10, the form showed 10, and the save overwrote 50 with 10. */
  const out = [];
  (arr||[]).forEach(s => { const u = SEOForgeCore.normaliseSite(s); if(u && !out.includes(u)) out.push(u); });
  return out;
}
/* The ACTIVE window: the first siteLimitForPlan() stored sites. The rest are
   kept in storage (not active) — see loadSiteSlots() / the save handler. */
function activeSites(){ return storedSites().slice(0, siteLimitForPlan()); }
/* Extra site slots beyond the 10 static ones (Business/Admin: up to 50).
   Created on demand by loadSiteSlots() and kept here so the save handler
   can read them — the static SITE_SLOT_IDS inputs live in app.html. */
const extraSiteSlotEls = [];
function siteSlotValues(){
  const vals = SITE_SLOT_IDS.map(id => { const el = $(id); return el ? (el.value||"") : ""; });
  extraSiteSlotEls.forEach(slot => vals.push(slot.input.value || ""));
  return vals;
}
function storedSites(){ return normalizeSiteList(LS.get("sites", [])); }
function selectedSite(){
  const sites = activeSites();
  const sel = LS.get("selectedSite", "");
  if(sel && sites.includes(sel)) return sel;
  /* One precedence rule: the My-sites selection wins; the validated default
     website is the fallback ONLY when the My-sites list is empty — a
     default must never silently override a selected site. */
  const p = SEOForgeCore.validatePreferences(LS.get("preferences", {}));
  if(!storedSites().length && p.defaultSite) return p.defaultSite;
  if(p.defaultSite && sites.includes(p.defaultSite)) return p.defaultSite;
  return sites[0] || "";
}
function renderSiteSwitcher(){
  const el = $("siteSwitcher"); if(!el) return;
  const sites = activeSites();
  const sel = selectedSite();
  el.innerHTML = sites.length
    ? sites.map(s => '<option value="' + esc(s) + '"' + (s===sel?" selected":"") + '>' + esc(s.replace(/^https?:\/\//,"")) + '</option>').join("")
    : '<option value="">No site saved yet</option>';
  el.value = sel;
}
function applySelectedSite(){
  const sites = storedSites();
  if(!sites.length){
    /* No My-sites selection: the last-run Site Audit URL survives a reload
       and wins over the default website for auditUrl — a typed URL is never
       clobbered (the fill loop below only overwrites an empty input or one
       still holding the previous default). The restore deliberately does
       NOT set dataset.defaultSite, so the loop leaves it alone. */
    const au = $("auditUrl");
    if(au && !au.value){ try{ const last = LS.get("lastAuditUrl"); if(last) au.value = last; }catch(e){} }
  }
  const site = selectedSite();
  if(!site) return;
  ["auditUrl","serpUrl","hcUrl","lvPage","blUrl","rdUrl","scUrl","rbSite","smSite","cpA"].forEach(id => {
    const el = $(id);
    if(el && (!el.value || el.value===el.dataset.defaultSite)){ el.value = site; el.dataset.defaultSite = site; }
  });
}
/* F2: explicit removal of one kept (over-limit) site — the only way a kept
   site leaves the stored list. Index i is relative to the kept list. */
function removeKeptSite(i){
  const stored = storedSites();
  stored.splice(siteLimitForPlan() + i, 1);
  LS.set("sites", stored);
  loadSiteSlots(); renderSiteSwitcher(); applySelectedSite();
}
function loadSiteSlots(){
  /* Read the FULL stored list — the slots show the first `limit` sites (the
     active window); anything beyond it is kept in storage and listed below
     with an explicit Remove button (F2). Nothing here deletes stored sites. */
  const sites = normalizeSiteList(LS.get("sites", []));
  const limit = siteLimitForPlan();
  const kept = sites.slice(limit);
  SITE_SLOT_IDS.forEach((id, i) => { const el = $(id); if(el) el.value = sites[i] || ""; });
  /* Business/Admin allow more sites than the 10 static slots: create the
     extra inputs on demand (up to the plan limit), so the 50-site promise
     is self-serve instead of owner-only. Shrinking the plan removes them. */
  const extra = $("siteSlotsExtra");
  while(extraSiteSlotEls.length < Math.max(0, limit - SITE_SLOT_IDS.length)){
    const n = SITE_SLOT_IDS.length + extraSiteSlotEls.length + 1;
    const wrap = document.createElement("div");
    const label = document.createElement("label");
    label.textContent = "Site " + n;
    label.htmlFor = "siteSlot" + n;
    const input = document.createElement("input");
    input.type = "url"; input.id = "siteSlot" + n; input.placeholder = "e.g. https://example.com";
    wrap.appendChild(label); wrap.appendChild(input);
    if(extra) extra.appendChild(wrap);
    extraSiteSlotEls.push({ wrap, input });
  }
  while(extraSiteSlotEls.length > Math.max(0, limit - SITE_SLOT_IDS.length)){
    const slot = extraSiteSlotEls.pop();
    try{ slot.wrap.remove(); }catch(e){}
  }
  extraSiteSlotEls.forEach((slot, k) => { slot.input.value = sites[SITE_SLOT_IDS.length + k] || ""; });
  const note = $("siteLimitNote");
  if(note){
    note.textContent = isAdmin()
      ? "Admin — up to 50 sites in this form (no plan limit)."
      : "Your " + planDisplayName(currentPlan) + " plan allows " + limit + " site" + (limit===1?"":"s") + (limit > SITE_SLOT_IDS.length ? " — all " + limit + " slots are below." : ".")
      + (kept.length ? " " + kept.length + " extra site(s) kept (not active) — listed below; remove any you no longer want." : "");
  }
  /* Kept sites: visible, named, removable one by one — never silently
     dropped, and never removed except by an explicit tap here. */
  const keptEl = $("siteKeptList");
  if(keptEl){
    keptEl.innerHTML = kept.length
      ? '<p class="muted">Kept sites (not active on this plan — they stay saved until you remove them):</p>' + kept.map((x,i) => '<div class="listing"><b>' + esc(x) + '</b> <button class="btn small secondary" data-remove-kept="' + i + '">Remove</button></div>').join("")
      : "";
    keptEl.querySelectorAll("[data-remove-kept]").forEach(b => b.addEventListener("click", () => removeKeptSite(Number(b.dataset.removeKept))));
  }
}
/* Global search: one header input that jumps to a tool with the query
   prefilled — a URL goes to Site Audit, anything else to the Keyword
   Explorer. Pure target function, so it is unit testable. */
function globalSearchTargets(q){
  const s = String(q||"").trim();
  if(!s) return [];
  const isUrl = /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/.test(s) && s.includes(".");
  const out = [];
  if(isUrl) out.push({tab:"audit", label:"Audit " + s, field:"auditUrl", value: s.startsWith("http") ? s : "https://" + s});
  out.push({tab:"keywords", label:"Explore keyword \u201c" + s + "\u201d", field:"seedKw", value:s});
  return out;
}
function globalSearchGo(q){
  const targets = globalSearchTargets(q);
  if(!targets.length) return;
  const t = targets[0];
  const el = $(t.field); if(el) el.value = t.value;
  showTab(t.tab, true);
  const box = $("globalSearchResults"); if(box) box.innerHTML = "";
  const inp = $("globalSearch"); if(inp) inp.value = "";
}

/* ---------- Workspace preferences and account recovery ---------- */
function loadPreferences(){
  const p = SEOForgeCore.validatePreferences(LS.get("preferences", {}));
  $("prefTheme").value=p.theme; $("prefAccent").value=p.accent;
  $("prefDensity").value=p.density; $("prefBrand").value=p.brand;
  $("prefSite").value=p.defaultSite; $("prefStrategy").value=p.strategy;
  applyPreferences(p);
}
function applyPreferences(p){
  const dark = p.theme === "dark" || (p.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.dataset.density = p.density;
  /* One accent drives the whole design: --accent is the variable styles.css
     themes from; --teal is set to the same value as a backwards-compatible
     alias (see SEOForgeCore.applyAccent). */
  SEOForgeCore.applyAccent(document.documentElement, p.accent);
  renderSiteSwitcher();
  /* applySelectedSite() is the single writer of tool URL inputs: it fills
     them from selectedSite(), which already falls back to the validated
     default website when the My-sites list is empty. No second write here —
     the old one overwrote what applySelectedSite had just filled. */
  applySelectedSite();
  $("workspaceName").textContent = p.brand;
  $("psiStrategy").value = p.strategy;
  loadSiteSlots();
}
$("prefSave").addEventListener("click", () => {
  try {
    const p = SEOForgeCore.validatePreferences({theme:$("prefTheme").value, accent:$("prefAccent").value, density:$("prefDensity").value, brand:$("prefBrand").value, defaultSite:$("prefSite").value, strategy:$("prefStrategy").value});
    if($("prefSite").value.trim() && !p.defaultSite) throw new Error("Enter a valid HTTP or HTTPS website.");
    LS.set("preferences",p); applyPreferences(p); showBanner("Workspace preferences saved in this browser.", "ok");
  } catch(e){ showBanner(e.message,"warn"); }
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change",()=>applyPreferences(SEOForgeCore.validatePreferences(LS.get("preferences",{}))));
/* Cross-tab theme sync (R2): a Settings save in another tab re-themes this
   live tab with no reload. The landing has the same listener for its own
   key; here the key is the per-account one (LS.key) when signed in, else
   the guest key — a change to the other key is not this tab's prefs. */
if(typeof window.addEventListener === "function"){
  window.addEventListener("storage", (e) => {
    if(!e || !e.key) return;
    if(e.key === LS.key("preferences")){ try{ loadPreferences(); }catch(err){} }
  });
}
async function collectAccountExport(){
  const uid=currentUser?.id;
  const generation=authGeneration;
  if(!uid) return Object.fromEntries(Object.keys(S.cache).map(k=>[k,S.get(k,[])]));
  const data={};
  for(const table of ["audits","keywords","rank_checks","verified_links","revenue_entries","listings","orders","content_briefs","competitors","site_checks"]){
    data[table]=[];
    for(let offset=0;;offset+=500){
      if(generation!==authGeneration || currentUser?.id!==uid) throw new Error("Account changed. Export cancelled.");
      const {data:rows,error}=await sb.from(table).select("*").eq("user_id",uid).order("id").range(offset,offset+499);
      if(error) throw new Error("Export failed for "+table+": "+error.message);
      data[table].push(...(rows||[]));
      if((rows||[]).length<500) break;
      if(offset>=99500) throw new Error("This account exceeds the browser export limit. Contact support for a database export.");
    }
  }
  if(generation!==authGeneration || currentUser?.id!==uid) throw new Error("Account changed. Export cancelled.");
  return data;
}
$("backupExport").addEventListener("click",async()=>{
  const button=$("backupExport"); button.disabled=true;
  try {
    const mode=S.mode;
    const data=await collectAccountExport();
    downloadFile("seoforge-backup-"+todayISO()+".json",JSON.stringify({version:2,exportedAt:new Date().toISOString(),mode,data},null,2),"application/json");
    showBanner("Export complete. API keys and authentication tokens are excluded.", "ok");
  } catch(e){ showBanner(e.message,"warn"); }
  finally {button.disabled=false;}
});
$("forgotPassword").addEventListener("click",async()=>{
  if(!sb){ showAuthMsg("Cloud authentication is unavailable."); return; }
  const email=$("authEmail").value.trim();
  if(!email){ showAuthMsg("Enter your email above first."); return; }
  try {
    const redirect=new URL(location.href); redirect.search=""; redirect.hash="";
    const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:redirect.href});
    if(error) throw error;
    showAuthMsg("If that account exists, a password reset link will arrive by email.");
  } catch(e){ showAuthMsg("Password reset failed: "+e.message); }
});
function showRecoveryForm(){ $("recoveryPanel").hidden=false; showApp(); }
$("recoverySave").addEventListener("click",async()=>{
  const password=$("recoveryPassword").value;
  if(password.length<12){ $("recoveryStatus").textContent="Use at least 12 characters."; return; }
  $("recoverySave").disabled=true;
  try {
    const {error}=await sb.auth.updateUser({password}); if(error) throw error;
    $("recoveryPassword").value=""; $("recoveryPanel").hidden=true;
    showBanner("Password updated.", "ok");
  } catch(e){ $("recoveryStatus").textContent=e.message; }
  finally { $("recoverySave").disabled=false; }
});
loadPreferences();


/* Integration status (v2.11.0): the status call is a plain untracked fetch —
   the old version registered it in activeRequests (via fetchTimeout), so
   afterSignIn()'s cancelPendingRequests() aborted it mid-flight whenever the
   user id changed and the catch showed a false "unavailable" until the user
   hit Refresh. Now the panel reads "Checking…" until the call resolves and
   the error text appears ONLY if the call really fails (with one retry). */
let capabilitiesState = "idle"; /* idle | loading | ok | error */
async function loadCapabilities(){
  const out=$("integrationReadiness"); if(!out) return;
  if(capabilitiesState==="loading") return;
  capabilitiesState="loading";
  out.textContent="Checking integration readiness…";
  for(let attempt=0; attempt<2; attempt++){
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 10000);
      const response = await fetch(SUPABASE_URL+"/functions/v1/status", {signal:c.signal});
      clearTimeout(t);
      if(!response.ok) throw new Error("Status unavailable");
      const status = await response.json();
      out.textContent="Google reports: "+(status.google?"configured":"awaiting setup")+" · Paid checkout: "+(status.billing?"enabled":"not enabled")+" · Email: "+(status.email&&status.emailScheduled?"scheduled":status.email?"configured; schedule pending":"awaiting setup");
      capabilitiesState="ok";
      return;
    }catch(e){
      if(attempt===0){ await new Promise(r => setTimeout(r, 1500)); continue; }
      capabilitiesState="error";
      out.textContent="Integration status unavailable. Core tools remain available.";
    }
  }
}
$("integrationRefresh").addEventListener("click",loadCapabilities);
$("billingRefresh").addEventListener("click",async()=>{
  if(!currentUser){focusAuth();showAuthMsg("Sign in to refresh billing.");return;}
  const uid=currentUser.id;
  try {
    const token=await supabaseAccessToken();
    const response=await fetchJsonTimeout(SUPABASE_URL+"/functions/v1/billing",30000,{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({action:"refresh"})});
    const data=await response.json(); if(!response.ok) throw new Error(data.error||"Billing refresh failed");
    if(currentUser?.id!==uid) return;
    currentPlan=data.plan; refreshAuthUI();renderPlanCard();renderLimitNotes();showBanner("Billing status refreshed.","ok");
  }catch(e){showBanner(e.message,"warn");}
});
loadCapabilities();

/* ---------- init ---------- */
function renderAll(){
  renderDashboard();
  renderPlanCard();
  renderAuditHistory();
  renderRankList();
  renderLinkHistory();
  renderRevenue();
  renderMarket();
  renderLimitNotes();
  loadSettings();
  renderGoogleStatus();
  loadNotifPref();
}
/* ---------- init ---------- */
/* Reload rules (v2.10.0): the tab in #tab= is restored; a saved session (or a
   Google return with ?code=) opens the app shell straight away — the inline
   gate in app.html already did this before first paint, this is the same
   decision repeated in JS; a guest reload stays a guest (localStorage flag);
   a logged-out reload shows the auth view, never a broken page. Nothing here
   re-submits anything — saves happen only on button clicks, so a reload can
   never duplicate a keyword, revenue entry or listing. An expired session
   simply leaves the auth view up (initAuth finds no session, no spinner). */
function initAppFromUrl(){
  const tab = parseTabHash(location.hash);
  const auth = parseAuthHash(location.hash);
  const returning = /[?&]code=/.test(location.search||"");
  const sharedUrl = parseShareHash(location.hash);
  if(/#guest\b/.test(location.hash||"")) enterGuestMode(); /* persist the guest flag so a reload stays in the app */
  if(sharedUrl && auth){
    /* "Save this audit" from a shared score: show the signup view; the check
       runs after sign-in (afterSignIn consumes pendingShareUrl) and saves to
       the new account. If the user is already signed in, run it now. */
    pendingShareUrl = sharedUrl;
    showAuthView(auth); if(tab) showTab(tab);
    if(currentUser){
      pendingShareUrl = "";
      const el = $("hcUrl"); if(el) el.value = sharedUrl;
      showApp(); showTab("health"); shareRuns.add("health|" + sharedUrl); runHealth();
    }
    return;
  }
  if(sharedUrl){
    /* A shared score link: open the Health Check with the URL prefilled and
       run it. Works logged out (guest mode — no signup, no card) and signed
       in (saves to the account). */
    if(isGuestMode() || hasSavedSession() || returning) showApp();
    else enterGuestMode();
    showTab("health");
    const el = $("hcUrl"); if(el) el.value = sharedUrl;
    shareRuns.add("health|" + sharedUrl); runHealth();
    return;
  }
  if(auth){ showAuthView(auth); if(tab) showTab(tab); return; }
  if(isGuestMode() || hasSavedSession() || returning){ showApp(); showTab(tab || "dashboard"); return; }
  if(tab) showTab(tab);
  showAuthView("signin");
}
/* Boot: the app is NOT rendered until the session check resolves. Until
   then the shell shows its neutral "…" stats and no plan card — a signed-in
   user never sees the local-mode dashboard (with its local counts) flash
   first and then flip to their own data mid-interaction. The static stat
   values in app.html read "…" on purpose: pre-auth paint must read as
   "loading", never as a real zero. */
handlePaypalReturn();
refreshAuthUI();
applyVersionLabels();
initAuth().then(() => { renderAll(); initAppFromUrl(); return handleGoogleReturn(); }).catch(e => { renderAll(); initAppFromUrl(); showBanner(e.message, "warn"); });

/* ================= v2.12.0: Schema Generator + Automation Hub ================= */
/* Append-only: nothing above is rewritten. The two new modules load before
   app.js (see app.html) and expose window.SeoforgeSchemaGen /
   window.SeoforgeAutomations; in the vm test harness they are absent, so
   every block below guards on them and the app still boots. */
VALID_TABS.push("schemagen", "automations");
var SG = (typeof window !== "undefined" && window.SeoforgeSchemaGen) || null;
var AU = (typeof window !== "undefined" && window.SeoforgeAutomations) || null;

/* ---------- Schema Generator ---------- */
function sgFieldHtml(f, prefix){
  var id = prefix + "-" + f.key;
  var input;
  if(f.type === "textarea") input = '<textarea id="' + id + '" data-sg-key="' + f.key + '" rows="3"' + (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : "") + '></textarea>';
  else input = '<input id="' + id + '" data-sg-key="' + f.key + '" type="' + (f.type === "date" ? "date" : f.type === "url" ? "url" : "text") + '"' + (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : "") + '>';
  return '<label for="' + id + '">' + esc(f.label) + (f.required ? " *" : "") + '</label>' + input;
}
function sgRepeatHtml(f){
  var rows = '<div data-sg-repeat="' + f.key + '">'
    + '<div data-sg-row>' + f.fields.map(function(sf){ return sgFieldHtml(sf, "sg-" + f.key + "-0"); }).join("") + '</div></div>'
    + '<button type="button" class="btn small secondary" data-sg-add="' + f.key + '">Add another</button>';
  return '<div><p class="muted">' + esc(f.label) + (f.min ? " (at least " + f.min + ")" : "") + '</p>' + rows + '</div>';
}
function renderSgForm(){
  if(!SG) return;
  var type = $("sgType").value;
  var fields = SG.SCHEMA_FORMS[type] || [];
  $("sgForm").innerHTML = fields.map(function(f){
    return f.type === "repeat" ? sgRepeatHtml(f) : sgFieldHtml(f, "sg");
  }).join("");
  $("sgForm").querySelectorAll("[data-sg-add]").forEach(function(b){
    b.addEventListener("click", function(){
      var f = (SG.SCHEMA_FORMS[$("sgType").value] || []).filter(function(x){ return x.key === b.dataset.sgAdd; })[0];
      if(!f) return;
      var wrap = b.parentElement.querySelector('[data-sg-repeat="' + f.key + '"]');
      var n = wrap.querySelectorAll("[data-sg-row]").length;
      var row = document.createElement("div");
      row.setAttribute("data-sg-row", "");
      row.innerHTML = f.fields.map(function(sf){ return sgFieldHtml(sf, "sg-" + f.key + "-" + n); }).join("")
        + '<button type="button" class="btn small secondary" data-sg-remove>Remove</button>';
      row.querySelector("[data-sg-remove]").addEventListener("click", function(){ row.remove(); updateSgPreview(); });
      wrap.appendChild(row);
      updateSgPreview();
    });
  });
  updateSgPreview();
}
function collectSgData(){
  var data = {};
  $("sgForm").querySelectorAll("[data-sg-key]").forEach(function(el){
    if(el.closest("[data-sg-repeat]")) return; /* repeat rows collected below */
    data[el.dataset.sgKey] = el.value;
  });
  $("sgForm").querySelectorAll("[data-sg-repeat]").forEach(function(wrap){
    var rows = [];
    wrap.querySelectorAll("[data-sg-row]").forEach(function(row){
      var item = {};
      row.querySelectorAll("[data-sg-key]").forEach(function(el){ item[el.dataset.sgKey] = el.value; });
      rows.push(item);
    });
    data[wrap.dataset.sgRepeat] = rows;
  });
  return data;
}
function updateSgPreview(){
  if(!SG) return;
  var type = $("sgType").value;
  var data = collectSgData();
  var built = SG.buildSchema(type, data);
  $("sgPreview").textContent = JSON.stringify(built, null, 2);
  var hints = SG.validateSchema(type, data);
  $("sgHints").innerHTML = hints.length
    ? '<div class="warn"><b>Check before using:</b><ul style="margin:6px 0;padding-left:20px">' + hints.map(function(h){ return "<li>" + esc(h.message) + "</li>"; }).join("") + "</ul></div>"
    : '<p class="muted">Looks complete — copy or download it below.</p>';
}
function sgDownload(){
  if(!SG) return;
  var type = $("sgType").value;
  var blob = new Blob([$("sgPreview").textContent], { type: "application/ld+json" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url; a.download = "schema-" + type + ".json"; a.click();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  $("sgStatus").textContent = "Downloaded schema-" + type + ".json.";
}
if(SG){
  $("sgType").innerHTML = SG.SCHEMA_TYPES.map(function(t){ return '<option value="' + t.id + '">' + esc(t.label) + '</option>'; }).join("");
  $("sgType").addEventListener("change", renderSgForm);
  $("sgForm").addEventListener("input", updateSgPreview);
  $("sgCopyBtn").addEventListener("click", function(){
    try{
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText($("sgPreview").textContent).then(function(){
          $("sgStatus").textContent = "JSON-LD copied.";
        }, function(){ $("sgStatus").textContent = "Copy failed — select the preview text manually."; });
      } else { $("sgStatus").textContent = "Clipboard unavailable — select the preview text manually."; }
    }catch(e){ $("sgStatus").textContent = "Copy failed — select the preview text manually."; }
  });
  $("sgDownloadBtn").addEventListener("click", sgDownload);
  renderSgForm();
}

/* ---------- Automation Hub ---------- */
/* Studio drafts: the library lives under "seoforge.studio.drafts.v2" (array
   of {id,title,updatedAt,due,status}). Read-only here, never written. The
   Studio page today saves a single draft under "seoforge.studio.v1", so a
   lone v1 draft with a review date is shown too until the library exists. */
function readStudioDrafts(){
  var out = [];
  try{
    var arr = JSON.parse(localStorage.getItem("seoforge.studio.drafts.v2") || "null");
    if(Array.isArray(arr)) out = arr;
  }catch(e){}
  if(!out.length){
    try{
      var one = JSON.parse(localStorage.getItem("seoforge.studio.v1") || "null");
      if(one && one.due) out = [{ id: "studio-v1", title: one.title || "Studio draft", updatedAt: null, due: one.due, status: "draft" }];
    }catch(e){}
  }
  return out;
}
var autoShowDismissed = false;
function renderAutomations(){
  if(!AU) return;
  var rec = AU.loadRecord(localStorage);
  var data = { drafts: readStudioDrafts(), keywords: S.get("keywords", []), audits: S.get("audits", []) };
  var viewRec = autoShowDismissed ? { lastRuns: rec.lastRuns, dismissed: {} } : rec;
  var items = AU.buildReminderItems(data, viewRec, AU.todayStr());
  var el = $("autoList");
  if(!items.length){
    el.innerHTML = '<p class="muted">No reminders right now. Add a keyword to the Rank Tracker, run a Health Check, or give a Studio draft a review date — reminders appear here when they are due.</p>';
    return;
  }
  el.innerHTML = '<table><tr><th>Reminder</th><th>Last run</th><th>Next due</th><th>Status</th><th></th></tr>' + items.map(function(it){
    var st = AU.computeStatus(it, AU.todayStr());
    var pill = st.status === "overdue" ? '<span class="pill bad">Overdue</span>' : st.status === "due" ? '<span class="pill warn">Due</span>' : '<span class="pill ok">On track</span>';
    var detail = it.detail || "";
    if(it.kind === "rank" && !it.lastRun) detail = "No rank checks yet — add a keyword in the Rank Tracker.";
    if(it.kind === "health" && !it.lastRun) detail = "No health checks yet — run a Health Check.";
    if(autoShowDismissed && rec.dismissed[it.id]) detail += " Dismissed " + fmtDate(rec.dismissed[it.id]) + ".";
    var go = it.targetTab === "studio"
      ? '<a href="./studio.html">Open Studio</a>'
      : '<button type="button" class="btn small secondary" data-auto-goto="' + it.targetTab + '">Go to tool</button>';
    return '<tr><td><b>' + esc(it.title) + '</b><br><span class="muted">' + esc(detail) + '</span></td>'
      + '<td>' + (it.lastRun ? esc(fmtDate(it.lastRun)) : "Never") + '</td>'
      + '<td>' + (st.nextDue ? esc(fmtDate(st.nextDue)) : "—") + '</td>'
      + '<td>' + pill + '</td>'
      + '<td><button type="button" class="btn small" data-auto-done="' + esc(it.id) + '">Mark done</button> '
      + go + ' '
      + '<button type="button" class="btn small secondary" data-auto-dismiss="' + esc(it.id) + '">Dismiss</button></td></tr>';
  }).join("") + "</table>";
  el.querySelectorAll("[data-auto-done]").forEach(function(b){
    b.addEventListener("click", function(){ AU.markDone(localStorage, b.dataset.autoDone, AU.todayStr()); renderAutomations(); });
  });
  el.querySelectorAll("[data-auto-dismiss]").forEach(function(b){
    b.addEventListener("click", function(){ AU.dismiss(localStorage, b.dataset.autoDismiss, AU.todayStr()); renderAutomations(); });
  });
  el.querySelectorAll("[data-auto-goto]").forEach(function(b){
    b.addEventListener("click", function(){ showTab(b.dataset.autoGoto, true); });
  });
}
if(AU){
  $("autoRefreshBtn").addEventListener("click", renderAutomations);
  $("autoShowDismissedBtn").addEventListener("click", function(){
    autoShowDismissed = !autoShowDismissed;
    $("autoShowDismissedBtn").textContent = autoShowDismissed ? "Hide dismissed reminders" : "Show dismissed reminders";
    renderAutomations();
  });
}

/* Route the two new tabs through the existing generic tab switch: wrap
   showTab (append-only) so opening either tab renders its content. */
var _showTab212 = showTab;
showTab = function(name, push){
  _showTab212(name, push);
  if(name === "schemagen") updateSgPreview();
  if(name === "automations") renderAutomations();
};
