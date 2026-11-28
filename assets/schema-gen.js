"use strict";
/* Schema Generator (v2.12.0) — pure JSON-LD builders + validators.
   Every field comes from the form; empty optional fields are omitted, never
   invented. No network, no storage, no DOM here: the UI lives in app.js. */
function isNonEmpty(v){ return typeof v === "string" ? v.trim().length > 0 : v !== null && v !== undefined && v !== ""; }
function cleanStr(v){ return typeof v === "string" ? v.trim() : v; }
function omitEmpty(obj){
  const out = {};
  for(const k of Object.keys(obj)){
    const v = obj[k];
    if(v === undefined || v === null) continue;
    if(typeof v === "string" && v.trim() === "") continue;
    if(Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}
function isValidDate(s){
  if(typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function isAbsoluteHttpsUrl(s){
  if(typeof s !== "string") return false;
  try{ const u = new URL(s.trim()); return u.protocol === "https:"; }catch(e){ return false; }
}
function isNumeric(v){
  if(typeof v === "number") return isFinite(v);
  if(typeof v !== "string" || v.trim() === "") return false;
  return isFinite(Number(v.trim()));
}
function hint(field, message){ return { field, message }; }

function buildArticle(d){
  d = d || {};
  return omitEmpty({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: cleanStr(d.headline),
    author: isNonEmpty(d.author) ? { "@type": "Person", name: cleanStr(d.author) } : undefined,
    datePublished: cleanStr(d.datePublished),
    dateModified: cleanStr(d.dateModified),
    description: cleanStr(d.description),
    image: cleanStr(d.image),
    url: cleanStr(d.url)
  });
}
function validateArticle(d){
  d = d || {};
  const h = [];
  if(!isNonEmpty(d.headline)) h.push(hint("headline", "Headline is required."));
  if(!isNonEmpty(d.author)) h.push(hint("author", "Author name is required."));
  if(!isNonEmpty(d.datePublished)) h.push(hint("datePublished", "Publication date is required."));
  else if(!isValidDate(d.datePublished)) h.push(hint("datePublished", "Date must be YYYY-MM-DD, e.g. 2026-11-28."));
  if(isNonEmpty(d.dateModified) && !isValidDate(d.dateModified)) h.push(hint("dateModified", "Date must be YYYY-MM-DD, e.g. 2026-11-28."));
  if(isNonEmpty(d.image) && !isAbsoluteHttpsUrl(d.image)) h.push(hint("image", "Image URL must be an absolute https URL."));
  if(isNonEmpty(d.url) && !isAbsoluteHttpsUrl(d.url)) h.push(hint("url", "Page URL must be an absolute https URL."));
  return h;
}

function buildFaq(d){
  d = d || {};
  const items = (Array.isArray(d.items) ? d.items : [])
    .filter(it => it && (isNonEmpty(it.question) || isNonEmpty(it.answer)))
    .map(it => ({ "@type": "Question", name: cleanStr(it.question),
      acceptedAnswer: { "@type": "Answer", text: cleanStr(it.answer) } }));
  return omitEmpty({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items
  });
}
function validateFaq(d){
  d = d || {};
  const h = [];
  const items = Array.isArray(d.items) ? d.items : [];
  const filled = items.filter(it => it && (isNonEmpty(it.question) || isNonEmpty(it.answer)));
  if(filled.length === 0) h.push(hint("items", "Add at least one question and answer pair."));
  filled.forEach((it, i) => {
    if(!isNonEmpty(it.question)) h.push(hint("items[" + i + "].question", "Question " + (i + 1) + " needs a question."));
    if(!isNonEmpty(it.answer)) h.push(hint("items[" + i + "].answer", "Question " + (i + 1) + " needs an answer."));
  });
  return h;
}

function buildHowTo(d){
  d = d || {};
  const steps = (Array.isArray(d.steps) ? d.steps : [])
    .filter(s => s && (isNonEmpty(s.text) || isNonEmpty(s.name)))
    .map(s => omitEmpty({ "@type": "HowToStep", name: cleanStr(s.name), text: cleanStr(s.text) }));
  return omitEmpty({
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: cleanStr(d.name),
    description: cleanStr(d.description),
    totalTime: cleanStr(d.totalTime),
    step: steps
  });
}
function validateHowTo(d){
  d = d || {};
  const h = [];
  if(!isNonEmpty(d.name)) h.push(hint("name", "How-to title is required."));
  const steps = Array.isArray(d.steps) ? d.steps.filter(s => s && (isNonEmpty(s.text) || isNonEmpty(s.name))) : [];
  if(steps.length === 0) h.push(hint("steps", "Add at least one step."));
  steps.forEach((s, i) => {
    if(!isNonEmpty(s.text)) h.push(hint("steps[" + i + "].text", "Step " + (i + 1) + " needs instructions."));
  });
  return h;
}

function buildLocalBusiness(d){
  d = d || {};
  const address = omitEmpty({
    "@type": "PostalAddress",
    streetAddress: cleanStr(d.streetAddress),
    addressLocality: cleanStr(d.addressLocality),
    addressRegion: cleanStr(d.addressRegion),
    postalCode: cleanStr(d.postalCode),
    addressCountry: cleanStr(d.addressCountry)
  });
  return omitEmpty({
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: cleanStr(d.name),
    address: Object.keys(address).length > 1 ? address : undefined,
    telephone: cleanStr(d.telephone),
    url: cleanStr(d.url),
    priceRange: cleanStr(d.priceRange)
  });
}
function validateLocalBusiness(d){
  d = d || {};
  const h = [];
  if(!isNonEmpty(d.name)) h.push(hint("name", "Business name is required."));
  if(!isNonEmpty(d.streetAddress)) h.push(hint("streetAddress", "Street address is required."));
  if(!isNonEmpty(d.addressLocality)) h.push(hint("addressLocality", "City or locality is required."));
  if(isNonEmpty(d.url) && !isAbsoluteHttpsUrl(d.url)) h.push(hint("url", "Website URL must be an absolute https URL."));
  return h;
}

function buildProduct(d){
  d = d || {};
  return omitEmpty({
    "@context": "https://schema.org",
    "@type": "Product",
    name: cleanStr(d.name),
    description: cleanStr(d.description),
    image: cleanStr(d.image),
    brand: isNonEmpty(d.brand) ? { "@type": "Brand", name: cleanStr(d.brand) } : undefined,
    offers: omitEmpty({
      "@type": "Offer",
      price: isNonEmpty(d.price) ? String(d.price).trim() : undefined,
      priceCurrency: cleanStr(d.priceCurrency),
      availability: cleanStr(d.availability)
    })
  });
}
function validateProduct(d){
  d = d || {};
  const h = [];
  if(!isNonEmpty(d.name)) h.push(hint("name", "Product name is required."));
  if(!isNonEmpty(d.price)) h.push(hint("price", "Price is required."));
  else if(!isNumeric(d.price)) h.push(hint("price", "Price must be a number, e.g. 19.99."));
  if(!isNonEmpty(d.priceCurrency)) h.push(hint("priceCurrency", "Currency is required, e.g. USD."));
  else if(!/^[A-Za-z]{3}$/.test(String(d.priceCurrency).trim())) h.push(hint("priceCurrency", "Currency must be a 3-letter code, e.g. USD."));
  if(isNonEmpty(d.image) && !isAbsoluteHttpsUrl(d.image)) h.push(hint("image", "Image URL must be an absolute https URL."));
  return h;
}

function buildBreadcrumb(d){
  d = d || {};
  const items = (Array.isArray(d.items) ? d.items : [])
    .filter(it => it && (isNonEmpty(it.name) || isNonEmpty(it.item)))
    .map((it, i) => omitEmpty({
      "@type": "ListItem",
      position: i + 1,
      name: cleanStr(it.name),
      item: cleanStr(it.item)
    }));
  return omitEmpty({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items
  });
}
function validateBreadcrumb(d){
  d = d || {};
  const h = [];
  const items = Array.isArray(d.items) ? d.items.filter(it => it && (isNonEmpty(it.name) || isNonEmpty(it.item))) : [];
  if(items.length < 2) h.push(hint("items", "Add at least two breadcrumb items."));
  items.forEach((it, i) => {
    if(!isNonEmpty(it.name)) h.push(hint("items[" + i + "].name", "Item " + (i + 1) + " needs a name."));
    if(!isNonEmpty(it.item)) h.push(hint("items[" + i + "].item", "Item " + (i + 1) + " needs a page URL."));
    else if(!isAbsoluteHttpsUrl(it.item)) h.push(hint("items[" + i + "].item", "Item " + (i + 1) + " URL must be an absolute https URL."));
  });
  return h;
}

const BUILDERS = { article: buildArticle, faq: buildFaq, howto: buildHowTo, localbusiness: buildLocalBusiness, product: buildProduct, breadcrumb: buildBreadcrumb };
const VALIDATORS = { article: validateArticle, faq: validateFaq, howto: validateHowTo, localbusiness: validateLocalBusiness, product: validateProduct, breadcrumb: validateBreadcrumb };
const SCHEMA_TYPES = [
  { id: "article", label: "Article" },
  { id: "faq", label: "FAQ page" },
  { id: "howto", label: "How-to" },
  { id: "localbusiness", label: "Local business" },
  { id: "product", label: "Product" },
  { id: "breadcrumb", label: "Breadcrumb list" }
];
function buildSchema(type, data){
  if(!Object.hasOwn(BUILDERS, type)) throw new Error("Unknown schema type: " + type);
  return BUILDERS[type](data || {});
}
function validateSchema(type, data){
  if(!Object.hasOwn(VALIDATORS, type)) throw new Error("Unknown schema type: " + type);
  return VALIDATORS[type](data || {});
}
/* Form field definitions the app UI renders per type. "repeat" groups render
   as addable rows; each row's fields share the group's key. */
const SCHEMA_FORMS = {
  article: [
    { key: "headline", label: "Headline", type: "text", required: true },
    { key: "author", label: "Author name", type: "text", required: true },
    { key: "datePublished", label: "Publication date", type: "date", required: true, placeholder: "YYYY-MM-DD" },
    { key: "dateModified", label: "Last updated (optional)", type: "date", placeholder: "YYYY-MM-DD" },
    { key: "description", label: "Description (optional)", type: "text" },
    { key: "image", label: "Image URL (optional)", type: "url", placeholder: "https://example.com/image.jpg" },
    { key: "url", label: "Page URL (optional)", type: "url", placeholder: "https://example.com/article" }
  ],
  faq: [
    { key: "items", label: "Questions and answers", type: "repeat", min: 1, fields: [
      { key: "question", label: "Question", type: "text", required: true },
      { key: "answer", label: "Answer", type: "textarea", required: true }
    ] }
  ],
  howto: [
    { key: "name", label: "How-to title", type: "text", required: true },
    { key: "description", label: "Description (optional)", type: "text" },
    { key: "totalTime", label: "Total time (optional)", type: "text", placeholder: "e.g. PT30M" },
    { key: "steps", label: "Steps", type: "repeat", min: 1, fields: [
      { key: "name", label: "Step name (optional)", type: "text" },
      { key: "text", label: "Instructions", type: "textarea", required: true }
    ] }
  ],
  localbusiness: [
    { key: "name", label: "Business name", type: "text", required: true },
    { key: "streetAddress", label: "Street address", type: "text", required: true },
    { key: "addressLocality", label: "City", type: "text", required: true },
    { key: "addressRegion", label: "State or region (optional)", type: "text" },
    { key: "postalCode", label: "Postcode (optional)", type: "text" },
    { key: "addressCountry", label: "Country (optional)", type: "text", placeholder: "e.g. IN" },
    { key: "telephone", label: "Phone (optional)", type: "text" },
    { key: "url", label: "Website URL (optional)", type: "url", placeholder: "https://example.com" },
    { key: "priceRange", label: "Price range (optional)", type: "text", placeholder: "e.g. $$" }
  ],
  product: [
    { key: "name", label: "Product name", type: "text", required: true },
    { key: "description", label: "Description (optional)", type: "text" },
    { key: "image", label: "Image URL (optional)", type: "url", placeholder: "https://example.com/product.jpg" },
    { key: "brand", label: "Brand (optional)", type: "text" },
    { key: "price", label: "Price", type: "text", required: true, placeholder: "e.g. 19.99" },
    { key: "priceCurrency", label: "Currency", type: "text", required: true, placeholder: "e.g. USD" },
    { key: "availability", label: "Availability (optional)", type: "text", placeholder: "e.g. https://schema.org/InStock" }
  ],
  breadcrumb: [
    { key: "items", label: "Breadcrumb items", type: "repeat", min: 2, fields: [
      { key: "name", label: "Page name", type: "text", required: true },
      { key: "item", label: "Page URL", type: "url", required: true, placeholder: "https://example.com/page" }
    ] }
  ]
};
const schemaGenApi = { buildArticle, validateArticle, buildFaq, validateFaq, buildHowTo, validateHowTo,
  buildLocalBusiness, validateLocalBusiness, buildProduct, validateProduct,
  buildBreadcrumb, validateBreadcrumb, buildSchema, validateSchema,
  SCHEMA_TYPES, SCHEMA_FORMS, isValidDate, isAbsoluteHttpsUrl, isNumeric };
if(typeof module !== "undefined") module.exports = schemaGenApi;
if(typeof window !== "undefined") window.SeoforgeSchemaGen = schemaGenApi;
