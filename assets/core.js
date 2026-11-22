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
  const api = { normaliseSite, normHost, csvCell, validatePreferences };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SEOForgeCore = api;
})(globalThis);
