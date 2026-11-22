
"use strict";
/* ================= v2 config ================= */
const SUPABASE_URL = "https://mzbesucdnjecinkdawzy.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_r61BK1KPrPVwF6O2AncpnA_vlg_xx6N";
/* Billing must be verified by a server before entitlement changes. */
const PAYPAL_SUBSCRIBE_URL = "";

const PLAN_LIMITS = { auditsPerMonth: 5, keywordsTotal: 10, linkChecksPerMonth: 5, briefsPerMonth: 3, comparesPerMonth: 3, toolChecksPerMonth: 10 };

/* ================= v2.6 integrations ================= */
/* Google OAuth (Search Console + Analytics, read-only). The real client ID is
   being created in Google Cloud Console — paste it below when it exists.
   This EXACT redirect URI must be registered in the OAuth client:
   https://syedsenterprises.github.io/seoforge/
   Scopes: webmasters.readonly + analytics.readonly. The app runs in Google
   test mode (up to 100 users) until OAuth verification — see README.
   The client SECRET is never in this file: it lives as a Supabase secret for
   the google-oauth edge function (see functions/google-oauth/). */
const GOOGLE_CLIENT_ID = "158848063786-cmdknljpjj6po7j2uc4r26dp31qm4nek.apps.googleusercontent.com"; /* Google Cloud OAuth client — project "SEOForge" (seoforge-515414), live 21 Nov 2026 */
const GOOGLE_REDIRECT_URI = "https://syedsenterprises.github.io/seoforge/";
const GOOGLE_SCOPES = "https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly";
const GOOGLE_OAUTH_FN = SUPABASE_URL + "/functions/v1/google-oauth";
const ALERT_FN = SUPABASE_URL + "/functions/v1/send-alert";

/* Supabase client (guarded: if the CDN fails, the app still works in local mode). */
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
let currentPlan = 'free'; /* 'free' | 'pro' */
let cloudUserId = null;   /* guards against double-loading on auth events */

/* ---------- views ---------- */
function showLanding(){ $("landingView").hidden = false; $("appView").hidden = true; }
function showApp(){ $("landingView").hidden = true; $("appView").hidden = false; }
function showBanner(msg, kind){
  const b = $("topBanner");
  b.textContent = msg;
  b.className = kind === 'warn' ? 'warn' : 'okbox';
  b.hidden = false;
}
$("topBanner").addEventListener("click", () => { $("topBanner").hidden = true; });
$("homeBtn").addEventListener("click", showLanding);
$("landingLaunchBtn").addEventListener("click", showApp);
function focusAuth(){ window.scrollTo({top:0}); $("authEmail").focus(); }
$("landingSignupBtn").addEventListener("click", focusAuth);
$("pricingFreeBtn").addEventListener("click", focusAuth);
function showAuthMsg(msg){ $("authMsg").textContent = msg; }

/* ---------- tabs ---------- */
document.querySelectorAll("#tabs button[data-tab]").forEach(b => b.addEventListener("click", () => showTab(b.dataset.tab)));
document.querySelectorAll("[data-goto]").forEach(b => b.addEventListener("click", () => showTab(b.dataset.goto)));
function showTab(name){
  document.querySelectorAll("#tabs button[data-tab]").forEach(b => b.classList.toggle("active", b.dataset.tab===name));
  document.querySelectorAll("section.tab").forEach(s => s.classList.toggle("active", s.id==="tab-"+name));
  if(name==="dashboard"){ renderDashboard(); renderPlanCard(); }
  if(name==="audit"){ renderAuditHistory(); renderLimitNotes(); }
  if(name==="rank"){ renderRankList(); renderLimitNotes(); }
  if(name==="links"){ renderLinkHistory(); renderLimitNotes(); }
  if(name==="ads"){ renderRevenue(); loadSettings(); }
  if(name==="market") renderMarket();
  if(name==="gsc"){ renderGoogleStatus(); }
  if(name==="brief"){ renderBriefs(); renderLimitNotes(); }
  if(name==="compete"){ renderCompetitors(); renderLimitNotes(); }
  if(name==="serp" || name==="broken" || name==="redirect" || name==="schema" || name==="robots" || name==="estimator" || name==="health" || name==="bulk"){ renderLimitNotes(); }
  window.scrollTo({top:0});
}
/* Upgrade buttons (header, plan card, pricing, limit prompts) — delegated so
   dynamically rendered buttons work too. */
document.addEventListener("click", e => {
  const t = e.target.closest('[data-action="upgrade"]');
  if(t){ e.preventDefault(); goUpgrade(); }
});
async function goUpgrade(){
  if(!currentUser){ showApp(); focusAuth(); showAuthMsg("Sign in before upgrading."); return; }
  try {
    const token=await supabaseAccessToken();
    const res=await fetchJsonTimeout(SUPABASE_URL+"/functions/v1/billing",30000,{
      method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({action:"checkout"})
    });
    const data=await res.json();
    if(!res.ok) throw new Error(data.error||"Checkout is unavailable");
    const url=new URL(data.url);
    if(url.protocol!=="https:" || !["www.paypal.com","www.sandbox.paypal.com"].includes(url.hostname)) throw new Error("Invalid checkout destination");
    location.href=url.href;
  } catch(e){ showBanner("Checkout unavailable: "+e.message+". Your free account remains available.", "warn"); }
}
function handlePaypalReturn(){
  const url = new URL(location.href);
  if(!url.searchParams.has("subscription_id")) return false;
  url.searchParams.delete("subscription_id");
  history.replaceState(null, "", url.toString());
  try { localStorage.removeItem("syedSuite.paypalSubId"); } catch {}
  showBanner("A checkout return is not payment verification. Your plan changes only after server confirmation.", "warn");
  return true;
}
async function applyPendingPaypalSub(){
  // Clear legacy, untrusted checkout data. Never write entitlements from the browser.
  try { localStorage.removeItem("syedSuite.paypalSubId"); } catch {}
}

/* ---------- auth ---------- */
function refreshAuthUI(){
  $("authLoggedOut").hidden = !!currentUser;
  $("authLoggedIn").hidden = !currentUser;
  $("homeBtn").hidden = !!currentUser;
  $("upgradeBtn").style.display = currentPlan === 'pro' ? 'none' : '';
  if(currentUser){
    $("authUserEmail").textContent = currentUser.email || "";
    const pill = $("planPill");
    pill.textContent = currentPlan === 'pro' ? 'Pro' : 'Free';
    pill.classList.toggle('pro', currentPlan === 'pro');
  }
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
  rankChecks.forEach(c => { (checksByKw[c.keyword_id] = checksByKw[c.keyword_id] || []).push({ date:(c.checked_at||"").slice(0,10), position:c.position }); });
  S.cache.keywords = keywords.map(k => ({ id:k.id, keyword:k.keyword, url:k.url||"", difficulty:(k.difficulty==null?null:k.difficulty), checks:(checksByKw[k.id]||[]).sort((a,b)=>a.date.localeCompare(b.date)) }));
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
  S.cache.competitors = competitors.map(c => ({ id:c.id, date:(c.created_at||"").slice(0,10), url:c.url||"" }));
  S.cache.toolChecks = siteChecks.map(t => ({ id:t.id, date:(t.created_at||"").slice(0,10), type:t.check_type||"", url:t.url||"", summary:(t.result && t.result.summary)||"" }));
}
function groupVerifiedRows(rows){
  const map = new Map();
  rows.forEach(r => {
    const d = (r.checked_at||"").slice(0,10);
    const key = r.page_url + "|" + r.target_domain + "|" + (r.checked_at||"");
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
  const { data, error } = await sb.from("audits").insert({ user_id:currentUser.id, url:a.url, score:(a.psi==null?null:a.psi), lcp:numOrNull(a.lcp), cls:numOrNull(a.cls), created_at:a.date+"T12:00:00Z" }).select("id").single();
  if(error) throw new Error("Audit could not be saved: " + error.message);
  return data.id;
}
let authGeneration = 0;
let signInTask = null;
let signingInId = null;
async function afterSignIn(user){
  if(!user) return;
  if(signInTask && signingInId === user.id) return signInTask;
  const generation = ++authGeneration;
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
    refreshAuthUI(); showApp(); renderAll(); loadPreferences();
    $("authPass").value = "";
  })();
  try { await signInTask; }
  catch(e){ if(generation === authGeneration) showBanner("Account data could not load. Reload to retry. " + e.message, "warn"); }
  finally { if(generation === authGeneration){ signInTask = null; signingInId = null; } }
}

async function doSignUp(){
  if(!cloudAvailable){ showAuthMsg("Sign-in is unavailable right now (the Supabase library failed to load). The app still works locally — try again later."); return; }
  const email = ($("authEmail").value||"").trim();
  const pass = $("authPass").value||"";
  if(!email || !pass){ showAuthMsg("Enter an email and a password."); return; }
  if(pass.length < 12){ showAuthMsg("Use a password of at least 12 characters."); return; }
  showAuthMsg("Creating your account…");
  const { data, error } = await sb.auth.signUp({ email, password: pass });
  if(error){ showAuthMsg("Sign-up failed: " + error.message); return; }
  if(data.session && data.session.user){
    showAuthMsg("Account created — welcome!");
    await afterSignIn(data.session.user);
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
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
  if(error){ showAuthMsg("Sign-in failed: " + error.message); return; }
  showAuthMsg("");
  if(data.user) await afterSignIn(data.user);
}
function clearAuthState(){
  ++authGeneration; signInTask = null; signingInId = null;
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
$("signOutBtn").addEventListener("click", doSignOut);
$("authPass").addEventListener("keydown", e => { if(e.key === "Enter") doSignIn(); });
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
  const m = thisMonthPrefix();
  const auditsUsed = S.get("audits", []).filter(a => (a.date||"").indexOf(m) === 0).length;
  const linksUsed = S.get("links", []).filter(l => (l.date||"").indexOf(m) === 0).length;
  const keywordsUsed = S.get("keywords", []).length;
  return { auditsUsed, linksUsed, keywordsUsed };
}
function limitNoteText(){
  if(!currentUser) return "Not signed in — usage is saved in this browser only. Sign in above to keep it in your account.";
  if(currentPlan === 'pro') return "Pro plan: unlimited audits, keywords, link checks, briefs, compares and tool checks.";
  const u = usageThisMonth();
  const v = v25Usage();
  return "Free plan: " + (PLAN_LIMITS.auditsPerMonth - u.auditsUsed) + " of " + PLAN_LIMITS.auditsPerMonth + " audits left this month · "
    + (PLAN_LIMITS.linkChecksPerMonth - u.linksUsed) + " of " + PLAN_LIMITS.linkChecksPerMonth + " link checks left · "
    + (PLAN_LIMITS.keywordsTotal - u.keywordsUsed) + " of " + PLAN_LIMITS.keywordsTotal + " keywords left · "
    + (PLAN_LIMITS.briefsPerMonth - v.briefsUsed) + " of " + PLAN_LIMITS.briefsPerMonth + " content briefs left · "
    + (PLAN_LIMITS.comparesPerMonth - v.comparesUsed) + " of " + PLAN_LIMITS.comparesPerMonth + " competitor compares left · "
    + (PLAN_LIMITS.toolChecksPerMonth - v.toolChecksUsed) + " of " + PLAN_LIMITS.toolChecksPerMonth + " tool checks left.";
}
function renderLimitNotes(){
  const t = limitNoteText();
  ["auditLimitNote","lvLimitNote","rkLimitNote","blLimitNote","rdLimitNote","scLimitNote","rbLimitNote","smLimitNote","brLimitNote","cpLimitNote","hcLimitNote","bkLimitNote"].forEach(id => { const el = $(id); if(el) el.textContent = t; });
}
function renderPlanCard(){
  const el = $("planCard"); if(!el) return;
  if(!currentUser){
    el.innerHTML = '<h2>Your plan</h2><p class="muted">You are using SEOForge in this browser only (local mode). <b>Sign in</b> above to save your audits, keywords and revenue to your account — free. Pro is $9/month for unlimited use.</p><button class="btn secondary" data-action="upgrade">See Pro — $9/month</button>';
    return;
  }
  const u = usageThisMonth();
  const v = v25Usage();
  if(currentPlan === 'pro'){
    el.innerHTML = '<h2>Your plan — Pro</h2><p><b>Pro is active.</b> Signed in as ' + esc(currentUser.email) + '. Unlimited audits, keywords and link checks.</p>';
  }else{
    el.innerHTML = '<h2>Your plan — Free</h2><p>Signed in as ' + esc(currentUser.email) + '.</p>'
      + '<p class="muted">This month: ' + u.auditsUsed + ' of ' + PLAN_LIMITS.auditsPerMonth + ' audits used · ' + u.linksUsed + ' of ' + PLAN_LIMITS.linkChecksPerMonth + ' link checks used · ' + u.keywordsUsed + ' of ' + PLAN_LIMITS.keywordsTotal + ' keywords tracked · ' + v.briefsUsed + ' of ' + PLAN_LIMITS.briefsPerMonth + ' briefs used · ' + v.comparesUsed + ' of ' + PLAN_LIMITS.comparesPerMonth + ' compares used · ' + v.toolChecksUsed + ' of ' + PLAN_LIMITS.toolChecksPerMonth + ' tool checks used.</p>'
      + '<button class="btn" data-action="upgrade">Upgrade to Pro — $9/month</button>';
  }
}

/* ---------- fetch helpers (honest errors, proxy fallback) ---------- */
function fetchTimeout(url, ms){
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, {signal:c.signal}).finally(() => clearTimeout(t));
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
/* Fetch any URL through free public proxies. Returns {status, text}.
   Status codes from the proxy usually mirror the target; 500/522/408 are proxy failures, not proof the site is down. */
async function fetchViaProxy(url, timeoutMs){
  let lastErr = null;
  for(const p of PROXIES){
    try{
      const res = await fetchTimeout(p(url), timeoutMs||15000);
      const text = await res.text();
      if(isProxyErrorPage(res.status, text)){ lastErr = new Error("Proxy error (HTTP "+res.status+" from the free proxy — the target site may still be fine)"); continue; }
      return { status: res.status, ok: res.ok, text };
    }catch(e){ lastErr = e; }
  }
  throw lastErr || new Error("All free proxies failed — retry later");
}

/* ---------- Dashboard ---------- */
function renderDashboard(){
  $("stAudits").textContent = S.get("audits", []).length;
  $("stKeywords").textContent = S.get("keywords", []).length;
  $("stLinks").textContent = S.get("links", []).length;
  const rev = S.get("revenue", []);
  $("stRevenue").textContent = "$" + rev.reduce((a,r)=>a+(+r.amount||0),0).toFixed(2);
  $("stOrders").textContent = S.get("orders", []).length;
  $("dashStoreNote").textContent = currentUser
    ? "Totals are computed from your SEOForge account (stored in Supabase, visible only to you)."
    : "Totals are computed from what is saved in this browser only (localStorage). Saved data stays in this browser; live tools send your queries to external providers.";
  renderDashboardExtras();
}

/* ---------- Site Audit ---------- */
const normaliseSite = SEOForgeCore.normaliseSite;

async function runAudit(psiOnly){
  const btn = $("auditBtn"), psiBtn = $("psiBtn");
  btn.disabled = true; psiBtn.disabled = true;
  const out = $("auditOut"), prog = $("auditProg");
  out.innerHTML = ""; prog.textContent = "";
  const site = normaliseSite($("auditUrl").value);
  if(!site){ out.innerHTML = '<div class="err">Enter a site URL first.</div>'; btn.disabled=false; psiBtn.disabled=false; return; }
  /* Free-plan limit: 5 audits per calendar month (cloud counts only). */
  if(S.mode==='cloud' && currentPlan!=='pro'){
    const used = usageThisMonth().auditsUsed;
    if(used >= PLAN_LIMITS.auditsPerMonth){
      out.innerHTML = '<div class="warn"><b>Free plan limit reached.</b> You have used ' + used + ' of ' + PLAN_LIMITS.auditsPerMonth + ' site audits this month. <button class="btn small" data-action="upgrade">Upgrade to Pro — $9/month</button> for unlimited audits.</div>';
      btn.disabled=false; psiBtn.disabled=false; return;
    }
  }
  const strategy = $("psiStrategy").value;
  const limit = Math.max(5, Math.min(50, parseInt($("auditLimit").value||"50",10)));
  const started = Date.now();
  try{
    let urls = [], sitemapNote = "";
    if(!psiOnly){
      const sitemapUrl = /\.xml(\?|$)/i.test(site) ? site : site + "/sitemap.xml";
      prog.textContent = "Fetching sitemap: " + sitemapUrl + " …";
      const sm = await fetchViaProxy(sitemapUrl, 20000);
      if(sm.status === 404){ throw new Error("Sitemap not found at " + sitemapUrl + " (HTTP 404). Check the URL — some sites use a different sitemap path."); }
      if(!sm.ok){ throw new Error("Sitemap fetch failed (HTTP " + sm.status + "). The free proxy may be having trouble — retry, or paste the sitemap URL directly."); }
      const doc = new DOMParser().parseFromString(sm.text, "application/xml");
      urls = [...doc.querySelectorAll("url > loc")].map(n => n.textContent.trim()).filter(Boolean);
      if(!urls.length){
        const idx = [...doc.querySelectorAll("sitemap > loc")].map(n => n.textContent.trim()).filter(Boolean);
        if(idx.length){
          sitemapNote = "This is a sitemap index with " + idx.length + " child sitemaps. Checking the first one: " + esc(idx[0]);
          prog.textContent = "Sitemap index found — fetching first child sitemap …";
          const child = await fetchViaProxy(idx[0], 20000);
          const cdoc = new DOMParser().parseFromString(child.text, "application/xml");
          urls = [...cdoc.querySelectorAll("url > loc")].map(n => n.textContent.trim()).filter(Boolean);
        }
      }
      if(!urls.length){ throw new Error("No URLs found in the sitemap. It may be empty, or in a format this parser does not read."); }
      urls = urls.slice(0, limit);
      prog.textContent = "Sitemap OK — " + urls.length + " URLs found. Checking each one (in batches) …";
      // status-check in batches of 5
      const results = new Array(urls.length);
      const BATCH = 5;
      for(let i=0;i<urls.length;i+=BATCH){
        const slice = urls.slice(i, i+BATCH);
        await Promise.all(slice.map(async (u, j) => {
          try{
            const r = await fetchViaProxy(u, 12000);
            results[i+j] = { url:u, status:r.status, ok:r.ok };
          }catch(e){ results[i+j] = { url:u, status:null, ok:false, err:String(e.message||e) }; }
        }));
        prog.textContent = "Checked " + Math.min(i+BATCH, urls.length) + " of " + urls.length + " URLs …";
      }
      const okN = results.filter(r=>r.ok).length;
      const failN = results.length - okN;
      let rows = results.map(r => {
        const pill = r.ok ? '<span class="pill ok">OK ' + r.status + '</span>'
          : (r.status ? '<span class="pill bad">HTTP ' + r.status + '</span>' : '<span class="pill warn">Proxy error</span>');
        return "<tr><td>" + esc(r.url) + "</td><td>" + pill + "</td><td class='muted'>" + (r.ok ? "" : esc(r.err||"")) + "</td></tr>";
      }).join("");
      out.innerHTML += '<div class="card" style="margin-top:10px"><h3>Sitemap crawl — ' + urls.length + ' URLs</h3>'
        + (sitemapNote ? '<p class="muted">'+sitemapNote+'</p>' : '')
        + '<p><span class="pill ok">' + okN + ' reachable</span> <span class="pill bad">' + failN + ' failed / proxy errors</span></p>'
        + '<p class="muted">“Proxy error” means the free proxy could not fetch that URL — it does not prove the page is down. Retry if you see many of them.</p>'
        + '<div style="overflow-x:auto"><table><tr><th>URL</th><th>Status</th><th>Note</th></tr>' + rows + '</table></div></div>';
      const rec = { date:todayISO(), url:site, total:urls.length, ok:okN, failed:failN, psi:null, lcp:null, cls:null };
      if(S.mode==='cloud'){
        const id = await cloudInsertAudit(rec);
        if(id){ rec.id = id; } else { out.innerHTML += '<div class="warn">This audit ran, but saving it to your account failed — the result above is still valid.</div>'; }
        S.cache.audits = [rec].concat(S.cache.audits).slice(0,20);
      }else{
        LS.set("audits", [rec].concat(LS.get("audits", [])).slice(0,20));
      }
    }
    // PageSpeed
    prog.textContent = "Running PageSpeed Insights (" + strategy + ") — this can take up to a minute …";
    const psi = await runPSI(site, strategy);
    out.innerHTML += psiHtml(psi, site, strategy);
    lastAudit = { site, score: psi.score, lcp: psi.lcp, cls: psi.cls, date: todayISO() };
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
    out.innerHTML += '<div class="err"><b>Check failed:</b> ' + esc(e.message||e) + '</div>';
    prog.textContent = "";
  }finally{
    btn.disabled = false; psiBtn.disabled = false;
    renderAuditHistory();
  }
}
async function runPSI(url, strategy){
  const key = (LS.get("settings", {}).psiKey||"").trim();
  let api = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=" + encodeURIComponent(url) + "&strategy=" + strategy;
  if(key) api += "&key=" + encodeURIComponent(key);
  let res;
  try{ res = await fetchTimeout(api, 120000); }
  catch(e){ throw new Error("PageSpeed request timed out after 120s. Google's service may be slow — retry."); }
  let data = {};
  try{ data = await res.json(); }catch(e){ throw new Error("PageSpeed returned an unreadable response (HTTP " + res.status + ")."); }
  if(!res.ok){
    const msg = (data.error && data.error.message) || ("HTTP " + res.status);
    if(res.status===429) throw new Error("PageSpeed Insights quota exhausted (HTTP 429): " + msg + " The free no-key quota is shared and often runs out. Add a free API key in Ad Revenue → Settings, or retry later.");
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
function psiHtml(psi, site, strategy){
  let seoRows = psi.seo.map(s => {
    const pill = s.score===1 ? '<span class="pill ok">Pass</span>' : (s.score===0 ? '<span class="pill bad">Fail</span>' : '<span class="pill info">Info</span>');
    return "<tr><td>" + esc(s.title) + "</td><td>" + pill + "</td><td class='muted'>" + esc(s.display) + "</td></tr>";
  }).join("");
  return '<div class="card" style="margin-top:10px"><h3>PageSpeed Insights — ' + esc(strategy) + '</h3>'
    + '<p><span class="score">' + (psi.score==null?"—":psi.score) + '</span> <span class="muted">/ 100 performance</span></p>'
    + '<p>LCP: <b>' + esc(psi.lcp||"not reported") + '</b> &nbsp;·&nbsp; CLS: <b>' + esc(psi.cls||"not reported") + '</b> &nbsp;·&nbsp; Final URL: <span class="muted">' + esc(psi.finalUrl||site) + '</span></p>'
    + '<h3>SEO checks returned by PageSpeed</h3>'
    + (seoRows ? '<div style="overflow-x:auto"><table><tr><th>Check</th><th>Result</th><th>Detail</th></tr>' + seoRows + '</table></div>' : '<p class="muted">No SEO audit items returned.</p>')
    + '</div>';
}
function renderAuditHistory(){
  const list = S.get("audits", []);
  $("auditHistory").innerHTML = list.length ? list.map(a => {
    const statPills = (a.ok!=null)
      ? '<span class="pill ok">' + a.ok + ' OK</span> <span class="pill bad">' + a.failed + ' failed</span>'
      : '';
    const psiPill = (a.psi!=null ? ' <span class="pill info">PageSpeed ' + a.psi + '/100</span>' : '');
    const lc = (a.lcp ? ' <span class="muted">LCP ' + esc(a.lcp) + (a.cls ? ' · CLS ' + esc(a.cls) : '') + '</span>' : '');
    return '<div class="listing"><b>' + esc(a.url) + '</b> <span class="muted">— ' + fmtDate(a.date) + '</span><br>'
      + statPills + psiPill + lc + '</div>';
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
  const { text } = await fetchViaProxy(api, 12000);
  const j = JSON.parse(text);
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
      if(!checkKeywordLimit()) return;
      const res = await saveKeyword(b.dataset.saveKw, "", kwDiffCache[b.dataset.saveKw.toLowerCase()]);
      if(res === 'saved'){ b.textContent = "Saved ✓"; b.disabled = true; renderRankList(); renderDashboard(); renderLimitNotes(); }
      else if(res === 'duplicate'){ b.textContent = "Already tracked"; b.disabled = true; }
      else { alert("Could not save that keyword — check your connection and retry."); }
    }));
    out.querySelectorAll("[data-diff-kw]").forEach(b => b.addEventListener("click", async () => {
      b.disabled = true; b.textContent = "Checking…";
      try{
        const d = await estimateDifficulty(b.dataset.diffKw);
        kwDiffCache[b.dataset.diffKw.toLowerCase()] = d.score;
        b.textContent = "KD " + d.score + " · " + d.label;
        b.title = "Estimate from the live DuckDuckGo top 10 — not a paid index";
      }catch(e){ b.textContent = "Failed — retry"; b.disabled = false; alert("Difficulty check failed: " + (e.message||e)); }
    }));
  }
  btn.disabled = false;
}
$("kwBtn").addEventListener("click", runKeywords);

/* ---------- Rank Tracker ---------- */
function checkKeywordLimit(){
  if(S.mode!=='cloud' || currentPlan==='pro') return true;
  const used = S.get("keywords", []).length;
  if(used >= PLAN_LIMITS.keywordsTotal){
    alert("Free plan: you are tracking " + used + " of " + PLAN_LIMITS.keywordsTotal + " keywords. Upgrade to Pro ($9/month) for unlimited keywords.");
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
    let { data, error } = await sb.from("keywords").insert(payload).select("id").single();
    if(error && difficulty != null){
      /* The difficulty column may not exist yet — retry without it. */
      const r2 = await sb.from("keywords").insert({ user_id:currentUser.id, keyword, url:url||"" }).select("id").single();
      data = r2.data; error = r2.error;
    }
    if(error || !data){ console.error("keyword save failed", error); return 'error'; }
    list.push({ id:data.id, keyword, url:url||"", checks:[], difficulty: (difficulty==null?null:difficulty) });
    return 'saved';
  }
  list.push({ keyword, url:url||"", checks:[], difficulty: (difficulty==null?null:difficulty) });
  LS.set("keywords", list);
  return 'saved';
}
$("rkAddBtn").addEventListener("click", async () => {
  const kw = ($("rkKw").value||"").trim(), url = ($("rkUrl").value||"").trim();
  if(!kw){ alert("Enter a keyword first."); return; }
  const list = S.get("keywords", []);
  if(list.some(k => k.keyword.toLowerCase()===kw.toLowerCase())){ alert("That keyword is already tracked."); return; }
  if(!checkKeywordLimit()) return;
  const res = await saveKeyword(kw, url);
  if(res !== 'saved'){ alert("Could not save that keyword — check your connection and retry."); return; }
  $("rkKw").value = ""; $("rkUrl").value = "";
  renderRankList(); renderDashboard(); renderLimitNotes();
});
function renderRankList(){
  const list = S.get("keywords", []);
  if(!list.length){ $("rkList").innerHTML = '<p class="muted">No keywords tracked yet. Add one above, or save suggestions from the Keyword Explorer.</p>'; return; }
  $("rkList").innerHTML = list.map((k, i) => {
    const last = k.checks.length ? k.checks[k.checks.length-1] : null;
    const hist = k.checks.slice(-5).reverse().map(c =>
      '<li>' + fmtDate(c.date) + ': ' + (c.position ? 'position ' + c.position : 'not in top results') + ' (DuckDuckGo)</li>').join("");
    return '<div class="listing"><b>' + esc(k.keyword) + '</b> <span class="muted">→ ' + esc(k.url||"(no target URL set)") + '</span><br>'
      + (last ? '<span class="pill ' + (last.position ? 'ok' : 'warn') + '">Last: ' + (last.position ? '#' + last.position : 'not found') + ' · ' + fmtDate(last.date) + '</span>' : '<span class="pill info">Never checked</span>')
      + (k.difficulty!=null ? ' <span class="pill info">Difficulty ' + k.difficulty + '/100</span>' : '')
      + ' <button class="btn small" data-check="' + i + '">Check now</button>'
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
    }catch(e){ alert("Difficulty check failed: " + (e.message||e)); b.disabled = false; b.textContent = "Difficulty"; }
  }));
  $("rkList").querySelectorAll("[data-del-kw]").forEach(b => b.addEventListener("click", async () => {
    const list2 = S.get("keywords", []);
    const item = list2[+b.dataset.delKw];
    if(S.mode==='cloud' && item && item.id){
      const { error } = await sb.from("keywords").delete().eq("id", item.id);
      if(error){ alert("Could not remove that keyword: " + error.message); return; }
    }
    list2.splice(+b.dataset.delKw, 1);
    if(S.mode==='local') LS.set("keywords", list2);
    renderRankList(); renderDashboard(); renderLimitNotes();
  }));
}
async function checkRank(idx, btn){
  const list = S.get("keywords", []);
  const item = list[idx]; if(!item) return;
  if(!item.url){ alert("Set a target URL for this keyword first (edit it by removing and re-adding)."); return; }
  btn.disabled = true; btn.textContent = "Checking…";
  try{
    const target = normHost(new URL(item.url.startsWith("http")?item.url:"https://"+item.url).hostname);
    const ddg = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(item.keyword);
    const { text } = await fetchViaProxy(ddg, 20000);
    const doc = new DOMParser().parseFromString(text, "text/html");
    const links = [...doc.querySelectorAll("a.result__a")].map(a => a.getAttribute("href")||"");
    if(!links.length) throw new Error("Search results could not be parsed; the request may be blocked. No ranking was saved.");
    let position = null;
    for(let i=0;i<links.length;i++){
      let href = links[i];
      try{
        const m = href.match(/[?&]uddg=([^&]+)/);
        if(m) href = decodeURIComponent(m[1]);
        const host = normHost(new URL(href, "https://duckduckgo.com").hostname);
        if(host === target || host.endsWith("." + target)){ position = i+1; break; }
      }catch(e){ /* skip bad href */ }
    }
    if(S.mode==='cloud' && item.id){
      const { error } = await sb.from("rank_checks").insert({ user_id:currentUser.id, keyword_id:item.id, position, checked_at:todayISO()+"T12:00:00Z" });
      if(error) throw new Error("Rank check could not be saved: " + error.message);
    }
    item.checks.push({ date: todayISO(), position });
    if(S.mode==='local') LS.set("keywords", list);
    renderRankList(); renderDashboard();
  }catch(e){
    alert("Rank check failed: " + (e.message||e) + "\nThe free proxy or DuckDuckGo may be unreachable — retry later.");
    btn.disabled = false; btn.textContent = "Check now";
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
  if(S.mode==='cloud' && currentPlan!=='pro'){
    const used = usageThisMonth().linksUsed;
    if(used >= PLAN_LIMITS.linkChecksPerMonth){
      out.innerHTML = '<div class="warn"><b>Free plan limit reached.</b> You have used ' + used + ' of ' + PLAN_LIMITS.linkChecksPerMonth + ' link verifications this month. <button class="btn small" data-action="upgrade">Upgrade to Pro — $9/month</button> for unlimited checks.</div>';
      btn.disabled=false; return;
    }
  }
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
        const { error } = await sb.from("verified_links").insert({ user_id:currentUser.id, page_url:page, target_domain:domain, anchor:null, rel:null, found:false, checked_at:checkedAt });
        if(error){ out.innerHTML += '<div class="warn">Saving this check to your account failed: ' + esc(error.message) + '</div>'; }
        else{
          const saved = S.get("links", []);
          saved.unshift({ date:todayISO(), page, domain, count:0, types:"No link found" });
          S.cache.links = saved.slice(0,50);
        }
      }
    }else{
      const rows = hits.map(h => {
        const c = classifyRel(h.rel);
        return "<tr><td>" + esc(h.anchor) + "</td><td>" + esc(h.href) + "</td><td><span class='pill " + c.cls + "'>" + c.label + "</span><br><span class='muted'>rel=\"" + esc(h.rel||"(none)") + "\"</span></td></tr>";
      }).join("");
      out.innerHTML = '<div class="okbox"><b>' + hits.length + ' link' + (hits.length>1?"s":"") + ' to ' + esc(domain) + ' found</b> on ' + esc(page) + '.</div>'
        + '<div style="overflow-x:auto"><table><tr><th>Anchor text</th><th>Link</th><th>Type</th></tr>' + rows + '</table></div>'
        + '<p class="muted">Paid/sponsored links should be rel="sponsored" (or nofollow). A paid link showing as Dofollow needs fixing.</p>';
      const types = [...new Set(hits.map(h => classifyRel(h.rel).label))].join(", ");
      if(S.mode==='cloud'){
        const { error } = await sb.from("verified_links").insert(hits.map(h => ({ user_id:currentUser.id, page_url:page, target_domain:domain, anchor:h.anchor, rel:h.rel||null, found:true, checked_at:checkedAt })));
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
    '<div class="listing"><b>' + esc(l.domain) + '</b> on <span class="muted">' + esc(l.page) + '</span><br>'
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
    const list = S.get("revenue", []);
    const item = list[+b.dataset.delRev];
    if(S.mode==='cloud' && item && item.id){
      const { error } = await sb.from("revenue_entries").delete().eq("id", item.id);
      if(error){ alert("Could not delete that entry: " + error.message); return; }
    }
    list.splice(+b.dataset.delRev, 1);
    if(S.mode==='local') LS.set("revenue", list);
    renderRevenue(); renderDashboard();
  }));
}
$("revAddBtn").addEventListener("click", async () => {
  const amt = parseFloat($("revAmt").value);
  if(isNaN(amt) || amt < 0){ alert("Enter a valid amount (0 or more)."); return; }
  const rec = { date: $("revDate").value || todayISO(), network: $("revNet").value, amount: amt };
  if(S.mode==='cloud'){
    const { data, error } = await sb.from("revenue_entries").insert({ user_id:currentUser.id, entry_date:rec.date, network:rec.network, amount:rec.amount }).select("id").single();
    if(error || !data){ alert("Could not log that revenue: " + (error ? error.message : "unknown error")); return; }
    rec.id = data.id;
    S.get("revenue", []).push(rec);
  }else{
    const entries = LS.get("revenue", []);
    entries.push(rec);
    LS.set("revenue", entries);
  }
  $("revAmt").value = "";
  renderRevenue(); renderDashboard();
});
function loadSettings(){
  const s = LS.get("settings", {});
  $("setPsi").value = s.psiKey||"";
  $("setAdsterra").value = s.adsterraKey||"";
  $("setMonetag").value = s.monetagKey||"";
  $("setAdsense").value = s.adsenseKey||"";
}
$("setSaveBtn").addEventListener("click", () => {
  LS.set("settings", { psiKey:$("setPsi").value.trim(), adsterraKey:$("setAdsterra").value.trim(), monetagKey:$("setMonetag").value.trim(), adsenseKey:$("setAdsense").value.trim() });
  $("setSaved").textContent = "Saved in this browser.";
  setTimeout(() => { $("setSaved").textContent = ""; }, 3000);
});

/* ---------- Marketplace ---------- */
const SEED_LISTINGS = [
  { id:"seed-1", site:"https://www.lookforit.xyz", niche:"AI tools directory", price:20, da:"", dr:"", title:"LookForIt — Sponsored listing", desc:"Your AI tool listed on lookforit.xyz (153 verified tools, 20 categories). One-time payment, live within 24 hours, marked sponsored." },
  { id:"seed-2", site:"https://www.lookforit.xyz", niche:"AI tools directory", price:49, da:"", dr:"", title:"LookForIt — Manual review", desc:"Hands-on review of your AI tool, written up properly and listed on LookForIt. One-time $49." },
  { id:"seed-3", site:"https://www.estatepath.online", niche:"Real estate (Florida, USA)", price:null, da:"", dr:"", title:"Estate Path — Guest post", desc:"Guest post on the Estate Path real estate blog. Price: DM for rates — no fixed price." }
];
function allListings(){ return SEED_LISTINGS.concat(S.get("listings", [])); }
async function placeOrder(l){
  if(S.mode==='cloud'){
    let listingId = l.id;
    if(String(listingId).indexOf("seed-") === 0){
      /* Seed listings live only in the page, not in the listings table.
         Copy the seed listing into the user's listings so the order's
         foreign key has a real row to point at. */
      const { data, error } = await sb.from("listings").insert({ user_id:currentUser.id, site_url:l.site, niche:l.niche, price:l.price, da:null, dr:null, listing_type:"seed-copy" }).select("id").single();
      if(error || !data){ alert("Could not place that order: " + (error ? error.message : "unknown error")); return false; }
      listingId = data.id;
      S.cache.listings.push({ id:data.id, site:l.site, niche:l.niche, price:l.price, da:"", dr:"", title:l.title, desc:l.desc });
    }
    const { data: ord, error: oerr } = await sb.from("orders").insert({ user_id:currentUser.id, listing_id:listingId, status:"pending" }).select("id").single();
    if(oerr || !ord){ alert("Could not place that order: " + (oerr ? oerr.message : "unknown error")); return false; }
    const orders = S.get("orders", []);
    orders.unshift({ id:ord.id, date:todayISO(), listing:l.title, site:l.site, price:l.price, status:"pending", listing_id:listingId });
    return true;
  }
  const orders = LS.get("orders", []);
  orders.unshift({ date:todayISO(), listing:l.title, site:l.site, price:l.price, status:"pending" });
  LS.set("orders", orders);
  return true;
}
function renderMarket(){
  const listings = allListings();
  $("mktList").innerHTML = listings.map(l =>
    '<div class="listing"><b>' + esc(l.title) + '</b> — <span class="muted">' + esc(l.niche) + '</span><br>'
    + '<span class="muted">' + esc(l.desc||"") + '</span><br>'
    + '<a href="' + esc(normaliseSite(l.site)) + '" target="_blank" rel="noopener">' + esc(l.site) + '</a><br>'
    + '<span class="price">' + (l.price==null ? 'DM for rates' : '$' + l.price + ' one-time') + '</span>'
    + (l.da!=="" && l.da!=null ? ' · DA ' + esc(l.da) : '') + (l.dr!=="" && l.dr!=null ? ' · DR ' + esc(l.dr) : '')
    + ' <button class="btn small" data-order="' + esc(l.id) + '">Order</button></div>').join("");
  $("mktList").querySelectorAll("[data-order]").forEach(b => b.addEventListener("click", async () => {
    const l = allListings().find(x => x.id === b.dataset.order);
    if(!l) return;
    b.disabled = true;
    await placeOrder(l);
    b.disabled = false;
    renderMarket(); renderDashboard();
  }));
  const orders = S.get("orders", []);
  $("mktOrders").innerHTML = orders.length ? orders.map((o,i) =>
    '<div class="listing"><b>' + esc(o.listing) + '</b> <span class="muted">— ' + fmtDate(o.date) + '</span><br>'
    + '<span class="pill warn">' + esc(o.status) + '</span> ' + (o.price==null ? 'DM for rates' : '$' + o.price)
    + ' <button class="btn small secondary" data-complete-order="' + i + '">Mark completed</button>'
    + ' <button class="btn small danger" data-del-order="' + i + '">Delete</button></div>').join("")
    : '<p class="muted">No orders yet. Orders are records only — contact the buyer yourself to complete the sale. No payments are taken here.</p>';
  $("mktOrders").querySelectorAll("[data-complete-order]").forEach(b => b.addEventListener("click", async () => {
    const o = S.get("orders", []);
    const item = o[+b.dataset.completeOrder];
    if(S.mode==='cloud' && item && item.id){
      const { error } = await sb.from("orders").update({ status:"completed" }).eq("id", item.id);
      if(error){ alert("Could not update that order: " + error.message); return; }
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
      if(error){ alert("Could not delete that order: " + error.message); return; }
    }
    o.splice(+b.dataset.delOrder, 1);
    if(S.mode==='local') LS.set("orders", o);
    renderMarket(); renderDashboard();
  }));
}
$("mkAddBtn").addEventListener("click", async () => {
  const site = normaliseSite($("mkSite").value);
  const priceRaw = $("mkPrice").value;
  if(!site){ alert("Enter the site URL."); return; }
  const price = priceRaw==="" ? null : parseFloat(priceRaw);
  if(price!==null && (isNaN(price) || price<0)){ alert("Enter a valid price, or leave it blank for DM for rates."); return; }
  const niche = ($("mkNiche").value||"").trim()||"General";
  const da = $("mkDa").value===""?"":$("mkDa").value;
  const dr = $("mkDr").value===""?"":$("mkDr").value;
  if(S.mode==='cloud'){
    const { data, error } = await sb.from("listings").insert({ user_id:currentUser.id, site_url:site, niche, price, da:(da===""?null:parseInt(da,10)), dr:(dr===""?null:parseInt(dr,10)), listing_type:"custom" }).select("id").single();
    if(error || !data){ alert("Could not add that listing: " + (error ? error.message : "unknown error")); return; }
    S.get("listings", []).push({ id:data.id, site, niche, price, da, dr, title:site.replace(/^https?:\/\//,""), desc:"Custom listing added by you." });
  }else{
    const listings = LS.get("listings", []);
    listings.push({ id:"custom-" + Date.now(), site, niche, price, da, dr, title:site.replace(/^https?:\/\//,""), desc:"Custom listing added by you." });
    LS.set("listings", listings);
  }
  ["mkSite","mkNiche","mkPrice","mkDa","mkDr"].forEach(id => { $(id).value = ""; });
  renderMarket();
});

/* ================= v2.6 integrations ================= */
/* Google OAuth (Search Console + Analytics, read-only), email alerts + share.
   Tokens and secrets live in Supabase (edge functions + google_tokens table) —
   nothing secret is in this file. The Google client ID above is a placeholder
   until the OAuth client is created; the connect button says so honestly. */
let lastAudit = null; /* { site, score, lcp, cls, date } — for the share buttons */
let googleConnected = false;

function fetchJsonTimeout(url, ms, opts){
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  const o = Object.assign({}, opts || {}, { signal: c.signal });
  return fetch(url, o).finally(() => clearTimeout(t));
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
    showApp();
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
  if(t){ e.preventDefault(); connectGoogle(); }
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
  let savedState = null;
  try{ savedState = sessionStorage.getItem("seoforge.googleState"); }catch(e){}
  const verifier = sessionStorage.getItem("seoforge.googleVerifier");
  sessionStorage.removeItem("seoforge.googleVerifier");
  const owner = sessionStorage.getItem("seoforge.googleUser");
  const issued = Number(sessionStorage.getItem("seoforge.googleTime"));
  sessionStorage.removeItem("seoforge.googleState");
  sessionStorage.removeItem("seoforge.googleUser");
  sessionStorage.removeItem("seoforge.googleTime");
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
}
async function renderGoogleStatus(){
  if(!currentUser){ setGoogleStatusUI(false, "Sign in to SEOForge first, then connect Google."); return; }
  try{
    const data = await googleApi("status", {});
    setGoogleStatusUI(!!data.connected, data.connected ? "" : "Google is not connected.");
  }catch(e){
    setGoogleStatusUI(false, "Google connection is not available yet — " + (e.message || e));
  }
}
async function disconnectGoogle(){
  if(!confirm("Disconnect Google? SEOForge will delete its stored Google tokens and stop reading your Search Console and Analytics data.")) return;
  try{
    await googleApi("disconnect", {});
    showBanner("Google disconnected.", 'ok');
  }catch(e){
    showBanner("Disconnect failed: " + (e.message || e), 'warn');
  }
  renderGoogleStatus();
}
$("gscDisconnectBtn").addEventListener("click", disconnectGoogle);
$("intDisconnectBtn").addEventListener("click", disconnectGoogle);
function defaultDateRange(){
  const end = new Date(), start = new Date(Date.now() - 27*24*3600*1000);
  const iso = d => d.toISOString().slice(0,10);
  if($("gscStart") && !$("gscStart").value) $("gscStart").value = iso(start);
  if($("gscEnd") && !$("gscEnd").value) $("gscEnd").value = iso(end);
}
async function loadGscSites(){
  const prog = $("gscProg"); prog.textContent = "Loading your verified sites from Search Console …";
  try{
    const data = await googleApi("sites", {});
    const sel = $("gscSite");
    const sites = (data.sites || []);
    if(!sites.length){ sel.innerHTML = '<option value="">No verified sites found for this Google account</option>'; prog.textContent = ""; return; }
    sel.innerHTML = sites.map(s => '<option value="' + esc(s.siteUrl) + '">' + esc(s.siteUrl) + '</option>').join("");
    prog.textContent = sites.length + " verified site(s) loaded.";
  }catch(e){ prog.textContent = ""; $("gscOut").innerHTML = '<div class="err">Could not load sites: ' + esc(e.message || e) + '</div>'; }
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
    out.innerHTML = '<p><span class="pill ok">' + (t.clicks||0) + ' clicks</span> <span class="pill info">' + (t.impressions||0) + ' impressions</span> <span class="pill info">CTR ' + (((t.ctr||0)*100).toFixed(2)) + '%</span> <span class="pill info">Avg position ' + ((t.position==null)?"—":(+t.position).toFixed(1)) + '</span></p>'
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
    out.innerHTML = '<div class="grid"><div class="stat"><b>' + (data.sessions||0) + '</b><span>sessions (28 days)</span></div><div class="stat"><b>' + (data.users||0) + '</b><span>users (28 days)</span></div></div>'
      + '<p class="muted">Source: Google Analytics Data API (GA4), last 28 days, property ' + esc(prop) + '.</p>';
  }catch(e){ prog.textContent = ""; out.innerHTML = '<div class="err">GA4 report failed: ' + esc(e.message || e) + '</div>'; }
}
$("gscLoadSitesBtn").addEventListener("click", loadGscSites);
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
  const box = $("notifWeekly"); if(!box) return;
  const val = !!box.checked;
  let saved = false;
  if(currentUser && sb){
    try{
      const { error } = await sb.from("profiles").update({ weekly_summary: val }).eq("id", currentUser.id);
      if(!error) saved = true;
    }catch(e){ saved = false; }
  }
  if(!saved) LS.set("notifWeekly", val);
  $("notifSaved").textContent = saved
    ? "Saved to your account."
    : "Saved in this browser (the account column is not set up yet — see README).";
  setTimeout(() => { $("notifSaved").textContent = ""; }, 4000);
}
$("notifSaveBtn").addEventListener("click", saveNotifPref);

/* ---------- share / export (client-side, no keys) ---------- */
function auditShareText(a){
  return "SEOForge audit: " + a.site + " — PageSpeed " + (a.score==null?"—":a.score) + "/100"
    + (a.lcp ? ", LCP " + a.lcp : "") + (a.cls ? ", CLS " + a.cls : "")
    + ". Checked " + a.date + " with SEOForge.";
}
function shareBarHtml(a){
  const host = normHost(a.site.replace(/^https?:\/\//,"").split("/")[0]);
  return '<div class="card" style="margin-top:10px"><h3>Share this audit</h3>'
    + '<div class="row"><button class="btn secondary" data-share="web">Share…</button>'
    + '<button class="btn secondary" data-share="x">Post on X</button>'
    + '<button class="btn secondary" data-share="linkedin">Post on LinkedIn</button>'
    + '<button class="btn secondary" data-share="copy">Copy summary</button></div>'
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
async function shareAudit(kind){
  if(!lastAudit){ alert("Run an audit first, then share it."); return; }
  const text = auditShareText(lastAudit);
  const pageUrl = "https://syedsenterprises.github.io/seoforge/";
  if(kind === "web"){
    if(navigator.share){
      try{ await navigator.share({ title: "SEOForge audit — " + lastAudit.site, text, url: pageUrl }); return; }
      catch(e){ if(e && e.name === "AbortError") return; }
    }
    const ok = await copyText(text + " " + pageUrl);
    alert(ok ? "Sharing is not supported in this browser — the summary was copied instead." : "Sharing is not supported in this browser.");
    return;
  }
  if(kind === "copy"){
    const ok = await copyText(text + " " + pageUrl);
    alert(ok ? "Audit summary copied." : "Could not copy — select the text manually.");
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
  const m = thisMonthPrefix();
  const briefsUsed = S.get("briefs", []).filter(b => (b.date||"").indexOf(m)===0).length;
  const compRows = S.get("competitors", []).filter(c => (c.date||"").indexOf(m)===0).length;
  const comparesUsed = Math.floor(compRows/2); /* one compare saves two rows (one per URL) */
  const toolChecksUsed = S.get("toolChecks", []).filter(t => (t.date||"").indexOf(m)===0).length;
  return { briefsUsed, comparesUsed, toolChecksUsed };
}
function limitBlocked(outEl, used, limit, what){
  outEl.innerHTML = '<div class="warn"><b>Free plan limit reached.</b> You have used ' + used + ' of ' + limit + ' ' + what + ' this month. <button class="btn small" data-action="upgrade">Upgrade to Pro — $9/month</button> for unlimited use.</div>';
}
function checkToolLimit(outEl){
  if(S.mode!=='cloud' || currentPlan==='pro') return true;
  const used = v25Usage().toolChecksUsed;
  if(used >= PLAN_LIMITS.toolChecksPerMonth){ limitBlocked(outEl, used, PLAN_LIMITS.toolChecksPerMonth, "tool checks"); return false; }
  return true;
}
function checkBriefLimit(outEl){
  if(S.mode!=='cloud' || currentPlan==='pro') return true;
  const used = v25Usage().briefsUsed;
  if(used >= PLAN_LIMITS.briefsPerMonth){ limitBlocked(outEl, used, PLAN_LIMITS.briefsPerMonth, "content briefs"); return false; }
  return true;
}
function checkCompareLimit(outEl){
  if(S.mode!=='cloud' || currentPlan==='pro') return true;
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
async function fetchPageDoc(url, timeoutMs){
  const { text, status } = await fetchViaProxy(url, timeoutMs||20000);
  if(!status || status < 200 || status >= 300) throw new Error("Page fetch failed (HTTP " + (status||"proxy error") + "). Check the URL and retry.");
  const doc = new DOMParser().parseFromString(text, "text/html");
  return { doc, status, text };
}
function pageWordCount(doc){
  const body = doc.body; if(!body) return 0;
  const clone = body.cloneNode(true);
  clone.querySelectorAll("script,style,noscript,svg").forEach(n => n.remove());
  return (clone.textContent||"").trim().split(/\s+/).filter(Boolean).length;
}
async function ddgTopResults(keyword, n){
  const ddg = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(keyword);
  const { text } = await fetchViaProxy(ddg, 20000);
  const doc = new DOMParser().parseFromString(text, "text/html");
  const out = [];
  doc.querySelectorAll("a.result__a").forEach(a => {
    if(out.length >= n) return;
    let href = a.getAttribute("href")||"";
    const m = href.match(/[?&]uddg=([^&]+)/);
    if(m){ try{ href = decodeURIComponent(m[1]); }catch(e){} }
    if(!/^https?:\/\//i.test(href)) return;
    out.push({ url: href, title: (a.textContent||"").trim() });
  });
  if(!out.length) throw new Error("Search results unavailable or blocked; no ranking can be inferred.");
  return out;
}

/* ---------- 1. SERP Preview + Meta/OG checker ---------- */
async function runSerp(){
  const out = $("serpOut"), prog = $("serpProg");
  out.innerHTML = ""; prog.textContent = "Fetching page…";
  const url = normaliseSite($("serpUrl").value);
  if(!url){ out.innerHTML = '<div class="err">Enter a page URL first.</div>'; prog.textContent=""; return; }
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
  }
}
$("serpBtn").addEventListener("click", runSerp);

/* ---------- 2. Broken Link Checker ---------- */
async function runBrokenLinks(){
  const out = $("blOut"), prog = $("blProg");
  out.innerHTML = ""; prog.textContent = "";
  const page = normaliseSite($("blUrl").value);
  if(!page){ out.innerHTML = '<div class="err">Enter a page URL first.</div>'; return; }
  if(!checkToolLimit(out)) return;
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
          results[i+j] = { url:l.url, anchor:l.anchor, status: r.status, ok: r.ok, proxyErr: false };
        }catch(e){ results[i+j] = { url:l.url, anchor:l.anchor, status: null, ok: false, proxyErr: true, err: String(e.message||e) }; }
      }));
      prog.textContent = "Checked " + Math.min(i+BATCH, links.length) + " of " + links.length + " links …";
    }
    const broken = results.filter(r => !r.ok && !r.proxyErr);
    const unverified = results.filter(r => r.proxyErr);
    const okN = results.filter(r => r.ok).length;
    let html = '<p><span class="pill ok">' + okN + ' OK</span> <span class="pill bad">' + broken.length + ' broken</span> <span class="pill warn">' + unverified.length + ' unverified (proxy error)</span></p>';
    html += '<button class="btn secondary" id="blCsvBtn">Export results (CSV)</button>';
    html += '<div style="overflow-x:auto"><table><tr><th>Link</th><th>Status</th><th>Anchor</th></tr>' + results.map(r => {
      const pill = r.ok ? '<span class="pill ok">OK ' + r.status + '</span>' : r.proxyErr ? '<span class="pill warn">Unverified</span>' : '<span class="pill bad">Broken ' + (r.status||"") + '</span>';
      const note = r.proxyErr ? ' <span class="muted">free proxy could not reach it</span>' : '';
      return '<tr><td>' + esc(r.url) + '</td><td>' + pill + note + '</td><td>' + esc(r.anchor||"") + '</td></tr>';
    }).join("") + '</table></div>';
    out.innerHTML = html;
    $("blCsvBtn").addEventListener("click", () => downloadCSV("seoforge-broken-links.csv", ["url","status","anchor"], results.map(r => [r.url, r.ok ? ("OK " + r.status) : r.proxyErr ? "Unverified" : ("Broken " + (r.status||"")), r.anchor||""])));
    prog.textContent = "";
    await recordToolCheck("broken-links", page, okN + " OK, " + broken.length + " broken, " + unverified.length + " unverified of " + links.length + " checked");
  }catch(e){
    out.innerHTML = '<div class="err"><b>Check failed:</b> ' + esc(e.message||e) + '</div>'; prog.textContent = "";
  }
}
$("blBtn").addEventListener("click", runBrokenLinks);

/* ---------- 3. Redirect Chain Checker ---------- */
async function runRedirects(){
  const out = $("rdOut"), prog = $("rdProg");
  out.innerHTML = ""; prog.textContent = "";
  const start = normaliseSite($("rdUrl").value);
  if(!start){ out.innerHTML = '<div class="err">Enter a URL first.</div>'; return; }
  if(!checkToolLimit(out)) return;
  prog.textContent = "Following redirects…";
  const hops = [];
  let current = start;
  try{
    for(let hop=0; hop<10; hop++){
      let moved = false, finished = false;
      for(const p of PROXIES){
        try{
          const c = new AbortController();
          const t = setTimeout(() => c.abort(), 12000);
          let res;
          try{ res = await fetch(p(current), { signal: c.signal, redirect: "manual" }); }
          finally{ clearTimeout(t); }
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
    let finalUrl = null, finalStatus = null;
    try{
      const r = await fetchTimeout("https://api.allorigins.win/get?url=" + encodeURIComponent(start), 15000);
      if(r.ok){
        const j = await r.json();
        if(j.status){ finalUrl = j.status.url || null; finalStatus = j.status.http_code || null; }
      }
    }catch(e){ /* ignore — final URL stays unknown */ }
    let html = "";
    if(hops.length){
      html += '<div style="overflow-x:auto"><table><tr><th>#</th><th>From</th><th>Status</th><th>To</th></tr>' + hops.map((h, i) =>
        '<tr><td>' + (i+1) + '</td><td>' + esc(h.from) + '</td><td>' + (h.status==null ? "—" : h.status) + '</td><td>' + (h.to ? esc(h.to) : '<span class="muted">' + esc(h.note||"final response") + '</span>') + '</td></tr>').join("") + '</table></div>';
    }
    if($("rdPsi").checked){
      try{
        const psi = await runPSI(start, "mobile");
        finalUrl = psi.finalUrl || finalUrl;
        html += '<p class="note">Final URL via PageSpeed: <b>' + esc(finalUrl||"not reported") + '</b></p>';
      }catch(e){
        html += '<div class="warn">PageSpeed final-URL check failed (it only counts against your monthly audits if it ran): ' + esc(e.message||e) + '</div>';
      }
    }
    if(finalUrl) html += '<p><b>Final URL:</b> ' + esc(finalUrl) + (finalStatus ? ' <span class="pill ok">HTTP ' + finalStatus + '</span>' : '') + '</p>';
    html += '<p class="muted">Note: free proxies follow redirects on their own servers, so intermediate hops are only shown when the proxy exposes them. If the chain above stops at one hop, the site redirected but the proxy did not report each step.</p>';
    out.innerHTML = html;
    prog.textContent = "";
    await recordToolCheck("redirect-chain", start, hops.length + " hop(s) observed; final: " + (finalUrl||"unknown"));
  }catch(e){
    out.innerHTML = '<div class="err"><b>Check failed:</b> ' + esc(e.message||e) + '</div>'; prog.textContent = "";
  }
}
$("rdBtn").addEventListener("click", runRedirects);

/* ---------- 4. Schema / JSON-LD Detector ---------- */
async function runSchema(){
  const out = $("scOut"), prog = $("scProg");
  out.innerHTML = ""; prog.textContent = "";
  const url = normaliseSite($("scUrl").value);
  if(!url){ out.innerHTML = '<div class="err">Enter a page URL first.</div>'; return; }
  if(!checkToolLimit(out)) return;
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
    await recordToolCheck("schema", url, blocks.length + " JSON-LD block(s)");
  }catch(e){
    out.innerHTML = '<div class="err"><b>Check failed:</b> ' + esc(e.message||e) + '</div>'; prog.textContent = "";
  }
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
  const out = $("rbOut");
  out.innerHTML = ""; $("rbTest").hidden = true; robotsGroups = null;
  const site = normaliseSite($("rbSite").value);
  if(!site){ out.innerHTML = '<div class="err">Enter a site URL first.</div>'; return; }
  if(!checkToolLimit(out)) return;
  try{
    const { text, status } = await fetchViaProxy(site + "/robots.txt", 15000);
    if(status === 404){
      out.innerHTML = '<div class="warn"><b>No robots.txt found</b> (HTTP 404 at ' + esc(site) + '/robots.txt). That means everything is allowed to crawlers.</div>';
      robotsGroups = []; $("rbTest").hidden = false;
      await recordToolCheck("robots", site, "no robots.txt (404)");
      return;
    }
    robotsGroups = parseRobots(text);
    const sm = [];
    robotsGroups.forEach(g => (g.sitemaps||[]).forEach(s => sm.push(s)));
    out.innerHTML = '<p><span class="pill ok">robots.txt found</span> ' + (sm.length ? 'Sitemaps listed: ' + esc(sm.join(", ")) : 'No sitemap listed in robots.txt.') + '</p><pre class="raw">' + esc(text.slice(0, 8000)) + '</pre>';
    $("rbTest").hidden = false;
    await recordToolCheck("robots", site, "robots.txt fetched (" + text.length + " chars)");
  }catch(e){
    out.innerHTML = '<div class="err"><b>Fetch failed:</b> ' + esc(e.message||e) + '</div>';
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
  const out = $("smOut"), prog = $("smProg");
  out.innerHTML = ""; prog.textContent = "";
  const site = normaliseSite($("smSite").value);
  if(!site){ out.innerHTML = '<div class="err">Enter a site URL first.</div>'; return; }
  if(!checkToolLimit(out)) return;
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
    const today = todayISO();
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
      + list.map(u => '  <url><loc>' + esc(u) + '</loc><lastmod>' + today + '</lastmod></url>').join("\n")
      + '\n</urlset>\n';
    out.innerHTML = '<div class="okbox"><b>' + list.length + ' internal URL(s) found</b> on the homepage' + (urls.size > 50 ? ' (showing the first 50)' : '') + '. Only links from the homepage are included — deeper pages are not crawled.</div>'
      + '<pre class="raw">' + esc(xml) + '</pre>'
      + '<div class="row"><button class="btn secondary" id="smCopyBtn">Copy XML</button><button class="btn" id="smDlBtn">Download sitemap.xml</button></div>';
    $("smCopyBtn").addEventListener("click", () => { if(navigator.clipboard) navigator.clipboard.writeText(xml); });
    $("smDlBtn").addEventListener("click", () => downloadFile("sitemap.xml", xml, "application/xml"));
    prog.textContent = "";
    await recordToolCheck("sitemap", site, list.length + " internal URLs");
  }catch(e){
    out.innerHTML = '<div class="err"><b>Generation failed:</b> ' + esc(e.message||e) + '</div>'; prog.textContent = "";
  }
}
$("rbFetchBtn").addEventListener("click", runRobotsFetch);
$("rbTestBtn").addEventListener("click", robotsTest);
$("rgBtn").addEventListener("click", runRobotsGen);
$("smBtn").addEventListener("click", runSitemapGen);

/* ---------- 7. Keyword Difficulty estimator ---------- */
const AUTHORITY_DOMAINS = ["wikipedia.org","amazon.com","amazon.in","youtube.com","google.com","facebook.com","instagram.com","reddit.com","medium.com","forbes.com","nytimes.com","bbc.com","bbc.co.uk","linkedin.com","twitter.com","x.com","quora.com","stackoverflow.com","github.com","apple.com","microsoft.com","adobe.com","shopify.com","hubspot.com","moz.com","semrush.com","ahrefs.com","neilpatel.com","searchengineland.com","healthline.com","webmd.com","mayoclinic.org","investopedia.com","nerdwallet.com","bankrate.com","cnet.com","techcrunch.com","theverge.com","wired.com","coursera.org","udemy.com","khanacademy.org","etsy.com","ebay.com","walmart.com","target.com","theguardian.com","cnn.com"];
async function estimateDifficulty(keyword){
  const results = await ddgTopResults(keyword, 10);
  if(!results.length) throw new Error("No DuckDuckGo results returned for that keyword.");
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
  html += '<h3>Pages to beat</h3><table><tr><th>Page</th><th>H1 / title</th><th>Words (est.)</th></tr>' + b.competitors.map(p => '<tr><td>' + esc(p.url) + '</td><td>' + esc(p.h1||"—") + '</td><td>' + (p.words==null ? "could not read" : p.words.toLocaleString("en-GB")) + '</td></tr>').join("") + '</table></div>';
  return html;
}
function briefText(b){
  const lines = ["SEOForge content brief", "Keyword: " + b.keyword, ""];
  if(b.targetWordCount) lines.push("Target length: about " + b.targetWordCount + " words (median of top pages, rounded up — estimate).", "");
  if(b.headings.length){ lines.push("Suggested headings:"); b.headings.forEach(h => lines.push("- " + h)); lines.push(""); }
  if(b.questions.length){ lines.push("Questions to answer:"); b.questions.forEach(q => lines.push("- " + q)); lines.push(""); }
  lines.push("Pages to beat:");
  b.competitors.forEach(p => lines.push("- " + p.url + " — " + (p.h1||"") + (p.words!=null ? " (" + p.words + " words, est.)" : "")));
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
  const out = $("brOut"), prog = $("brProg");
  out.innerHTML = ""; prog.textContent = "";
  const kw = ($("brKw").value||"").trim();
  if(!kw){ out.innerHTML = '<div class="err">Enter a target keyword first.</div>'; return; }
  if(!checkBriefLimit(out)) return;
  prog.textContent = "Finding the top 5 pages for “" + kw + "” …";
  try{
    const top = await ddgTopResults(kw, 5);
    if(!top.length) throw new Error("No DuckDuckGo results returned for that keyword.");
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
    const brief = { keyword: kw, targetWordCount: targetWords, headings: headings.slice(0,12), questions: questions.slice(0,10), competitors: pages.map(p => ({ url:p.url, h1:p.h1||p.title, words:p.words })) };
    const saved = await recordBrief(kw, brief);
    out.innerHTML = briefHtml(brief) + '<div class="row"><button class="btn secondary" id="brTxtBtn">Export brief (.txt)</button></div>'
      + (saved ? '<p class="muted">Saved to your briefs.</p>' : '<p class="warn">This brief could not be saved to your account (cloud table missing or offline) — the text above is still yours to copy.</p>');
    $("brTxtBtn").addEventListener("click", () => downloadFile("seoforge-brief-" + kw.replace(/[^a-z0-9]+/gi,"-").toLowerCase() + ".txt", briefText(brief), "text/plain"));
    prog.textContent = "";
    renderBriefs(); renderLimitNotes();
  }catch(e){
    out.innerHTML = '<div class="err"><b>Brief failed:</b> ' + esc(e.message||e) + '</div>'; prog.textContent = "";
  }
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
  const out = $("cpOut"), prog = $("cpProg");
  out.innerHTML = ""; prog.textContent = "";
  const aUrl = normaliseSite($("cpA").value), bUrl = normaliseSite($("cpB").value);
  if(!aUrl || !bUrl){ out.innerHTML = '<div class="err">Enter both URLs first.</div>'; return; }
  if(!checkCompareLimit(out)) return;
  prog.textContent = "Comparing… (PageSpeed runs one after the other — up to a minute each)";
  const rows = [];
  for(const u of [aUrl, bUrl]){
    let psiScore = null, psiErr = null;
    try{ const p = await runPSI(u, "mobile"); psiScore = p.score; }catch(e){ psiErr = e.message||e; }
    let title = "", desc = "", h1s = 0, words = null;
    try{
      const { doc } = await fetchPageDoc(u, 15000);
      title = ((doc.querySelector("title")||{}).textContent||"").trim();
      const m = doc.querySelector('meta[name="description"]');
      desc = m ? (m.getAttribute("content")||"") : "";
      h1s = doc.querySelectorAll("h1").length;
      words = pageWordCount(doc);
    }catch(e){ title = "Could not read page: " + (e.message||e); }
    rows.push({ url: u, psiScore, psiErr, title, desc, h1s, words });
  }
  const cell = (r, key) => {
    if(key === 'psi') return r.psiScore==null ? '<span class="pill warn">Not checked</span><br><span class="muted">' + esc((r.psiErr||"").slice(0,140)) + '</span>' : '<span class="score" style="font-size:24px">' + r.psiScore + '</span><span class="muted"> /100</span>';
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
    + '</table></div><p class="muted">PageSpeed scores come from Google; the on-page numbers come from reading each page live. Word counts are estimates from visible text.</p>';
  prog.textContent = "";
  await recordCompetitors([aUrl, bUrl]);
  renderCompetitors(); renderLimitNotes();
}
async function recordCompetitors(urls){
  if(S.mode === "cloud"){
    const {data,error} = await sb.from("competitors").insert(urls.map(url=>({user_id:currentUser.id,url}))).select("*");
    if(error) throw new Error("Comparison could not be saved: " + error.message);
    S.cache.competitors.unshift(...data.map(r=>({id:r.id,date:todayISO(),url:r.url})));
  } else LS.set("competitors", urls.map(url=>({date:todayISO(),url})).concat(LS.get("competitors",[])).slice(0,100));
}

function renderCompetitors(){
  const list = S.get("competitors", []);
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

/* ---------- 12. SEO Health Checklist ---------- */
async function runHealth(){
  const out = $("hcOut"), prog = $("hcProg");
  out.innerHTML = ""; prog.textContent = "";
  const url = normaliseSite($("hcUrl").value);
  if(!url){ out.innerHTML = '<div class="err">Enter a page URL first.</div>'; return; }
  /* The PageSpeed check inside the health check counts as one site audit. */
  if(S.mode==='cloud' && currentPlan!=='pro'){
    const used = usageThisMonth().auditsUsed;
    if(used >= PLAN_LIMITS.auditsPerMonth){
      out.innerHTML = '<div class="warn"><b>Free plan limit reached.</b> The health check runs PageSpeed, which counts as a site audit — you have used ' + used + ' of ' + PLAN_LIMITS.auditsPerMonth + ' this month. <button class="btn small" data-action="upgrade">Upgrade to Pro — $9/month</button> for unlimited audits.</div>';
      return;
    }
  }
  prog.textContent = "Reading the page…";
  try{
    const { doc } = await fetchPageDoc(url, 20000);
    const title = ((doc.querySelector("title")||{}).textContent||"").trim();
    const descEl = doc.querySelector('meta[name="description"]');
    const desc = descEl ? (descEl.getAttribute("content")||"") : "";
    const h1s = doc.querySelectorAll("h1").length;
    const imgs = [...doc.querySelectorAll("img")];
    const noAlt = imgs.filter(i => !(i.getAttribute("alt")||"").trim()).length;
    const viewport = !!doc.querySelector('meta[name="viewport"]');
    const checks = [];
    checks.push({ name:"HTTPS", pass: url.startsWith("https://"), warn:false, detail: url.startsWith("https://") ? "Served over HTTPS." : "Served over plain HTTP — switch to HTTPS." });
    checks.push({ name:"Title tag", pass: title.length >= 30 && title.length <= 60, warn: title.length > 0 && (title.length < 30 || title.length > 60), detail: title ? '"' + title + '" — ' + title.length + ' characters (ideal 30–60).' : "No title tag found." });
    checks.push({ name:"Meta description", pass: desc.length >= 120 && desc.length <= 160, warn: desc.length > 0, detail: desc ? desc.length + ' characters (ideal 120–160).' : "No meta description — Google will pick its own snippet." });
    checks.push({ name:"Exactly one H1", pass: h1s === 1, warn:false, detail: h1s + " H1 tag(s) on the page." });
    checks.push({ name:"Image alt text", pass: imgs.length === 0 || noAlt === 0, warn: noAlt > 0 && noAlt < imgs.length, detail: imgs.length ? noAlt + " of " + imgs.length + " images have no alt text." : "No images on the page." });
    checks.push({ name:"Viewport meta tag", pass: viewport, warn:false, detail: viewport ? "Viewport tag present — the page can scale on phones." : "No viewport tag — the page may not display properly on phones." });
    prog.textContent = "Running PageSpeed (mobile)…";
    let psiScore = null, psiErr = null;
    try{ const p = await runPSI(url, "mobile"); psiScore = p.score; }catch(e){ psiErr = e.message||e; }
    checks.push({ name:"Mobile PageSpeed ≥ 50", pass: psiScore!=null && psiScore >= 50, warn: psiScore==null, detail: psiScore==null ? "Could not check — " + (psiErr||"PageSpeed error") : "Mobile performance score " + psiScore + "/100." });
    const passed = checks.filter(c => c.pass).length;
    out.innerHTML = '<p><b>' + passed + ' of ' + checks.length + ' checks passed.</b></p><table><tr><th>Check</th><th>Result</th><th>Detail</th></tr>' + checks.map(c => {
      const pill = c.pass ? '<span class="pill ok">Pass</span>' : c.warn ? '<span class="pill warn">Check</span>' : '<span class="pill bad">Fail</span>';
      return '<tr><td><b>' + esc(c.name) + '</b></td><td>' + pill + '</td><td>' + esc(c.detail) + '</td></tr>';
    }).join("") + '</table>';
    prog.textContent = "";
    const rec = { date: todayISO(), url, total: null, ok: null, failed: null, psi: psiScore, lcp: null, cls: null };
    if(S.mode==='cloud'){
      const id = await cloudInsertAudit(rec);
      if(id) rec.id = id;
      S.cache.audits = [rec].concat(S.cache.audits).slice(0,20);
    }else{
      LS.set("audits", [rec].concat(LS.get("audits", [])).slice(0,20));
    }
    renderAuditHistory(); renderLimitNotes();
  }catch(e){
    out.innerHTML = '<div class="err"><b>Health check failed:</b> ' + esc(e.message||e) + '</div>'; prog.textContent = "";
  }
}
$("hcBtn").addEventListener("click", runHealth);

/* ---------- 14. Bulk Audit ---------- */
async function runBulkAudit(){
  const out = $("bkOut"), prog = $("bkProg");
  out.innerHTML = ""; prog.textContent = "";
  let urls = ($("bkUrls").value||"").split("\n").map(s => normaliseSite(s)).filter(Boolean).slice(0, 5);
  if(!urls.length){ out.innerHTML = '<div class="err">Enter at least one URL (one per line, max 5).</div>'; return; }
  if(S.mode==='cloud' && currentPlan!=='pro'){
    const used = usageThisMonth().auditsUsed;
    const remaining = PLAN_LIMITS.auditsPerMonth - used;
    if(remaining <= 0){
      out.innerHTML = '<div class="warn"><b>Free plan limit reached.</b> You have used ' + used + ' of ' + PLAN_LIMITS.auditsPerMonth + ' site audits this month. <button class="btn small" data-action="upgrade">Upgrade to Pro — $9/month</button> for unlimited audits.</div>';
      return;
    }
    if(urls.length > remaining){
      out.innerHTML = '<div class="warn">Free plan: you have ' + remaining + ' audit(s) left this month, so only the first ' + remaining + ' URL(s) will run.</div>';
      urls = urls.slice(0, remaining);
    }
  }
  const rows = [];
  for(let i=0;i<urls.length;i++){
    prog.textContent = "Auditing " + (i+1) + " of " + urls.length + ": " + urls[i] + " …";
    try{
      const psi = await runPSI(urls[i], "mobile");
      rows.push({ url: urls[i], score: psi.score, lcp: psi.lcp, cls: psi.cls, error: null });
      const rec = { date: todayISO(), url: urls[i], total: null, ok: null, failed: null, psi: psi.score, lcp: psi.lcp, cls: psi.cls };
      if(S.mode==='cloud'){
        const id = await cloudInsertAudit(rec);
        if(id) rec.id = id;
        S.cache.audits = [rec].concat(S.cache.audits).slice(0,20);
      }else{
        LS.set("audits", [rec].concat(LS.get("audits", [])).slice(0,20));
      }
    }catch(e){
      rows.push({ url: urls[i], score: null, lcp: null, cls: null, error: e.message||e });
    }
  }
  out.innerHTML = '<div style="overflow-x:auto"><table><tr><th>URL</th><th>PageSpeed (mobile)</th><th>LCP</th><th>CLS</th><th>Note</th></tr>' + rows.map(r =>
    '<tr><td>' + esc(r.url) + '</td><td>' + (r.score==null ? '<span class="pill warn">Not scored</span>' : '<b>' + r.score + '</b>/100') + '</td><td>' + esc(r.lcp||"—") + '</td><td>' + esc(r.cls||"—") + '</td><td class="muted">' + (r.error ? esc(r.error) : "") + '</td></tr>').join("") + '</table></div>'
    + '<p class="muted">Successful checks were saved to audit history; failed checks are listed above. PageSpeed errors are shown exactly as Google returned them — a quota error (429) means retry later or add a free API key in Ad Revenue → Settings.</p>';
  prog.textContent = "";
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
    const sum = m => S.get("revenue", []).filter(e => (e.date||"").indexOf(m)===0).reduce((a,e)=>a+(+e.amount||0),0);
    const t = sum(thisM), l = sum(lastM);
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

/* ---------- 13. CSV exports ---------- */
$("auditExportBtn").addEventListener("click", () => {
  const rows = S.get("audits", []).map(a => [a.date, a.url, (a.total==null?"":a.total), (a.ok==null?"":a.ok), (a.failed==null?"":a.failed), (a.psi==null?"":a.psi), a.lcp||"", a.cls||""]);
  if(!rows.length){ alert("No audits to export yet."); return; }
  downloadCSV("seoforge-audits.csv", ["date","url","urls_checked","ok","failed","pagespeed_score","lcp","cls"], rows);
});
$("rkExportBtn").addEventListener("click", () => {
  const rows = [];
  S.get("keywords", []).forEach(k => {
    if(k.checks && k.checks.length) k.checks.forEach(c => rows.push([k.keyword, k.url||"", (k.difficulty==null?"":k.difficulty), c.date, (c.position==null?"not in top results":c.position)]));
    else rows.push([k.keyword, k.url||"", (k.difficulty==null?"":k.difficulty), "", "never checked"]);
  });
  if(!rows.length){ alert("No keywords to export yet."); return; }
  downloadCSV("seoforge-rank-history.csv", ["keyword","target_url","difficulty","check_date","position"], rows);
});
$("lvExportBtn").addEventListener("click", () => {
  const rows = S.get("links", []).map(l => [l.date, l.page, l.domain, l.count, l.types||""]);
  if(!rows.length){ alert("No verified links to export yet."); return; }
  downloadCSV("seoforge-verified-links.csv", ["date","linking_page","domain","links_found","types"], rows);
});
$("revExportBtn").addEventListener("click", () => {
  const rows = S.get("revenue", []).map(e => [e.date, e.network, e.amount]);
  if(!rows.length){ alert("No revenue entries to export yet."); return; }
  downloadCSV("seoforge-revenue.csv", ["date","network","amount_usd"], rows);
});


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
  document.documentElement.style.setProperty("--teal", p.accent);
  $("workspaceName").textContent = p.brand;
  $("psiStrategy").value = p.strategy;
  ["auditUrl","serpUrl","hcUrl"].forEach(id => { const el=$(id); if(el && !el.value) el.value=p.defaultSite; });
}
$("prefSave").addEventListener("click", () => {
  try {
    const p = SEOForgeCore.validatePreferences({theme:$("prefTheme").value, accent:$("prefAccent").value, density:$("prefDensity").value, brand:$("prefBrand").value, defaultSite:$("prefSite").value, strategy:$("prefStrategy").value});
    if($("prefSite").value.trim() && !p.defaultSite) throw new Error("Enter a valid HTTP or HTTPS website.");
    LS.set("preferences",p); applyPreferences(p); showBanner("Workspace preferences saved in this browser.", "ok");
  } catch(e){ showBanner(e.message,"warn"); }
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change",()=>applyPreferences(SEOForgeCore.validatePreferences(LS.get("preferences",{}))));
$("backupExport").addEventListener("click",()=>{
  const data={};
  Object.keys(S.cache).forEach(k=>{ data[k]=S.get(k,[]); });
  downloadFile("seoforge-backup-"+todayISO()+".json",JSON.stringify({version:1,exportedAt:new Date().toISOString(),mode:S.mode,data},null,2),"application/json");
  showBanner("Backup exported. API keys and authentication tokens are excluded. Cloud exports contain the loaded history, which may be capped.", "ok");
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
handlePaypalReturn();
renderAll();
refreshAuthUI();
showLanding();
initAuth().then(handleGoogleReturn).catch(e => showBanner(e.message, "warn"));
