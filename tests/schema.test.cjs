const test = require("node:test");
const assert = require("node:assert/strict");
const sg = require("../assets/schema-gen.js");

const roundTrip = obj => JSON.parse(JSON.stringify(obj));

test("all six builders produce valid JSON-LD", () => {
  const cases = {
    article: { headline: "Hello", author: "Syed Shahed", datePublished: "2026-11-28" },
    faq: { items: [{ question: "What?", answer: "This." }] },
    howto: { name: "Make tea", steps: [{ text: "Boil water." }] },
    localbusiness: { name: "Milano", streetAddress: "Road No. 45", addressLocality: "Hyderabad" },
    product: { name: "Guide", price: "7.99", priceCurrency: "USD" },
    breadcrumb: { items: [{ name: "Home", item: "https://example.com" }, { name: "Blog", item: "https://example.com/blog" }] }
  };
  for(const [type, data] of Object.entries(cases)){
    const built = sg.buildSchema(type, data);
    assert.equal(JSON.parse(JSON.stringify(built))["@context"], "https://schema.org");
    roundTrip(built); // throws if not valid JSON
    assert.deepEqual(sg.validateSchema(type, data), []);
  }
  assert.throws(() => sg.buildSchema("nope", {}), /Unknown schema type/);
});

test("required-field validation fires per type", () => {
  assert.ok(sg.validateArticle({}).some(h => h.field === "headline"));
  assert.ok(sg.validateArticle({}).some(h => h.field === "author"));
  assert.ok(sg.validateArticle({}).some(h => h.field === "datePublished"));
  assert.ok(sg.validateFaq({ items: [] }).length > 0);
  assert.ok(sg.validateHowTo({ name: "x" }).some(h => h.field === "steps"));
  assert.ok(sg.validateLocalBusiness({}).some(h => h.field === "name"));
  assert.ok(sg.validateLocalBusiness({}).some(h => h.field === "addressLocality"));
  assert.ok(sg.validateProduct({}).some(h => h.field === "price"));
  assert.ok(sg.validateProduct({}).some(h => h.field === "priceCurrency"));
  assert.ok(sg.validateBreadcrumb({ items: [{ name: "Home", item: "https://example.com" }] }).some(h => h.field === "items"));
});

test("common-mistake hints: dates, URLs, prices", () => {
  assert.ok(sg.validateArticle({ headline: "H", author: "A", datePublished: "28/11/2026" }).some(h => h.field === "datePublished"));
  assert.ok(sg.validateArticle({ headline: "H", author: "A", datePublished: "2026-02-30" }).some(h => h.field === "datePublished"));
  assert.ok(sg.validateArticle({ headline: "H", author: "A", datePublished: "2026-11-28", url: "example.com/x" }).some(h => h.field === "url"));
  assert.ok(sg.validateProduct({ name: "P", price: "free", priceCurrency: "USD" }).some(h => h.field === "price"));
  assert.ok(sg.validateProduct({ name: "P", price: "9.99", priceCurrency: "US" }).some(h => h.field === "priceCurrency"));
  assert.ok(sg.validateBreadcrumb({ items: [
    { name: "Home", item: "https://example.com" },
    { name: "Blog", item: "/blog" }
  ] }).some(h => h.field === "items[1].item"));
});

test("empty optional fields are omitted, never invented", () => {
  const a = sg.buildArticle({ headline: "H", author: "A", datePublished: "2026-11-28", description: "", image: "  ", url: "" });
  assert.ok(!("description" in a) && !("image" in a) && !("url" in a));
  assert.equal(a.headline, "H");
  const p = sg.buildProduct({ name: "P", price: "9.99", priceCurrency: "USD", brand: "" });
  assert.ok(!("brand" in p));
  assert.equal(p.offers.price, "9.99");
  const lb = sg.buildLocalBusiness({ name: "B", streetAddress: "1 Main St", addressLocality: "Hyderabad", telephone: "" });
  assert.ok(!("telephone" in lb));
  assert.equal(lb.address["@type"], "PostalAddress");
});

test("FAQ with zero Q&A pairs is rejected", () => {
  assert.ok(sg.validateFaq({ items: [] }).length > 0);
  assert.ok(sg.validateFaq({}).length > 0);
  assert.ok(sg.validateFaq({ items: [{ question: "", answer: "" }] }).length > 0);
  assert.ok(sg.validateFaq({ items: [{ question: "Q?", answer: "" }] }).some(h => h.field === "items[0].answer"));
  const built = sg.buildFaq({ items: [{ question: "Q?", answer: "A." }] });
  assert.equal(built.mainEntity[0].acceptedAnswer.text, "A.");
});

test("breadcrumb positions are sequential from 1", () => {
  const built = sg.buildBreadcrumb({ items: [
    { name: "Home", item: "https://example.com" },
    { name: "Blog", item: "https://example.com/blog" },
    { name: "Post", item: "https://example.com/blog/post" }
  ] });
  assert.deepEqual(built.itemListElement.map(i => i.position), [1, 2, 3]);
  assert.deepEqual(sg.validateBreadcrumb({ items: [
    { name: "Home", item: "https://example.com" },
    { name: "Blog", item: "https://example.com/blog" }
  ] }), []);
});

test("how-to steps keep order and FAQ keeps question order", () => {
  const h = sg.buildHowTo({ name: "T", steps: [{ text: "First." }, { name: "Second", text: "Next." }] });
  assert.deepEqual(h.step.map(s => s.text), ["First.", "Next."]);
  assert.equal(h.step[1].name, "Second");
  const f = sg.buildFaq({ items: [{ question: "One?", answer: "1" }, { question: "Two?", answer: "2" }] });
  assert.deepEqual(f.mainEntity.map(q => q.name), ["One?", "Two?"]);
});
