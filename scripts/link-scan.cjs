/* Broken-link scan of the live site's key pages (v2.12.0).
   Node built-ins only (global fetch). Fails nonzero if any key page
   returns 4xx/5xx or cannot be fetched. Redirects are followed by
   fetch by default, so a 3xx that resolves is fine. Run by
   .github/workflows/automation.yml once a day; never run against
   anything but the production site. */
const BASE = process.env.SEOFORGE_SITE || "https://seoforge.syedsenterprises.org";
const PAGES = [
  "/",
  "/studio.html",
  "/app.html",
  "/privacy.html",
  "/terms.html",
  "/guides/",
  "/guides/check-backlinks.html",
  "/guides/free-seo-audit.html",
  "/guides/keyword-research.html",
  "/guides/rank-tracking.html",
];
(async () => {
  const failures = [];
  for (const page of PAGES) {
    const url = BASE.replace(/\/$/, "") + page;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      console.log(res.status, url);
      if (res.status >= 400) failures.push(url + " -> HTTP " + res.status);
    } catch (e) {
      console.log("FETCH FAILED", url, e.message);
      failures.push(url + " -> fetch failed: " + e.message);
    }
  }
  if (failures.length) {
    console.error("LINK SCAN FAILED:\n" + failures.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("PASS: all " + PAGES.length + " key pages reachable (no 4xx/5xx).");
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
