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
  function validatePreferences(value) {
    const v = value && typeof value === "object" ? value : {};
    return {
      theme: ["system", "light", "dark"].includes(v.theme) ? v.theme : "system",
      accent: /^#[0-9a-f]{6}$/i.test(v.accent || "") ? v.accent : "#0f766e",
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
    let score = 0;
    const add = function(name, pts, max, detail){ score += pts; rows.push({name:name, pts:pts, max:max, detail:detail}); };
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
    else { add("Compression", 4, 8, "Compression could not be verified — the server sent no content length to compare."); }
    const cache = m.cache||"";
    const mm = /max-age\s*=\s*(\d+)/i.exec(cache);
    if(/immutable/i.test(cache) || (mm && +mm[1] >= 86400)){ add("Caching", 7, 7, "Long cache lifetime set."); }
    else if(mm){ add("Caching", 3, 7, "Cache lifetime is only " + mm[1] + "s — raise it for repeat visits."); }
    else { add("Caching", 0, 7, "No cache lifetime set — repeat visitors re-download everything."); }
    if(!m.imgs){ add("Images", 15, 15, "No images on the page."); }
    else{
      const dimPts = Math.round(7 * m.sized / m.imgs);
      const fmtPts = m.raster ? Math.round(8 * m.modern / m.raster) : 8;
      add("Images", dimPts + fmtPts, 15, m.imgs + " image(s): " + m.sized + " have width+height set, " + m.modern + " of " + m.raster + " photos use a modern format (WebP/AVIF).");
    }
    const r = m.resources;
    if(r<=20){ add("Requests on the page", 10, 10, r + " files referenced."); }
    else if(r<=40){ add("Requests on the page", 7, 10, r + " files referenced."); }
    else if(r<=60){ add("Requests on the page", 4, 10, r + " files referenced — each one is a round trip."); }
    else { add("Requests on the page", 0, 10, r + " files referenced — combine or lazy-load where possible."); }
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
    checks.push({ name:"HTTPS", pass: url.indexOf("https://")===0, warn:false, detail: url.indexOf("https://")===0 ? "Served over HTTPS." : "Served over plain HTTP — switch to HTTPS." });
    checks.push({ name:"Title tag", pass: title.length >= 30 && title.length <= 60, warn: title.length > 0 && (title.length < 30 || title.length > 60), detail: title ? '"' + title + '" — ' + title.length + ' characters (ideal 30–60).' : "No title tag found." });
    checks.push({ name:"Meta description", pass: desc.length >= 120 && desc.length <= 160, warn: desc.length > 0, detail: desc ? desc.length + ' characters (ideal 120–160).' : "No meta description — Google will pick its own snippet." });
    checks.push({ name:"Exactly one H1", pass: h1s === 1, warn:false, detail: h1s + " H1 tag(s) on the page." });
    checks.push({ name:"Image alt text", pass: imgs === 0 || noAlt === 0, warn: noAlt > 0 && noAlt < imgs, detail: imgs ? noAlt + " of " + imgs + " images have no alt text." : "No images on the page." });
    checks.push({ name:"Viewport meta tag", pass: viewport, warn:false, detail: viewport ? "Viewport tag present — the page can scale on phones." : "No viewport tag — the page may not display properly on phones." });
    checks.push({ name:"Mobile PageSpeed ≥ 50", pass: psiScore!=null && psiScore >= 50, warn: psiScore==null, detail: psiScore==null ? "Could not check — " + psiErr : "Mobile performance score " + psiScore + "/100." });
    checks.push({ name:"SEOForge Speed Score", pass: sfScore >= 70, warn: sfScore >= 50 && sfScore < 70, detail: sfScore + "/100 — " + sfGrade + " (our own measurement — breakdown below)." });
    return checks;
  }
  const api = { normaliseSite, normHost, csvCell, validatePreferences, extractSpeedMetrics, scoreSpeedMetrics, healthChecks };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SEOForgeCore = api;
})(globalThis);
