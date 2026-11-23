/* Pure, dependency-free validation shared by the UI and regression tests. */
(function (root) {
  "use strict";
  function normaliseSite(input) {
    let value = String(input || "").trim();
    if (!value || /[\u0000-\u0020]/.test(value)) return "";
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^https?:\/\//i.test(value)) return "";
    if (!/^https?:\/\//i.test(value)) value = "https://" + value;
    try {
      const u = new URL(value);
      if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || !u.hostname) return "";
      return u.href.replace(/\/+$/, "");
    } catch { return ""; }
  }
  function normHost(input) {
    const url = normaliseSite(input);
    return url ? new URL(url).hostname.toLowerCase().replace(/^www\./, "") : "";
  }
  function csvCell(value) {
    let s = String(value == null ? "" : value);
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  /* Accent (v2.11.0 theme adaptivity): one validated accent colour drives
     the whole design through the --accent custom property (--teal is kept
     as an alias so older code reading it still sees the same value).
     resolveAccent is the single validator: anything that is not a 6-digit
     hex colour falls back to the default teal #0f766e, so a stored or
     imported value can never inject CSS. applyAccent writes both
     properties on a root element (document.documentElement in the app and
     on the landing) — the landing reads the same stored preferences, so
     both pages always agree. */
  const DEFAULT_ACCENT = "#0f766e";
  function resolveAccent(value) {
    return /^#[0-9a-f]{6}$/i.test(value || "") ? String(value).toLowerCase() : DEFAULT_ACCENT;
  }
  /* Luminance guard (F1): a light accent makes white-on-accent text
     invisible (white #ffffff measured 1.00:1, yellow #ffff00 1.07:1 in the
     browser). Every accent surface that carries text therefore uses
     --accent-on: whichever of white (#ffffff) and dark ink (#111827) has the
     higher WCAG contrast against the accent — white for teal/purple/black,
     dark ink for white/yellow/orange (#ea580c: white 3.56:1, dark 4.98:1).
     --accent-dark / --accent-ink are the accent darkened (light theme) or
     lightened (dark theme) until they reach 4.5:1 against the card
     background, so score numbers, prices and links stay readable when the
     accent itself is too light to print in. */
  function hexRgb(hex){
    const h = resolveAccent(hex);
    return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
  }
  function relLuminance(hex){
    const f = v => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
    const rgb = typeof hex === "string" ? hexRgb(hex) : hex;
    return 0.2126*f(rgb[0]) + 0.7152*f(rgb[1]) + 0.0722*f(rgb[2]);
  }
  function contrastRatioHex(fg, bg){
    const a = relLuminance(fg), b = relLuminance(bg);
    return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
  }
  function rgbToHex(rgb){
    return "#" + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2,"0")).join("");
  }
  function accentOn(accent){
    const a = resolveAccent(accent);
    return contrastRatioHex("#ffffff", a) >= contrastRatioHex("#111827", a) ? "#ffffff" : "#111827";
  }
  function accentIsLight(accent){ return accentOn(resolveAccent(accent)) === "#111827"; }
  /* Darken (light theme) or lighten (dark theme) the accent until it reads
     at 4.5:1 against the card background; an already-readable accent is
     returned unchanged. */
  function accentReadableOn(accent, theme){
    const a = resolveAccent(accent);
    const dark = theme === "dark";
    const bg = dark ? "#1e293b" : "#ffffff";
    if(contrastRatioHex(a, bg) >= 4.5) return a;
    const rgb = hexRgb(a);
    for(let step=1; step<=20; step++){
      const t = step/20;
      const mixed = dark ? rgb.map(v => v + (255-v)*t) : rgb.map(v => v*(1-t));
      const cand = rgbToHex(mixed);
      if(contrastRatioHex(cand, bg) >= 4.5) return cand;
    }
    return dark ? "#ffffff" : "#111827";
  }
  function accentProperties(accent, theme) {
    const a = resolveAccent(accent);
    const readable = accentReadableOn(a, theme);
    return { "--accent": a, "--teal": a, "--accent-on": accentOn(a), "--accent-dark": readable, "--accent-ink": readable };
  }
  function applyAccent(root, accent, theme) {
    const a = resolveAccent(accent);
    const t = theme || (root && root.dataset && root.dataset.theme) || (root && typeof root.getAttribute === "function" ? root.getAttribute("data-theme") : null) || "light";
    const props = accentProperties(a, t);
    try {
      const style = root && root.style;
      if (style && typeof style.setProperty === "function") {
        Object.keys(props).forEach(k => style.setProperty(k, props[k]));
      }
    } catch (e) { /* a root without a style object: nothing to paint */ }
    return a;
  }
  function validatePreferences(value) {
    const v = value && typeof value === "object" ? value : {};
    return {
      theme: ["system", "light", "dark"].includes(v.theme) ? v.theme : "light",
      accent: resolveAccent(v.accent),
      density: v.density === "compact" ? "compact" : "comfortable",
      brand: String(v.brand || "SEOForge").trim().slice(0, 60) || "SEOForge",
      defaultSite: normaliseSite(v.defaultSite),
      strategy: v.strategy === "desktop" ? "desktop" : "mobile"
    };
  }
  /* SEOForge Speed Score (v2.11.0): the same pure scoring the app uses, shared
     here so the landing hero widget measures a site exactly the way the app
     does — one source of truth, no drift. 6 weighted metrics, grades
     Excellent ≥90 / Good ≥70 / Needs work ≥50 / Poor <50. */
  function extractSpeedMetrics(doc, text, timings){
    const q = s => { try{ return Array.prototype.slice.call(doc.querySelectorAll(s)); }catch(e){ return []; } };
    const headScripts = q("head script[src]").filter(function(x){ return x.getAttribute("async")==null && x.getAttribute("defer")==null; });
    const headStyles = q("head link[rel=\"stylesheet\"]").filter(function(x){ const m=(x.getAttribute("media")||"").toLowerCase(); return m!=="print" && x.getAttribute("disabled")==null; });
    const imgs = q("img");
    const raster = imgs.filter(function(i){ return /\.(jpe?g|png|gif|bmp|webp|avif)(\?|#|$)/i.test(i.getAttribute("src")||""); });
    const modern = raster.filter(function(i){ return /\.(webp|avif)(\?|#|$)/i.test(i.getAttribute("src")||""); });
    const sized = imgs.filter(function(i){ return (i.getAttribute("width")||"").trim() && (i.getAttribute("height")||"").trim(); });
    const resources = q("script[src]").length + q("link[rel=\"stylesheet\"]").length + q("link[rel=\"preload\"]").length + imgs.length + q("source[src]").length;
    return {
      ttfbMs: (timings&&timings.ttfbMs!=null)?timings.ttfbMs:null,
      bytes: (timings&&timings.bytes!=null)?timings.bytes:null,
      textBytes: new TextEncoder().encode(text||"").length,
      blocking: headScripts.length + headStyles.length,
      compressed: (timings&&timings.compressed!==undefined)?timings.compressed:null,
      encoding: (timings&&timings.headers&&timings.headers.encoding)||"",
      cache: (timings&&timings.headers&&timings.headers.cache)||"",
      imgs: imgs.length, sized: sized.length, raster: raster.length, modern: modern.length,
      resources: resources
    };
  }
  function scoreSpeedMetrics(m){
    const rows = [];
    /* A metric with nothing to measure is N/A, not full marks: it is
       excluded from the total and the score is rescaled to 100 over the
       applicable metrics only (earned / applicable-max * 100). A page with
       no images used to score a perfect 15/15 on Images; a page with only
       vector images scored 8/8 on the format half. Both now read N/A. */
    const add = function(name, pts, max, detail, na){
      if(na){ rows.push({name:name, pts:null, max:max, detail:detail, na:true}); return; }
      rows.push({name:name, pts:pts, max:max, detail:detail});
    };
    const addImageRow = function(pts, max, detail, na){
      rows.push({name:"Images", pts:na?null:pts, max:max, detail:detail, na:!!na});
    };
    if(m.ttfbMs==null){ add("Server response (TTFB)", 0, 25, "Not measured — the page came through a free proxy fallback, which hides timing."); }
    else if(m.ttfbMs<=200){ add("Server response (TTFB)", 25, 25, m.ttfbMs + " ms — fast."); }
    else if(m.ttfbMs<=400){ add("Server response (TTFB)", 20, 25, m.ttfbMs + " ms."); }
    else if(m.ttfbMs<=800){ add("Server response (TTFB)", 12, 25, m.ttfbMs + " ms — slow server response."); }
    else if(m.ttfbMs<=1500){ add("Server response (TTFB)", 6, 25, m.ttfbMs + " ms — very slow server response."); }
    else { add("Server response (TTFB)", 0, 25, m.ttfbMs + " ms — the server is the bottleneck."); }
    const kb = Math.round(((m.bytes!=null?m.bytes:m.textBytes)||0)/1024);
    if(kb<=100){ add("HTML page weight", 15, 15, kb + " KB."); }
    else if(kb<=250){ add("HTML page weight", 11, 15, kb + " KB."); }
    else if(kb<=500){ add("HTML page weight", 7, 15, kb + " KB — heavy page."); }
    else if(kb<=1024){ add("HTML page weight", 3, 15, kb + " KB — very heavy page."); }
    else { add("HTML page weight", 0, 15, kb + " KB — the HTML alone is over 1 MB."); }
    const b = m.blocking;
    if(b===0){ add("Render-blocking resources", 20, 20, "None in the page head."); }
    else if(b<=3){ add("Render-blocking resources", 15, 20, b + " blocking script(s)/stylesheet(s) in the head."); }
    else if(b<=6){ add("Render-blocking resources", 10, 20, b + " blocking — defer or async scripts, inline critical CSS."); }
    else if(b<=10){ add("Render-blocking resources", 5, 20, b + " blocking — the browser waits on these before showing anything."); }
    else { add("Render-blocking resources", 0, 20, b + " blocking — the browser waits on these before showing anything."); }
    const enc = (m.encoding||"").toLowerCase();
    if(m.compressed===true){ add("Compression", 8, 8, "Compressed in transfer — the server shrinks the page before sending it."); }
    else if(m.compressed===false){ add("Compression", 0, 8, "No compression — enable gzip or Brotli to shrink the page."); }
    else if(/gzip|br|deflate|zstd/.test(enc)){ add("Compression", 8, 8, "Served compressed (" + enc.split(",")[0].trim() + ")."); }
    /* Unmeasured means zero — the same rule as an unmeasured TTFB. The old
       code awarded 4/8 here, so most free-proxy audits (which never carry
       timing data) got four unearned points in the headline score. */
    else { add("Compression", 0, 8, "Compression could not be verified — the server sent no content length to compare. No points awarded."); }
    const cache = m.cache||"";
    const mm = /max-age\s*=\s*(\d+)/i.exec(cache);
    if(/immutable/i.test(cache) || (mm && +mm[1] >= 86400)){ add("Caching", 7, 7, "Long cache lifetime set."); }
    else if(mm){ add("Caching", 3, 7, "Cache lifetime is only " + mm[1] + "s — raise it for repeat visits."); }
    else { add("Caching", 0, 7, "No cache lifetime set — repeat visitors re-download everything."); }
    if(!m.imgs){ addImageRow(0, 15, "No images on the page — not applicable (excluded from the total).", true); }
    else{
      const dimPts = Math.round(7 * m.sized / m.imgs);
      /* No raster images (all vector/icon): there is no photo format to
         measure, so the format half is not applicable — the Images row is
         scored out of 7 (dimensions only) and the format half is excluded,
         not awarded 8/8. */
      if(m.raster){
        const fmtPts = Math.round(8 * m.modern / m.raster);
        addImageRow(dimPts + fmtPts, 15, m.imgs + " image(s): " + m.sized + " have width+height set, " + m.modern + " of " + m.raster + " photos use a modern format (WebP/AVIF).");
      }else{
        addImageRow(dimPts, 7, m.imgs + " image(s): " + m.sized + " have width+height set. Format: not applicable — no photos, only vector/icon images (no format conversion needed).");
      }
    }
    const r = m.resources;
    if(r<=20){ add("Requests on the page", 10, 10, r + " files referenced."); }
    else if(r<=40){ add("Requests on the page", 7, 10, r + " files referenced."); }
    else if(r<=60){ add("Requests on the page", 4, 10, r + " files referenced — each one is a round trip."); }
    else { add("Requests on the page", 0, 10, r + " files referenced — combine or lazy-load where possible."); }
    const applicable = rows.filter(x => !x.na);
    const earned = applicable.reduce((a,x) => a + x.pts, 0);
    const maxTotal = applicable.reduce((a,x) => a + x.max, 0);
    const score = maxTotal ? Math.round(earned / maxTotal * 100) : 0;
    const grade = score>=90 ? "Excellent" : score>=70 ? "Good" : score>=50 ? "Needs work" : "Poor";
    return {score:score, grade:grade, rows:rows};
  }
  /* The 8 Health Check rules as pure data: given a page's real values, return
     the 8 checks with pass/warn/detail. The app and the landing hero widget
     both use this, so the free hero audit and the in-app Health Check can
     never disagree. Input: {url, title, desc, h1s, imgs, noAlt, viewport,
     psiScore, psiErr, sfScore, sfGrade}. */
  function healthChecks(input){
    const v = input || {};
    const url = String(v.url||"");
    const title = String(v.title||"");
    const desc = String(v.desc||"");
    const h1s = v.h1s||0, imgs = v.imgs||0, noAlt = v.noAlt||0;
    const viewport = !!v.viewport;
    const psiScore = v.psiScore, psiErr = v.psiErr||"PageSpeed error";
    const sfScore = v.sfScore, sfGrade = v.sfGrade||"";
    const checks = [];
    /* HTTPS is judged on the FINAL URL after redirects, not the input URL:
       a site that 301s https://… → http://… used to score "HTTPS: Pass".
       Callers pass finalUrl when they know it (runPSI returns it); without
       one the input URL is the only evidence and is used as before. */
    const finalUrl = String(v.finalUrl||"") || url;
    const httpsPass = finalUrl.indexOf("https://")===0;
    const downgraded = url.indexOf("https://")===0 && !httpsPass;
    checks.push({ name:"HTTPS", pass: httpsPass, warn:false, detail: httpsPass ? "Served over HTTPS." : downgraded ? "Started as HTTPS but redirected to plain HTTP — the final page is served over HTTP." : "Served over plain HTTP — switch to HTTPS." });
    checks.push({ name:"Title tag", pass: title.length >= 30 && title.length <= 60, warn: title.length > 0 && (title.length < 30 || title.length > 60), detail: title ? '"' + title + '" — ' + title.length + ' characters (ideal 30–60).' : "No title tag found." });
    checks.push({ name:"Meta description", pass: desc.length >= 120 && desc.length <= 160, warn: desc.length > 0, detail: desc ? desc.length + ' characters (ideal 120–160).' : "No meta description — Google will pick its own snippet." });
    checks.push({ name:"Exactly one H1", pass: h1s === 1, warn:false, detail: h1s + " H1 tag(s) on the page." });
    checks.push({ name:"Image alt text", pass: imgs === 0 || noAlt === 0, warn: noAlt > 0 && noAlt < imgs, detail: imgs ? noAlt + " of " + imgs + " images have no alt text." : "No images on the page." });
    checks.push({ name:"Viewport meta tag", pass: viewport, warn:false, detail: viewport ? "Viewport tag present — the page can scale on phones." : "No viewport tag — the page may not display properly on phones." });
    checks.push({ name:"Mobile PageSpeed ≥ 50", pass: psiScore!=null && psiScore >= 50, warn: psiScore==null, detail: psiScore==null ? "Could not check — " + psiErr : "Mobile performance score " + psiScore + "/100." });
    /* Speed Score row: sfScore may be missing if a caller passes no score
       (the hero and the app always pass one) — never print "undefined/100"
       as a failing check; say honestly it could not be measured. */
    checks.push(sfScore==null
      ? { name:"SEOForge Speed Score", pass:false, warn:true, detail:"Speed Score could not be measured for this page." }
      : { name:"SEOForge Speed Score", pass: sfScore >= 70, warn: sfScore >= 50 && sfScore < 70, detail: sfScore + "/100 — " + sfGrade + " (our own measurement — breakdown below)." });
    return checks;
  }
  const api = { normaliseSite, normHost, csvCell, validatePreferences, resolveAccent, accentProperties, applyAccent, accentOn, accentIsLight, accentReadableOn, relLuminance, contrastRatioHex, extractSpeedMetrics, scoreSpeedMetrics, healthChecks };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SEOForgeCore = api;
})(globalThis);
