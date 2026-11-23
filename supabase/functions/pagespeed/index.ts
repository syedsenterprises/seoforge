import {body,serve} from "../_shared/http.js";
/* Server-side PageSpeed Insights (v2.10.0). A customer with no key used to hit
   Google's shared no-key quota (429) and get an error instead of a report.
   This function calls the API with a key kept in Supabase (secret
   PAGE_SPEED_API_KEY) — the customer needs no key at all, and no key ever
   appears in the page. A personal key in Workspace settings still works as
   an override (the browser calls Google directly instead).
   Gated by the same origin allowlist as the other functions (shared
   serve()). No sign-in required (the audit tools work logged out too).
   Abuse bound: the free-plan audit limits (5 audits/mo) — no extra rate
   limiting here. If the secret is not set, the function throws a
   "not configured" error and the browser falls back to its direct no-key
   call with the honest quota message — a score is never faked. */
serve(async req=>{
  const input = await body(req);
  const raw = String(input.url||"");
  const strategy = input.strategy === "desktop" ? "desktop" : "mobile";
  if(!raw || raw.length>2048) throw new Error("Enter a valid URL");
  let u;
  try{ u = new URL(raw); }catch{ throw new Error("Enter a valid URL"); }
  if(u.protocol!=="http:" && u.protocol!=="https:") throw new Error("Only http and https URLs can be checked");
  if(u.username || u.password) throw new Error("URLs with credentials are not allowed");
  const key = Deno.env.get("PAGE_SPEED_API_KEY") || "";
  if(!key) throw new Error("PageSpeed key is not configured on the server");
  const api = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=" + encodeURIComponent(u.href) + "&strategy=" + strategy + "&category=performance&category=seo&key=" + encodeURIComponent(key);
  let res;
  try{
    res = await fetch(api, {signal:AbortSignal.timeout(100000)});
  }catch(e){ throw new Error("PageSpeed request timed out. Google's service may be slow — retry."); }
  let data: any = {};
  try{ data = await res.json(); }catch(e){ throw new Error("PageSpeed returned an unreadable response (HTTP " + res.status + ")."); }
  if(!res.ok){
    const msg = (data.error && data.error.message) || ("HTTP " + res.status);
    if(res.status===429) throw new Error("PageSpeed Insights quota exhausted (HTTP 429): " + msg + " The server key's quota is shared — retry later, or add your own free API key in Workspace settings.");
    throw new Error("PageSpeed Insights failed: " + msg);
  }
  const lr = data.lighthouseResult;
  if(!lr) throw new Error("PageSpeed returned no Lighthouse result for this URL.");
  const perf = lr.categories && lr.categories.performance ? lr.categories.performance.score : null;
  const audits = lr.audits || {};
  const lcp = audits["largest-contentful-paint"];
  const cls = audits["cumulative-layout-shift"];
  const seoRefs = (lr.categories && lr.categories.seo && lr.categories.seo.auditRefs) || [];
  const seo = seoRefs.map(r => {
    const a = audits[r.id]; if(!a) return null;
    return { title:a.title, score:a.score, display:a.displayValue||"" };
  }).filter(Boolean);
  return { score: perf==null?null:Math.round(perf*100), lcp:lcp?lcp.displayValue||"":null, cls:cls?cls.displayValue||"":null, seo, finalUrl:lr.finalUrl||u.href };
});
