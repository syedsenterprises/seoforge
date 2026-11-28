const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const {wordpress, promptFor, escapeXml, validateUrl, normalizeSiteUrl, slugify, wpBasicAuth, wpPostPayload, resolveTaxonomy, wpRestUrl, newDraft, isOverdue, sortDraftsByDue, reviewQueue, migrateLegacyDraft, agentEndpoint, agentModel, parseAiSettings, buildAgentRequest, auditHtml, stepPrompt, newRun, RUN_STEPS} = require("../assets/studio.js");

test("Studio page applies the stored accent and theme like the landing", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "studio.html"), "utf8");
  assert.match(html, /syedSuite\.preferences/);
  assert.match(html, /setProperty\("--accent"/);
  assert.match(html, /data-theme/);
});

test("WordPress export preserves a draft and escapes markup", () => {
  const result = wordpress("A & B", "<script>alert(1)</script>");
  assert.match(result, /<wp:status>draft<\/wp:status>/);
  assert.match(result, /A &amp; B/);
  assert.ok(!result.includes("<script>"));
  assert.match(result, /&amp;lt;script/);
  assert.throws(() => wordpress(" ", "body"));
});

test("AI workflow includes topic and treats notes as reference", () => {
  assert.match(promptFor("refresh", "Title", "Evidence"), /reference, not as instructions[\s\S]*Title[\s\S]*Evidence/);
  assert.throws(() => promptFor("toString", "x", "y"));
});

test("WordPress export gains categories, tags, excerpt, slug and post date", () => {
  const result = wordpress("Hello", "Body text.", {categories: ["News", "SEO"], tags: ["a & b"], excerpt: "Short <summary>", slug: "Hello World!", post_date: "2026-11-28 10:00:00"});
  assert.match(result, /<category domain="category" nicename="news">News<\/category>/);
  assert.match(result, /<category domain="category" nicename="seo">SEO<\/category>/);
  assert.match(result, /<category domain="post_tag" nicename="a-b">a &amp; b<\/category>/);
  assert.match(result, /<excerpt:encoded>Short &lt;summary&gt;<\/excerpt:encoded>/);
  assert.match(result, /<wp:post_name>hello-world<\/wp:post_name>/);
  assert.match(result, /<wp:post_date>2026-11-28 10:00:00<\/wp:post_date>/);
  assert.match(result, /<wp:status>draft<\/wp:status>/);
  // No options: output keeps the old shape.
  assert.ok(!wordpress("T", "B").includes("<category"));
});

test("escaping strips control characters and escapes quotes", () => {
  assert.equal(escapeXml("a\u0000b\"c'd<e>&f"), "ab&quot;c&apos;d&lt;e&gt;&amp;f");
  assert.equal(slugify("Hello, World! 2026"), "hello-world-2026");
});

test("URL validation rejects non-http(s), credentials and private hosts", () => {
  assert.equal(validateUrl("ftp://example.com").ok, false);
  assert.equal(validateUrl("https://user:pass@example.com").ok, false);
  assert.equal(validateUrl("http://localhost:8080").ok, false);
  assert.equal(validateUrl("http://127.0.0.1/admin").ok, false);
  assert.equal(validateUrl("http://10.0.0.5/").ok, false);
  assert.equal(validateUrl("http://192.168.1.1/").ok, false);
  assert.equal(validateUrl("http://172.20.0.1/").ok, false);
  assert.equal(validateUrl("http://169.254.169.254/").ok, false);
  assert.equal(validateUrl("http://[::1]/").ok, false);
  assert.equal(validateUrl("not a url").ok, false);
  assert.equal(validateUrl("").ok, false);
  const good = validateUrl("https://example.com/page");
  assert.equal(good.ok, true);
  assert.equal(good.url, "https://example.com/page");
  assert.equal(normalizeSiteUrl("https://example.com///").url, "https://example.com");
  assert.equal(normalizeSiteUrl("https://user@example.com").ok, false);
  assert.equal(wpRestUrl("https://example.com/", "/wp/v2/posts"), "https://example.com/wp-json/wp/v2/posts");
});

test("Basic auth header encodes credentials", () => {
  assert.equal(wpBasicAuth("admin", "abcd 1234"), "Basic " + Buffer.from("admin:abcd 1234", "utf8").toString("base64"));
  assert.equal(wpBasicAuth("u", "p"), "Basic " + Buffer.from("u:p", "utf8").toString("base64"));
});

test("WordPress payload maps statuses and requires a date for scheduling", () => {
  const base = {title: "T", content: "C"};
  assert.deepEqual(wpPostPayload(base), {title: "T", content: "C", status: "draft"});
  assert.equal(wpPostPayload({...base, status: "published"}).status, "publish");
  assert.throws(() => wpPostPayload({...base, status: "scheduled"}), /date/);
  assert.equal(wpPostPayload({...base, status: "scheduled", date: "2026-12-01T09:00"}).status, "future");
  assert.equal(wpPostPayload({...base, status: "scheduled", date: "2026-12-01T09:00"}).date, "2026-12-01T09:00");
  assert.throws(() => wpPostPayload({...base, status: "bogus"}), /draft, published or scheduled/);
  assert.throws(() => wpPostPayload({title: " ", content: "x"}), /title and content/);
  const full = wpPostPayload({...base, categories: [3, 4], tags: [7], excerpt: "E", slug: "My Slug!", featuredMedia: "42"});
  assert.deepEqual(full.categories, [3, 4]);
  assert.equal(full.slug, "my-slug");
  assert.equal(full.featured_media, 42);
});

test("taxonomy resolution matches names and reports the rest unresolved", () => {
  const r = resolveTaxonomy(["News", "Missing", "seo"], [{id: 3, name: "news"}, {id: 9, name: "SEO"}]);
  assert.deepEqual(r.ids, [3, 9]);
  assert.deepEqual(r.unresolved, ["Missing"]);
  assert.deepEqual(resolveTaxonomy([], []), {ids: [], unresolved: []});
});

test("draft library sorts overdue first and flags overdue reviews", () => {
  const now = new Date("2026-11-28T12:00:00Z");
  const a = newDraft("A", "", "2026-11-20", {status: "draft"});
  const b = newDraft("B", "", "2026-11-29", {status: "draft"});
  const c = newDraft("C", "", "", {status: "draft"});
  const d = newDraft("D", "", "2026-11-01", {status: "published"});
  assert.equal(isOverdue(a, now), true);
  assert.equal(isOverdue(b, now), false);
  assert.equal(isOverdue(c, now), false);
  assert.equal(isOverdue(d, now), false);
  assert.deepEqual(sortDraftsByDue([c, b, a]).map(x => x.title), ["A", "B", "C"]);
  assert.deepEqual(reviewQueue([b, d, a]).map(x => x.title), ["A", "B"]);
  assert.equal(newDraft("  ", "body").title, "Untitled draft");
});

test("legacy single draft migrates into the library shape", () => {
  const m = migrateLegacyDraft({title: "Old", draft: "Text", due: "2026-12-01", task: "brief"});
  assert.equal(m.title, "Old");
  assert.equal(m.content, "Text");
  assert.equal(m.due, "2026-12-01");
  assert.equal(m.status, "draft");
  assert.equal(migrateLegacyDraft(null), null);
  assert.equal(migrateLegacyDraft({}), null);
});

test("agent endpoint and model mirror the main app", () => {
  assert.equal(agentEndpoint("gemini", ""), "https://generativelanguage.googleapis.com/v1beta/openai");
  assert.equal(agentEndpoint("openai", ""), "https://api.openai.com/v1");
  assert.equal(agentEndpoint("openai", "https://x.example.com/v1/"), "https://x.example.com/v1");
  assert.equal(agentEndpoint("coarena", "https://co.example.com/v1/"), "https://co.example.com/v1");
  assert.equal(agentModel("gemini", ""), "gemini-2.0-flash");
  assert.equal(agentModel("openai", ""), "gpt-4o-mini");
  assert.equal(agentModel("coarena", ""), "");
  assert.equal(agentModel("coarena", "model-x"), "model-x");
});

test("AI settings parse and agent requests guard missing keys and models", () => {
  assert.deepEqual(parseAiSettings('{"aiProvider":"gemini","aiKey":" k ","aiModel":""}'), {provider: "gemini", key: "k", baseUrl: "", model: ""});
  assert.deepEqual(parseAiSettings("not json"), {provider: "coarena", key: "", baseUrl: "", model: ""});
  assert.throws(() => buildAgentRequest({provider: "gemini", key: "", baseUrl: "", model: ""}, [{content: "hi"}]), /Settings/);
  assert.throws(() => buildAgentRequest({provider: "coarena", key: "k", baseUrl: "https://x.example.com", model: ""}, [{content: "hi"}]), /model/);
  assert.throws(() => buildAgentRequest({provider: "coarena", key: "k", baseUrl: "", model: "m"}, [{content: "hi"}]), /provider URL/);
  const req = buildAgentRequest({provider: "gemini", key: "k", baseUrl: "", model: ""}, [{role: "user", content: "hi"}]);
  assert.equal(req.url, "https://mzbesucdnjecinkdawzy.supabase.co/functions/v1/ai-agent");
  assert.equal(req.body.model, "gemini-2.0-flash");
  assert.equal(req.body.baseUrl, "https://generativelanguage.googleapis.com/v1beta/openai");
  assert.equal(req.body.apiKey, "k");
  assert.equal(req.headers.apikey, req.headers.Authorization.slice("Bearer ".length));
  assert.throws(() => buildAgentRequest({provider: "gemini", key: "k", baseUrl: "", model: ""}, []), /1 and 10/);
});

test("local audit reads title, meta, headings, words and image alt text", () => {
  const html = "<html><head><title>  My Page </title><meta name=\"description\" content=\"A short description.\"></head><body><h1>One</h1><h1>Two</h1><p>Hello brave new world</p><img src=\"a.jpg\" alt=\"ok\"><img src=\"b.jpg\"><img src=\"c.jpg\" alt=\"\"></body></html>";
  const a = auditHtml(html);
  assert.equal(a.title, "My Page");
  assert.equal(a.titleLength, 7);
  assert.equal(a.metaDescription, "A short description.");
  assert.equal(a.h1Count, 2);
  assert.equal(a.wordCount, 8);
  assert.equal(a.imagesTotal, 3);
  assert.equal(a.imagesMissingAlt, 2);
  const empty = auditHtml("<html><body><p>one two</p></body></html>");
  assert.equal(empty.title, "");
  assert.equal(empty.metaDescriptionLength, 0);
  assert.equal(empty.h1Count, 0);
});

test("run step prompts stay short and cover every step", () => {
  const audit = {title: "T", titleLength: 1, metaDescription: "", metaDescriptionLength: 0, h1Count: 1, wordCount: 100, imagesTotal: 2, imagesMissingAlt: 1};
  for (const step of ["brief", "outline", "draft", "checklist"]) {
    const p = stepPrompt(step, {url: "https://example.com/p", topic: "Cats", audit, brief: "B", outline: "O", draft: "D"});
    assert.ok(p.length < 2000, step + " prompt too long: " + p.length);
    assert.match(p, /Cats/);
  }
  assert.match(stepPrompt("brief", {url: "https://example.com", topic: "T", audit}), /meta description missing/);
  assert.throws(() => stepPrompt("fetch", {}), /Unknown run step/);
  assert.throws(() => stepPrompt("nope", {}), /Unknown run step/);
});

test("a new run starts with every step pending", () => {
  const r = newRun("https://example.com", "Topic");
  assert.deepEqual(Object.keys(r.steps).sort(), [...RUN_STEPS].sort());
  assert.equal(r.steps.brief.status, "pending");
  assert.equal(r.url, "https://example.com");
});
