const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const html=fs.readFileSync("app.html","utf8");
const code=fs.readFileSync("assets/app.js","utf8");
const landing=fs.readFileSync("index.html","utf8");
function storage(){
  const data=new Map();
  return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};
}
function fakeEl(){
  const el={value:"",textContent:"",innerHTML:"",hidden:false,style:{},dataset:{},classList:{toggle(){},add(){},remove(){},contains(){return false;}},listeners:{},addEventListener(name,cb){(this.listeners[name]=this.listeners[name]||[]).push(cb);},querySelector(){return fakeEl();},querySelectorAll(){return[];},appendChild(){},remove(){},focus(){},click(){},setAttribute(){},getAttribute(){return null;},closest(){return null;}};
  return el;
}
function app(search=""){
  const elements=new Map();
  for(const match of html.matchAll(/id="([^"]+)"/g)){
    elements.set(match[1],{value:"",textContent:"",innerHTML:"",hidden:false,style:{},dataset:{},classList:{toggle(){}},listeners:{},addEventListener(name,cb){this.listeners[name]=cb;},querySelectorAll(){return[];},appendChild(){},focus(){},remove(){}});
  }
  const context={
    console,URL,URLSearchParams,AbortController,TextEncoder,Uint8Array,Date,Math,JSON,Promise,
    crypto:require("node:crypto").webcrypto,
    btoa:s=>Buffer.from(s,"binary").toString("base64"),
    localStorage:storage(),sessionStorage:storage(),
    location:{href:"https://example.com/"+search,search,reload(){}},
    history:{replaceState(){}},setTimeout(){},clearTimeout(){},
    matchMedia:()=>({matches:false,addEventListener(){}}),
    alert(){},confirm:()=>false,
    document:{getElementById:id=>{assert.ok(elements.has(id),"missing DOM element: "+id);return elements.get(id);},querySelectorAll:()=>[],addEventListener(){},createElement:()=>fakeEl(),documentElement:{dataset:{},style:{setProperty(){}}}},
    navigator:{},fetch:async()=>{throw Error("Unexpected network call");}
  };
  context.window=context;context.scrollTo=()=>{};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("assets/core.js","utf8"),context);
  vm.runInContext(code,context);
  return {context,elements,run:script=>vm.runInContext(script,context)};
}
/* Bing u= sample values, built the same way Bing builds them: "a1" + base64url(real URL). */
function bingU(real){
  const b=Buffer.from(real).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  return "a1"+b;
}
function bingHtml(items){
  return items.map(([u,t])=>'<li class="b_algo"><h2><a target="_blank" href="https://www.bing.com/ck/a?!&&p=abc&u='+bingU(u)+'&ntb=1">'+t+'</a></h2><cite>'+u.replace("https://","")+' › page</cite></li>').join("");
}
/* Real Bing HTML, as served live 24 Nov 2026: hrefs carry &amp; entities and
   the <cite> display text INCLUDES the scheme ("https://host › path"). */
function bingHtmlAmp(items){
  return items.map(([u,t])=>'<li class="b_algo"><h2><a target="_blank" href="https://www.bing.com/ck/a?!&amp;&amp;p=abc&amp;u='+bingU(u)+'&amp;ntb=1">'+t+'</a></h2><cite>'+u+' › page</cite></li>').join("");
}
test("Application starts without cloud CDN and all static element IDs exist",()=>{
  const a=app();assert.match(a.elements.get("authMsg").textContent,/unavailable/);
});
test("Forged PayPal query cannot activate Pro",async()=>{
  const a=app("?subscription_id=I-FAKE");
  await a.run("applyPendingPaypalSub()");
  assert.equal(a.run("currentPlan"),"free");
  assert.match(a.elements.get("topBanner").textContent,/not payment verification/);
  assert.doesNotMatch(code,/update\(\{\s*plan:\s*["']pro/);
});
test("OAuth rejects unsolicited code even without saved state",async()=>{
  const a=app();
  a.context.location.search="?code=stolen&state=unknown";
  await a.run("handleGoogleReturn()");
  assert.match(a.elements.get("topBanner").textContent,/rejected/);
});
test("Account preferences are isolated from guest and other accounts",()=>{
  const a=app();
  a.run('LS.set("preferences",{brand:"Guest"}); currentUser={id:"alice"}; LS.set("preferences",{brand:"Alice"}); currentUser={id:"bob"};');
  assert.equal(a.run('LS.get("preferences",{}).brand'),undefined);
  a.run("currentUser=null");
  assert.equal(a.run('LS.get("preferences",{}).brand'),"Guest");
});
test("Failed search parsing never becomes a recorded lost rank",async()=>{
  const a=app();
  a.context.DOMParser=class{parseFromString(){return{querySelectorAll:()=>[]};}};
  a.run('fetchViaProxy=async()=>({text:"captcha"}); LS.set("keywords",[{keyword:"seo",url:"https://example.com",checks:[]}]);');
  const btn={disabled:false,textContent:"",title:""};
  a.context.__btn=btn;
  await a.run('checkRank(0,__btn)');
  assert.equal(a.run('LS.get("keywords",[])[0].checks.length'),0);
  assert.equal(btn.textContent,"Failed — retry");
  assert.match(btn.title,/Rank check failed/);
});
test("Profile ownership grouping distinguishes targets and check timestamps",()=>{
  const a=app();
  assert.equal(a.run('groupVerifiedRows([{page_url:"p",target_domain:"a",checked_at:"2026-11-22T00:00:00Z",found:false},{page_url:"p",target_domain:"b",checked_at:"2026-11-22T00:00:00Z",found:false}]).length'),2);
});
test("Storage failures provide a recoverable error",()=>{
  const a=app();a.context.localStorage.setItem=()=>{throw Error("QuotaExceeded");};
  assert.throws(()=>a.run('LS.set("audits",[])'),/storage is full/);
});

test("Cloud export reads every page and excludes token/config tables",async()=>{
  const a=app();
  const calls=[];
  a.context.mockDb={from(table){calls.push(table);return{select(){return this;},eq(){return this;},order(){return this;},maybeSingle(){return Promise.resolve({data:null,error:null});},range(from,to){return Promise.resolve({data:from===0?Array.from({length:500},(_,i)=>({id:String(i)})):[{id:"last"}],error:null});}};},rpc:()=>Promise.resolve({data:null,error:null})}; /* rpc must exist: renderLimitNotes calls it, and a missing rpc makes the boot re-run renderAll */
  a.run('currentUser={id:"alice"};sb=mockDb;');
  /* Let the boot's renderAll settle first: it runs after initAuth resolves
     (fix 1), so loadNotifPref legitimately reads the signed-in user's
     notification preference from profiles — that read is not the export's.
     Only the calls the export itself makes are asserted below. */
  await a.run("Promise.resolve()");
  const before=calls.length;
  const data=await a.run("collectAccountExport()");
  const exportCalls=calls.slice(before);
  assert.equal(data.audits.length,501);
  assert.ok(!exportCalls.includes("google_tokens"));
  assert.ok(!exportCalls.includes("profiles"));
});
test("Cloud export aborts after a database error instead of downloading partial data",async()=>{
  const a=app();
  a.context.mockDb={from(){return{select(){return this;},eq(){return this;},order(){return this;},range(){return Promise.resolve({data:null,error:{message:"offline"}});}};}};
  a.run('currentUser={id:"alice"};sb=mockDb;');
  await assert.rejects(a.run("collectAccountExport()"),/Export failed/);
});

test("Failed comparison persistence keeps the result and shows an unsaved warning",async()=>{
  const a=app();
  a.elements.get("cpA").value="https://a.example";
  a.elements.get("cpB").value="https://b.example";
  a.run('runPSI=async()=>({score:70});fetchPageDoc=async()=>{throw Error("offline");};recordCompetitors=async()=>{throw Error("database unavailable");};');
  await a.run("runCompare()");
  assert.match(a.elements.get("cpOut").innerHTML,/Comparison not saved/);
  assert.match(a.elements.get("cpOut").innerHTML,/<table>/);
});
test("False-report fix: a failed compare fetch renders no character counts",async()=>{
  const a=app();
  a.elements.get("cpA").value="https://a.example";
  a.elements.get("cpB").value="https://b.example";
  a.run('runPSI=async()=>({score:70});fetchPageDoc=async()=>{throw Error("Page fetch failed (HTTP 403)");};recordCompetitors=async()=>{};');
  await a.run("runCompare()");
  const out=a.elements.get("cpOut").innerHTML;
  assert.match(out,/Could not read/);
  assert.doesNotMatch(out,/chars/);
  assert.doesNotMatch(out,/Could not read page: Page fetch failed/);
});

test("SEOForge Speed Score: fast light page scores 100",()=>{
  const a=app();
  const sf=a.run(`scoreSpeedMetrics({ttfbMs:150,bytes:80000,textBytes:80000,blocking:0,compressed:true,encoding:"",cache:"public, max-age=31536000, immutable",imgs:2,sized:2,raster:2,modern:2,resources:12})`);
  assert.equal(sf.score,100);
  assert.equal(sf.grade,"Excellent");
});
test("SEOForge Speed Score: slow heavy page scores 0",()=>{
  const a=app();
  const sf=a.run(`scoreSpeedMetrics({ttfbMs:2400,bytes:1500000,textBytes:1500000,blocking:14,compressed:false,encoding:"",cache:"",imgs:10,sized:0,raster:10,modern:0,resources:120})`);
  assert.equal(sf.score,0);
  assert.equal(sf.grade,"Poor");
});
test("SEOForge Speed Score: missing timings still scores what was measured",()=>{
  const a=app();
  const sf=a.run(`scoreSpeedMetrics({ttfbMs:null,bytes:null,textBytes:60000,blocking:2,compressed:null,encoding:"gzip",cache:"max-age=3600",imgs:0,sized:0,raster:0,modern:0,resources:15})`);
  /* R1: Images is N/A here (no images), so 51 earned points rescale over
     the 85 applicable points: 51/85 = 60, not 51+15 = 66. */
  assert.equal(sf.score,60);
  assert.equal(sf.grade,"Needs work");
});

test("Forge Assistant: provider endpoints resolve correctly",()=>{
  const a=app();
  assert.equal(a.run('agentEndpoint("gemini","")'),"https://generativelanguage.googleapis.com/v1beta/openai");
  assert.equal(a.run('agentEndpoint("openai","")'),"https://api.openai.com/v1");
  assert.equal(a.run('agentEndpoint("coarena","https://example.com/v1/")'),"https://example.com/v1");
  assert.equal(a.run('agentModel("gemini","")'),"gemini-2.0-flash");
  assert.equal(a.run('agentModel("openai","")'),"gpt-4o-mini");
  assert.equal(a.run('agentModel("coarena","my-model")'),"my-model");
});
test("Forge Assistant: free daily limit allows 5 then blocks",()=>{
  const a=app();
  assert.equal(a.run("agentCanChat().ok"),true);
  assert.equal(a.run("agentCanChat().left"),5);
  a.run('LS.set("agentUsage",{date:todayISO(),used:5})');
  assert.equal(a.run("agentCanChat().ok"),false);
  a.run('LS.set("agentUsage",{date:todayISO(),used:4})');
  assert.equal(a.run("agentCanChat().left"),1);
});
test("Forge Assistant: context describes the user's real data, never invented numbers",()=>{
  const a=app();
  const ctx=a.run("agentContext()");
  assert.match(ctx,/SEOForge/);
  assert.match(ctx,/plan: free/);
  assert.match(ctx,/Never invent numbers/);
});

test("SEOForge Speed Score: compression that cannot be verified scores zero, not half",()=>{
  const a=app();
  const sf=a.run(`scoreSpeedMetrics({ttfbMs:null,bytes:null,textBytes:60000,blocking:2,compressed:null,encoding:"",cache:"max-age=3600",imgs:0,sized:0,raster:0,modern:0,resources:15})`);
  /* Unmeasured means zero — the same rule as an unmeasured TTFB. Awarding
     half marks here gave most free-proxy audits four unearned points. */
  /* R1: same rescale — 43 earned over 85 applicable = 51, not 43+15 = 58. */
  assert.equal(sf.score,51);
  assert.equal(sf.grade,"Needs work");
  assert.match(sf.rows.find(r=>r.name==="Compression").detail,/No points awarded/);
});

test("Forge Assistant keyless mode: answers data questions without a key",()=>{
  const a=app();
  a.run('LS.set("audits",[{url:"https://example.com",psi:87,ok:50,total:50}]); LS.set("keywords",[{keyword:"seo tools",url:"",checks:[{position:3,date:"2026-11-23"},{position:5,date:"2026-11-22"}]},{keyword:"ai directory",url:"",checks:[]}]); LS.set("links",[{id:"1",count:1},{id:"2",count:1}]);');
  assert.match(a.run('agentLocalAnswer("what is my latest audit score?")'),/87\/100/);
  assert.match(a.run('agentLocalAnswer("what is my latest audit score?")'),/example\.com/);
  assert.match(a.run('agentLocalAnswer("how many keywords am I tracking?")'),/2 keywords/);
  assert.match(a.run('agentLocalAnswer("how many keywords am I tracking?")'),/seo tools/);
  assert.match(a.run('agentLocalAnswer("how many keywords am I tracking?")'),/2 rank checks/);
  assert.match(a.run('agentLocalAnswer("how many links have I verified?")'),/2 verified links/);
  assert.match(a.run('agentLocalAnswer("what is my plan?")'),/You're on the Free plan/);
  assert.match(a.run('agentLocalAnswer("what is my plan?")'),/5 free messages a day/);
  assert.match(a.run('agentLocalAnswer("what is my speed score?")'),/isn't saved/);
  assert.match(a.run('agentLocalAnswer("help")'),/No key needed/);
  assert.equal(a.run('agentLocalAnswer("how do I fix my title tag?")'),null);
});
test("Forge Assistant keyless mode: no saved data says so plainly",()=>{
  const a=app();
  assert.match(a.run('agentLocalAnswer("what is my latest audit score?")'),/no saved audits/);
  assert.match(a.run('agentLocalAnswer("how many keywords?")'),/not tracking any keywords/);
});

test("Auth: sign-up with an already-registered email says so instead of 'Account created'",async()=>{
  const a=app();
  a.run('cloudAvailable=true; sb={auth:{signUp:async()=>({data:{user:{identities:[]}},error:null})}};');
  a.elements.get("authEmail").value="someone@example.com";
  a.elements.get("authPass").value="a-very-long-password";
  await a.run("doSignUp()");
  assert.match(a.elements.get("authMsg").textContent,/already exists/);
  assert.match(a.elements.get("authMsg").textContent,/signing in instead/);
});
test("Auth: sign-in with an unconfirmed email offers to resend the confirmation",async()=>{
  const a=app();
  a.run('cloudAvailable=true; sb={auth:{signInWithPassword:async()=>({data:{},error:{message:"Email not confirmed"}}),resend:async()=>({error:null})}};');
  a.elements.get("authEmail").value="someone@example.com";
  a.elements.get("authPass").value="a-very-long-password";
  a.run('$("resendBtn").hidden=true;');
  await a.run("doSignIn()");
  assert.match(a.elements.get("authMsg").textContent,/isn't confirmed yet/);
  assert.equal(a.elements.get("resendBtn").hidden,false);
  await a.run("doResendConfirmation()");
  assert.match(a.elements.get("authMsg").textContent,/Confirmation email sent/);
});
test("Auth: Google sign-in calls Supabase OAuth with the Google provider",async()=>{
  const a=app();
  a.run('cloudAvailable=true; sb={auth:{signInWithOAuth:async(args)=>{globalThis.__oauthArgs=args;return{error:null}}}};');
  await a.run("doGoogleSignIn()");
  assert.equal(a.run("globalThis.__oauthArgs.provider"),"google");
});

/* ---------- v2.10.0: SERP (Bing-first) ---------- */
test("SERP: Bing u= decoder strips the 2-char prefix and decodes the real URL",()=>{
  const a=app();
  assert.equal(a.run('decodeBingUrl("https://www.bing.com/ck/a?!&&p=x&u='+bingU("https://builtin.com/artificial-intelligence/ai-tools")+'&ntb=1")'),"https://builtin.com/artificial-intelligence/ai-tools");
  assert.equal(a.run('decodeBingUrl("https://example.com/page")'),"https://example.com/page");
  assert.equal(a.run('decodeBingUrl("https://www.bing.com/search?q=x")'),"");
});
test("SERP: Bing parser reads li.b_algo blocks and falls back to the cite text",()=>{
  const a=app();
  const sample=bingHtml([["https://example.com/one","One"],["https://example.com/two","Two"]])
    + '<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=garbage">No u</a></h2><cite>fallback.example › deep › page</cite></li>';
  a.context.__bing=sample;
  const out=a.run("parseBingResults(__bing, 5)");
  assert.equal(out.length,3);
  assert.equal(out[0].url,"https://example.com/one");
  assert.equal(out[0].title,"One");
  assert.equal(out[2].url,"https://fallback.example/deep/page");
});
test("SERP: DuckDuckGo parser reads a.result__a links via uddg",()=>{
  const a=app();
  a.context.__ddg='<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fddg.example.com%2Fpage">DDG Page</a>';
  const out=a.run("parseDdgResults(__ddg, 5)");
  assert.equal(out.length,1);
  assert.equal(out[0].url,"https://ddg.example.com/page");
  assert.equal(out[0].title,"DDG Page");
});
test("SERP: serpTopResults tries Bing first and falls back to DuckDuckGo",async()=>{
  const a=app();
  const bing=bingHtml([["https://example.com/ai-tools-one","AI tools one"]]);
  const ddg='<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fddg.example.com%2Fai-tools-page">DDG AI tools page</a>';
  a.context.__bing=bing; a.context.__ddg=ddg;
  a.run('fetchViaProxy=async(u)=> u.includes("bing.com") ? {text:__bing} : {text:__ddg};');
  const first=await a.run('serpTopResults("ai tools", 5)');
  assert.equal(first[0].url,"https://example.com/ai-tools-one");
  a.run('fetchViaProxy=async(u)=> u.includes("bing.com") ? {text:"<html>no results here</html>"} : {text:__ddg};');
  const second=await a.run('serpTopResults("ai tools", 5)');
  assert.equal(second[0].url,"https://ddg.example.com/ai-tools-page");
  a.run('fetchViaProxy=async()=>({text:"<html>nothing</html>"});');
  await assert.rejects(a.run('serpTopResults("ai tools", 5)'),/blocked|parsed/);
});
test("SERP: Bing u= decoder handles &amp; entities in raw Bing HTML",()=>{
  const a=app();
  const href='https://www.bing.com/ck/a?!&amp;&amp;p=x&amp;u='+bingU("https://builtin.com/artificial-intelligence/ai-tools")+'&amp;ntb=1';
  assert.equal(a.run('decodeBingUrl("'+href+'")'),"https://builtin.com/artificial-intelligence/ai-tools");
  /* A direct (non-Bing) href with an entity-escaped query still passes through. */
  assert.equal(a.run('decodeBingUrl("https://example.com/page?a=1&amp;b=2")'),"https://example.com/page?a=1&b=2");
});
test("SERP: Bing parser with &amp; hrefs and scheme-including cites returns clean single-scheme URLs",()=>{
  const a=app();
  const sample=bingHtmlAmp([["https://www.marketermilk.com/blog/best-seo-tools","25 Best SEO Tools"],["https://www.capterra.com/seo-software/","Best SEO Software"]]);
  a.context.__bing=sample;
  const out=a.run("parseBingResults(__bing, 5)");
  assert.equal(out.length,2);
  assert.equal(out[0].url,"https://www.marketermilk.com/blog/best-seo-tools");
  assert.equal(out[1].url,"https://www.capterra.com/seo-software/");
  assert.ok(out.every(r=>!r.url.includes("https://https://")));
});
test("SERP: cite fallback strips an existing scheme and rejects a truncated cite",()=>{
  const a=app();
  const withScheme='<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=garbage">No u</a></h2><cite>https://fallback.example › deep › page</cite></li>';
  a.context.__bing=withScheme;
  const out=a.run("parseBingResults(__bing, 5)");
  assert.equal(out.length,1);
  assert.equal(out[0].url,"https://fallback.example/deep/page");
  const truncated='<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=garbage">No u</a></h2><cite>https://truncated.example › MicroSiteTemplat…</cite></li>';
  a.context.__bing2=truncated;
  const out2=a.run("parseBingResults(__bing2, 5)");
  assert.equal(out2.length,0);
});
test("SERP: serpTopResults rejects results that do not relate to the keyword (Bing trending fallback)",async()=>{
  const a=app();
  /* The exact live case 24 Nov 2026: q=SEOForge returned Hyundai pages. */
  const bing=bingHtmlAmp([["https://www.hyundaiusa.com/us/en/vehicles/tucson","2026 Tucson | Compact SUV, Vehicle Overview | Hyundai USA"],["https://autoservice.hyundaiusa.com","Hyundai"],["https://www.hyundaiusa.com/us/en/vehicles/tucson/xrt","2026 Tucson XRT | Features & Options - Hyundai USA"]]);
  a.context.__bing=bing;
  a.run('fetchViaProxy=async()=>({text:__bing});');
  await assert.rejects(a.run('serpTopResults("SEOForge", 5)'),/No verifiable ranking data for "SEOForge"/);
});
test("SERP: serpTopResults returns real results for a matching keyword",async()=>{
  const a=app();
  const bing=bingHtmlAmp([["https://www.marketermilk.com/blog/best-seo-tools","25 Best SEO Tools"],["https://www.capterra.com/seo-software/","Best SEO Software"],["https://morningscore.io/best-seo-tools","The 20 Best SEO Tools"]]);
  a.context.__bing=bing;
  a.run('fetchViaProxy=async()=>({text:__bing});');
  const out=await a.run('serpTopResults("best seo tools", 5)');
  assert.equal(out.length,3);
  assert.equal(out[0].url,"https://www.marketermilk.com/blog/best-seo-tools");
  assert.ok(out.every(r=>!r.url.includes("https://https://")));
});
test("SERP: relevance guard needs a significant keyword token, not a stopword",()=>{
  const a=app();
  /* "best" alone is a stopword: no significant token -> guard does not fire. */
  assert.equal(a.run('serpResultsMatchKeyword([{url:"https://example.com/x",title:"Anything"}], "best")'),true);
  assert.equal(a.run('serpKeywordTokens("best seo tools")').join(","),"seo,tools");
  assert.equal(a.run('serpResultsMatchKeyword([{url:"https://www.hyundaiusa.com/us/en/vehicles/tucson",title:"2026 Tucson"}], "SEOForge")'),false);
  assert.equal(a.run('serpResultsMatchKeyword([{url:"https://seoforge.syedsenterprises.org/",title:"SEOForge"}], "SEOForge")'),true);
});
test("Rank Tracker: a trending-fallback result never becomes a recorded lost rank",async()=>{
  const a=app();
  a.context.DOMParser=class{parseFromString(){return{querySelectorAll:()=>[]};}};
  const bing=bingHtmlAmp([["https://www.hyundaiusa.com/us/en/vehicles/tucson","2026 Tucson | Compact SUV, Vehicle Overview | Hyundai USA"]]);
  a.context.__bing=bing;
  a.run('fetchViaProxy=async()=>({text:__bing}); LS.set("keywords",[{keyword:"SEOForge",url:"https://seoforge.syedsenterprises.org",checks:[]}]);');
  const btn={disabled:false,textContent:"",title:""};
  a.context.__btn=btn;
  await a.run('checkRank(0,__btn)');
  assert.equal(a.run('LS.get("keywords",[])[0].checks.length'),0);
  assert.equal(btn.textContent,"Failed — retry");
  assert.match(btn.title,/No verifiable ranking data/);
});
test("Briefs: the brief path runs through serpTopResults (Bing) and never shows a SERP title as page data",async()=>{
  const a=app();
  a.elements.set("brTxtBtn",a.elements.get("brBtn"));
  const bing=bingHtml([["https://example.com/ai-tools-one","AI tools one"],["https://example.com/ai-tools-two","AI tools two"],["https://example.com/ai-tools-three","AI tools three"],["https://example.com/ai-tools-four","AI tools four"],["https://example.com/ai-tools-five","AI tools five"]]);
  a.context.__bing=bing;
  a.run('fetchViaProxy=async()=>({text:__bing}); fetchPageDoc=async()=>{throw Error("blocked");}; suggestOne=async()=>[];');
  a.elements.get("brKw").value="ai tools";
  await a.run("runBrief()");
  const out=a.elements.get("brOut").innerHTML;
  assert.match(out,/could not read/);
  assert.doesNotMatch(out,/DuckDuckGo/);
});
test("Briefs: an empty brief (all pages unreadable) is not saved",async()=>{
  const a=app();
  a.elements.set("brTxtBtn",a.elements.get("brBtn"));
  const bing=bingHtml([["https://example.com/ai-tools-one","AI tools one"],["https://example.com/ai-tools-two","AI tools two"],["https://example.com/ai-tools-three","AI tools three"],["https://example.com/ai-tools-four","AI tools four"],["https://example.com/ai-tools-five","AI tools five"]]);
  a.context.__bing=bing;
  a.run('fetchViaProxy=async()=>({text:__bing}); fetchPageDoc=async()=>{throw Error("blocked");}; suggestOne=async()=>[];');
  a.elements.get("brKw").value="ai tools";
  await a.run("runBrief()");
  const out=a.elements.get("brOut").innerHTML;
  assert.match(out,/could not read/);
  assert.match(out,/Nothing was saved/);
  assert.doesNotMatch(out,/Saved to your briefs/);
  assert.equal(a.run('LS.get("briefs", []).length'),0);
});

/* ---------- v2.10.0: fetch-proxy 403/429 fallthrough ---------- */
test("fetchViaProxy: an edge 403 falls through to the public proxies",async()=>{
  const a=app();
  a.context.fetch=async(url)=>{
    if(String(url).includes("/functions/v1/fetch-proxy")) return {ok:true,status:200,json:async()=>({status:403,ok:false,text:"blocked"})};
    if(String(url).includes("allorigins")) return {ok:true,status:200,text:async()=>"<html>real page</html>"};
    throw Error("no route");
  };
  const r=await a.run('fetchViaProxy("https://example.com")');
  assert.equal(r.status,200);
  assert.match(r.text,/real page/);
});

/* ---------- v2.10.0: server-side PageSpeed routing ---------- */
test("PageSpeed: personal key goes direct, no key goes to the edge function",()=>{
  const a=app();
  assert.equal(a.run("pagespeedRoute().via"),"edge");
  a.run('LS.set("settings",{psiKey:"my-key"})');
  assert.equal(a.run("pagespeedRoute().via"),"direct");
});
test("PageSpeed: edge function returns a score; a missing server key falls back to direct with an honest result",async()=>{
  const a=app();
  a.context.fetch=async(url)=>{
    if(String(url).includes("/functions/v1/pagespeed")) return {ok:true,status:200,json:async()=>({score:74,lcp:"1.2 s",cls:"0.01",seo:[],finalUrl:"https://example.com"})};
    throw Error("no route");
  };
  const edge=await a.run('runPSI("https://example.com","mobile")');
  assert.equal(edge.score,74);
  a.context.fetch=async(url)=>{
    if(String(url).includes("/functions/v1/pagespeed")) return {ok:false,status:400,json:async()=>({error:"PageSpeed key is not configured on the server"})}; /* shared serve() returns 400 for thrown errors */
    if(String(url).includes("pagespeedonline")) return {ok:true,status:200,json:async()=>({lighthouseResult:{categories:{performance:{score:0.81},seo:{auditRefs:[{id:"viewport"}]}},audits:{"largest-contentful-paint":{displayValue:"1.4 s"},"cumulative-layout-shift":{displayValue:"0.02"},viewport:{title:"Has a viewport",score:1,displayValue:""}},finalUrl:"https://example.com"}})};
    throw Error("no route");
  };
  const direct=await a.run('runPSI("https://example.com","mobile")');
  assert.equal(direct.score,81);
});

/* ---------- v2.10.0: marketplace seed-4 + Estate Path card ---------- */
test("Marketplace: seed-4 lists the Syed Enterprises hub with DM for rates, and no listing shows a stray $19",()=>{
  const a=app();
  assert.equal(a.run("SEED_LISTINGS.length"),4);
  assert.equal(a.run('SEED_LISTINGS.find(s=>s.id==="seed-4").site'),"https://syedsenterprises.org");
  assert.equal(a.run('SEED_LISTINGS.find(s=>s.id==="seed-4").price'),null);
  a.run("renderMarket()");
  const mkt=a.elements.get("mktList").innerHTML;
  assert.match(mkt,/Syed Enterprises — Services hub/);
  assert.match(mkt,/DM for rates/);
  assert.doesNotMatch(mkt,/\$19/);
  assert.equal((mkt.match(/<span class="price">\$\d+/g)||[]).length,2); /* $20 + $49 price spans; the $49 also appears in seed-2's description text */
});

/* ---------- v2.10.0: deep links, session, version ---------- */
test("Deep links: tab and auth hashes parse, unknown tabs fall back to empty",()=>{
  const a=app();
  assert.equal(a.run('parseTabHash("#tab=rank")'),"rank");
  assert.equal(a.run('parseTabHash("#tab=audit")'),"audit");
  assert.equal(a.run('parseTabHash("#tab=nope")'),"");
  assert.equal(a.run('parseTabHash("")'),"");
  assert.equal(a.run('parseAuthHash("#auth=signup")'),"signup");
  assert.equal(a.run('parseAuthHash("#auth=signin")'),"signin");
  assert.equal(a.run('parseAuthHash("")'),"");
});
test("Session: hasSavedSession honours expiry",()=>{
  const a=app();
  assert.equal(a.run("hasSavedSession()"),false);
  a.run('localStorage.setItem("sb-mzbesucdnjecinkdawzy-auth-token", JSON.stringify({access_token:"x", expires_at: Math.floor(Date.now()/1000)+3600}))');
  assert.equal(a.run("hasSavedSession()"),true);
  a.run('localStorage.setItem("sb-mzbesucdnjecinkdawzy-auth-token", JSON.stringify({access_token:"x", expires_at: Math.floor(Date.now()/1000)-10}))');
  assert.equal(a.run("hasSavedSession()"),false);
});
test("Version: one source of truth, 2.11.0 everywhere",()=>{
  const a=app();
  assert.equal(a.run("APP_VERSION"),"2.11.0");
  assert.equal(JSON.parse(fs.readFileSync("package.json","utf8")).version,"2.11.0");
  assert.match(fs.readFileSync("supabase/functions/status/index.ts","utf8"),/version:"2\.11\.0"/);
  assert.match(html,/data-app-version/);
  assert.match(landing,/v2\.11\.0/);
  assert.doesNotMatch(html,/v2\.9/);
  assert.doesNotMatch(landing,/v2\.9/);
});

/* ---------- v2.10.0: dashboard helpers ---------- */
test("Dashboard helpers: sparkline, site list, global search targets, skeleton",()=>{
  const a=app();
  assert.match(a.run("sparklineSVG([10,50,90])"),/<svg/);
  assert.equal(a.run("sparklineSVG([])"),"");
  assert.equal(a.run("sparklineSVG([5])"),"");
  assert.equal(a.run('globalSearchTargets("https://example.com")[0].tab'),"audit");
  assert.equal(a.run('globalSearchTargets("ai tools")[0].tab'),"keywords");
  assert.equal(a.run('globalSearchTargets("")').length,0);
  /* F2: normalizeSiteList normalises + dedupes but NEVER caps — capping on
     read is what deleted sites 11–50 on a downgrade save. The plan limit
     lives in activeSites() (the visible window), not in the stored list. */
  assert.equal(a.run('JSON.stringify(normalizeSiteList(["https://a.com","a.com","https://b.com","https://c.com","https://d.com"]))'),'["https://a.com","https://b.com","https://c.com","https://d.com"]');
  assert.equal(a.run('JSON.stringify(activeSites())'),'[]'); /* no sites stored yet */
  a.run('LS.set("sites",["https://a.com","https://b.com","https://c.com","https://d.com"]);');
  assert.equal(a.run('JSON.stringify(activeSites())'),'["https://a.com"]'); /* Free plan: 1 active site, 3 kept */
  a.run('currentPlan="agency";');
  assert.equal(a.run('JSON.stringify(activeSites())'),'["https://a.com","https://b.com","https://c.com","https://d.com"]'); /* Agency: 10 sites — stringify: vm arrays fail strict deepEqual across realms */
  assert.match(a.run("skeletonHtml(2)"),/skel/);
});

/* ---------- v2.10.0: settings move ---------- */
test("Settings move: PageSpeed, AI and integrations live in Workspace settings, not Ad Revenue",()=>{
  const prefs=html.slice(html.indexOf('id="tab-preferences"'),html.indexOf('id="tab-ads"'));
  const ads=html.slice(html.indexOf('id="tab-ads"'),html.indexOf('id="tab-market"'));
  for(const id of ["setPsi","setAiProvider","setAiKey","setAiBaseUrl","setAiModel","setAiTestBtn","setSaveBtn","setSaved","setAiHint","setAiTest","intGoogleStatus","intDisconnectBtn","notifWeekly","notifSaveBtn","notifSaved"]){
    assert.ok(prefs.includes('id="'+id+'"'),id+" should be in preferences");
    assert.ok(!ads.includes('id="'+id+'"'),id+" should not be in ads");
  }
  assert.doesNotMatch(code,/Ad Revenue → Settings/);
  assert.doesNotMatch(html,/Ad Revenue → Settings/);
  assert.match(code,/Workspace settings/);
});

/* ---------- v2.10.0: redirects always render a result ---------- */
test("Redirects: when the hop walk sees nothing, the fetch-proxy fallback still shows a final status",async()=>{
  const a=app();
  a.context.fetch=async()=>{throw Error("network down");};
  a.run('fetchViaProxy=async()=>({status:200,ok:true,text:"<html>final</html>"});');
  a.elements.get("rdUrl").value="https://example.com/page";
  await a.run("runRedirects()");
  const out=a.elements.get("rdOut").innerHTML;
  assert.match(out,/Final status/);
  assert.match(out,/HTTP 200/);
  assert.doesNotMatch(out,/Final URL:/);
  assert.equal(a.elements.get("rdProg").textContent,"");
});
test("Redirects: when every route fails, an honest error renders — never silence",async()=>{
  const a=app();
  a.context.fetch=async()=>{throw Error("network down");};
  a.run('fetchViaProxy=async()=>{throw Error("all proxies failed");};');
  a.elements.get("rdUrl").value="https://example.com/page";
  await a.run("runRedirects()");
  assert.match(a.elements.get("rdOut").innerHTML,/Check failed/);
  assert.match(a.elements.get("rdOut").innerHTML,/every fetch route failed/);
});
test("Redirects: a 301 hop with an exposed destination renders the chain and final URL",async()=>{
  const a=app();
  a.context.fetch=async(url)=>{
    if(String(url).includes("allorigins.win/raw")) return {status:301,headers:{get:n=>n.toLowerCase()==="location"?"https://example.com/new":null},text:async()=>""};
    if(String(url).includes("allorigins.win/get")) return {ok:true,json:async()=>({status:{url:"https://example.com/new",http_code:200}})};
    throw Error("no route");
  };
  a.elements.get("rdUrl").value="https://example.com/page";
  await a.run("runRedirects()");
  const out=a.elements.get("rdOut").innerHTML;
  assert.match(out,/301/);
  assert.match(out,/example\.com\/new/);
  assert.match(out,/Final URL:/);
});

/* ---------- v2.10.0: broken links 429 is rate-limited, not broken ---------- */
test("Broken links: HTTP 429 is rate-limited, never counted as broken",async()=>{
  const a=app();
  a.elements.set("blCsvBtn",a.elements.get("blBtn"));
  a.run(`fetchPageDoc=async()=>({doc:{querySelectorAll:()=>[
    {getAttribute:()=>"https://ok.example/",textContent:"ok"},
    {getAttribute:()=>"https://slow.example/",textContent:"slow"},
    {getAttribute:()=>"https://gone.example/",textContent:"gone"}]}});`);
  a.run('fetchViaProxy=async(u)=> u.includes("slow") ? {status:429,ok:false} : u.includes("gone") ? {status:404,ok:false} : {status:200,ok:true};');
  a.elements.get("blUrl").value="https://example.com";
  await a.run("runBrokenLinks()");
  const out=a.elements.get("blOut").innerHTML;
  assert.match(out,/Rate-limited 429/);
  assert.match(out,/1 broken/);
  assert.match(out,/1 rate-limited/);
  assert.doesNotMatch(out,/Broken 429/);
});

/* ---------- v2.10.0: rank failure is visible, health copy, placeholders ---------- */
test("Rank Tracker: a failed keyword renders its note span with the last error",()=>{
  const a=app();
  a.run('LS.set("keywords",[{keyword:"seo",url:"https://example.com",checks:[],lastError:"search blocked"}]);');
  a.run("renderRankList()");
  const out=a.elements.get("rkList").innerHTML;
  assert.match(out,/rank-check-note/);
  assert.match(out,/Rank check failed: search blocked/);
});
test("Health Check copy: the intro says eight checks, matching the rendered rows",()=>{
  assert.match(html,/Eight live checks/);
  assert.doesNotMatch(html,/Seven live checks/);
});
test("Placeholders: no URL placeholder reads as a pre-filled value",()=>{
  assert.doesNotMatch(html,/placeholder="https?:\/\//);
  assert.doesNotMatch(html,/placeholder="lookforit/);
  assert.match(html,/placeholder="e\.g\. https:\/\/example\.com"/);
});

/* ---------- v2.10.0: owner admin ---------- */
test("Admin: isAdmin matches only the owner email",()=>{
  const a=app();
  assert.equal(a.run("isAdmin()"),false);
  a.run('currentUser={id:"x",email:"someone@example.com"};');
  assert.equal(a.run("isAdmin()"),false);
  a.run('currentUser={id:"x",email:"SyedSinterprises@Gmail.com"};');
  assert.equal(a.run("isAdmin()"),true);
  a.run('currentUser={id:"x",email:"syedsinterprises@gmail.com"};');
  assert.equal(a.run("isAdmin()"),true);
  a.run("currentUser=null;");
  assert.equal(a.run("isAdmin()"),false);
});
test("Admin: tool-check limits are skipped for the owner but enforced for others",()=>{
  const a=app();
  const m=new Date().toISOString().slice(0,7);
  const out={innerHTML:""};
  a.context.__out=out;
  /* Owner: usage at the limit, but the bypass skips it. (In cloud mode S.get
     reads S.cache, so the usage must be written there, not to LS.) */
  a.run('currentUser={id:"x",email:"syedsinterprises@gmail.com"}; S.mode="cloud"; currentPlan="free"; S.cache.toolChecks=Array.from({length:10},()=>({date:"'+m+'-05",type:"schema",url:"https://example.com"}));');
  assert.equal(a.run('checkToolLimit(__out)'),true);
  assert.equal(out.innerHTML,"");
  /* Non-owner: the same usage is enforced. */
  a.run('currentUser={id:"o",email:"someone@example.com"}; S.cache.toolChecks=Array.from({length:10},()=>({date:"'+m+'-05",type:"schema",url:"https://example.com"}));');
  assert.equal(a.run('checkToolLimit(__out)'),false);
  assert.match(out.innerHTML,/Free plan limit reached/);
});
test("Admin: the AI assistant daily cap is lifted for the owner",()=>{
  const a=app();
  a.run('currentUser={id:"o",email:"someone@example.com"}; currentPlan="free"; LS.set("agentUsage",{date:todayISO(),used:5});');
  assert.equal(a.run("agentCanChat().ok"),false);
  a.run('currentUser={id:"x",email:"syedsinterprises@gmail.com"}; LS.set("agentUsage",{date:todayISO(),used:5});');
  assert.equal(a.run("agentCanChat().ok"),true);
  assert.equal(a.run("agentCanChat().left"),null);
});
test("Admin: plan pill, plan card and usage line read Admin for the owner",()=>{
  const a=app();
  a.run('currentUser={id:"x",email:"syedsinterprises@gmail.com"}; currentPlan="free";');
  a.run("refreshAuthUI()");
  assert.equal(a.elements.get("planPill").textContent,"Admin");
  a.run("renderPlanCard()");
  assert.match(a.elements.get("planCard").innerHTML,/Admin — unlimited, no restrictions/);
  assert.match(a.run("limitNoteText()"),/Admin — unlimited/);
  a.run('currentUser={id:"o",email:"someone@example.com"};');
  a.run("refreshAuthUI()");
  assert.equal(a.elements.get("planPill").textContent,"Free");
  a.run("renderPlanCard()");
  assert.match(a.elements.get("planCard").innerHTML,/Your plan — Free/);
});
test("Admin: the admin section exists only for the owner, and the deep link refuses non-owners",()=>{
  const a=app();
  a.run("renderAdminSection()");
  assert.equal(a.run("adminSectionEl"),null);
  assert.equal(a.run("adminPanelEl"),null);
  assert.equal(a.run('parseTabHash("#tab=admin")'),"");
  a.run('currentUser={id:"x",email:"syedsinterprises@gmail.com"};');
  a.run("renderAdminSection()");
  assert.notEqual(a.run("adminSectionEl"),null);
  assert.notEqual(a.run("adminPanelEl"),null);
  assert.equal(a.run('parseTabHash("#tab=admin")'),"admin");
  a.run("currentUser=null;");
  a.run("renderAdminSection()");
  assert.equal(a.run("adminSectionEl"),null);
  assert.equal(a.run("adminPanelEl"),null);
});

/* ---------- v2.11.0: fix 1 — auth flicker ---------- */
test("Fix 1: the app renders only after the session check resolves, with neutral '…' stats before",()=>{
  assert.match(code,/initAuth\(\)\.then\(\(\) => \{ renderAll\(\);/);
  for(const id of ["stAudits","stKeywords","stLinks","stRevenue","stOrders"]){
    const m=html.match(new RegExp('id="'+id+'">([^<]*)<'));
    assert.ok(m, id+" missing");
    assert.equal(m[1],"…");
  }
});
/* ---------- v2.11.0: fix 2 — home button ---------- */
test("Fix 2: the home button goes to the Dashboard when signed in, the landing when signed out",()=>{
  assert.ok(code.includes('function showLanding(){ if(currentUser){ showTab("dashboard", true); } else { location.href = "./"; } }'));
});
/* ---------- v2.11.0: fixes 4+5 — footer inside <main> ---------- */
test("Fixes 4+5: the footer sits inside <main> so it is never clipped or pushed below the fold",()=>{
  const mainOpen=html.indexOf('<main id="appMain">');
  const footer=html.indexOf("<footer>");
  const mainClose=html.indexOf("</main>");
  assert.ok(mainOpen>0 && footer>mainOpen && footer<mainClose);
});
/* ---------- v2.11.0: fix 3 — header wraps ---------- */
test("Fix 3: the signed-in header keeps one row and truncates the email",()=>{
  const css=fs.readFileSync("assets/styles.css","utf8");
  assert.match(css,/#authUserLine\{flex-wrap:nowrap\}/);
  assert.match(css,/#authUserEmail\{[^}]*text-overflow:ellipsis/);
});
/* ---------- v2.11.0: fix 6 — settings false error ---------- */
test("Fix 6: settings show 'Checking…' until the status call resolves; the error appears only on a real failure",async()=>{
  const a=app();
  a.context.fetch=async()=>({ok:true,json:async()=>({google:true,billing:true,email:true,emailScheduled:false})});
  a.run('capabilitiesState="idle";'); /* the boot call left it "loading" (its fetch threw in the harness) */
  const p=a.run("loadCapabilities()");
  assert.equal(a.elements.get("integrationReadiness").textContent,"Checking integration readiness…");
  await p;
  assert.match(a.elements.get("integrationReadiness").textContent,/Google reports: configured · Paid checkout: enabled · Email: configured; schedule pending/);
  const b=app();
  b.context.fetch=async()=>{throw Error("offline");};
  b.context.setTimeout=(fn)=>{ if(typeof fn==="function") fn(); return 0; }; /* the harness setTimeout never fires; run the retry immediately */
  b.run('capabilitiesState="idle";');
  await b.run("loadCapabilities()");
  assert.match(b.elements.get("integrationReadiness").textContent,/Integration status unavailable/);
});
/* ---------- v2.11.0: fix 7 — key in plain text ---------- */
test("Fix 7: the PageSpeed key field is a password field with a show/hide toggle",()=>{
  assert.match(html,/type="password" id="setPsi"/);
  assert.ok(html.includes('id="setPsiToggle"'));
  assert.ok(html.includes('id="setAiToggle"'));
});
/* ---------- v2.11.0: fix 8 — admin dashboard progressive ---------- */
test("Fix 8: the Admin dashboard renders its shell immediately and fills each section separately",()=>{
  assert.match(code,/panel\.innerHTML = '<div class="card"><h2>Admin dashboard<\/h2>'/);
  assert.match(code,/fillAdminHealth\(\); fillAdminPay\(\); fillAdminUsers\(\);/);
  assert.match(code,/fetchTimeout\(SUPABASE_URL \+ "\/functions\/v1\/status", 10000\)/);
  assert.match(code,/Platform health unavailable — the status endpoint did not answer/);
  assert.match(code,/User stats unavailable — the admin-stats function did not answer/);
});
/* ---------- v2.11.0: fix 9b — links stat counts links, not checks ---------- */
test("Fix 9b: 'links verified' counts links found, not checks",()=>{
  const a=app();
  a.run('LS.set("links",[{id:"1",count:42},{id:"2",count:3}]);');
  a.run("renderDashboard()");
  assert.equal(a.elements.get("stLinks").textContent,"45 · 2 checks");
  assert.match(a.elements.get("stLinksStat").title,/2 link check\(s\) — 45 links found/);
});
/* ---------- v2.11.0: fix 10 — competitor duplicates ---------- */
test("Fix 10: www/non-www, protocol and trailing slash collapse to one competitor",()=>{
  const a=app();
  assert.equal(a.run('normCompetitorKey("https://www.lookforit.xyz/")'),"lookforit.xyz");
  assert.equal(a.run('normCompetitorKey("http://lookforit.xyz")'),"lookforit.xyz");
  assert.equal(a.run('normCompetitorKey("LOOKFORIT.XYZ/page/")'),"lookforit.xyz/page");
  assert.equal(a.run('dedupeCompetitors([{url:"https://www.lookforit.xyz"},{url:"http://lookforit.xyz/"},{url:"https://example.com"}]).length'),2);
  /* The two existing rows collapse at render with no database delete. */
  a.run('LS.set("competitors",[{date:"2026-11-20",url:"https://www.lookforit.xyz"},{date:"2026-11-21",url:"https://lookforit.xyz"}]);');
  a.run("renderCompetitors()");
  const out=a.elements.get("cpList").innerHTML;
  assert.equal((out.match(/lookforit\.xyz/g)||[]).length,1);
});
/* ---------- v2.11.0: fix 11 — admin counts match admin-stats ---------- */
test("Fix 11: the Admin dashboard labels match admin-stats exactly — Pro/Agency/Business separate, paying = ACTIVE only",async()=>{
  const a=app();
  a.elements.set("adminUsers",{innerHTML:"",addEventListener(){},querySelectorAll(){return[]}});
  a.run('supabaseAccessToken=async()=>"tok"; fetchJsonTimeout=async()=>({ok:true,json:async()=>({totalUsers:1,proUsers:0,agencyUsers:0,businessUsers:0,payingUsers:0,signups7d:1,auditsThisMonth:5,paypalPlanId:"P-TEST",subscription:{id:"I-FAKE",status:"APPROVAL_PENDING"}})});');
  await a.run("fillAdminUsers()");
  const out=a.elements.get("adminUsers").innerHTML;
  assert.match(out,/Total users: <b>1<\/b>/);
  assert.match(out,/Pro users: <b>0<\/b>/);
  assert.match(out,/Agency users: <b>0<\/b>/);
  assert.match(out,/Business users: <b>0<\/b>/);
  assert.match(out,/Paying users: <b>0<\/b>.*active subscriptions only/);
  assert.match(out,/APPROVAL_PENDING/);
  assert.match(out,/not active, no charge/);
});
/* ---------- v2.11.0: fix 12 — marketplace placeholder ---------- */
test("Fix 12: the marketplace price placeholder never suggests a default price",()=>{
  assert.match(html,/id="mkPrice"[^>]*placeholder="Leave blank for DM for rates"/);
  assert.doesNotMatch(html,/placeholder="20"/);
});
/* ---------- v2.11.0: fix 13 + before/after proof ---------- */
test("Fix 13: past audits show the full URL on hover and the score change since the last audit",()=>{
  const a=app();
  a.run('LS.set("audits",[{url:"https://example.com/very/long/page-url",date:"2026-11-23",psi:80,ok:6,total:8,failed:2},{url:"https://example.com/very/long/page-url",date:"2026-11-20",psi:74,ok:5,total:8,failed:3}]);');
  a.run("renderAuditHistory()");
  const out=a.elements.get("auditHistory").innerHTML;
  assert.match(out,/title="https:\/\/example\.com\/very\/long\/page-url"/);
  assert.match(out,/▲ \+6 since last audit/);
  assert.match(out,/PageSpeed 80\/100/);
  assert.equal(a.run('psiDeltaFor([{url:"https://example.com",psi:87},{url:"https://example.com",psi:80}],0)'),7);
  assert.equal(a.run('psiDeltaFor([{url:"https://example.com",psi:80},{url:"https://example.com",psi:87}],0)'),-7);
  assert.equal(a.run('psiDeltaFor([{url:"https://example.com",psi:87}],0)'),null);
});
/* ---------- v2.11.0: plan tiers ---------- */
test("Plan tiers: Free/Pro/Agency/Business limits and site counts",()=>{
  const a=app();
  assert.equal(a.run('planTier("free").sites'),1);
  assert.equal(a.run('planTier("pro").sites'),3);
  assert.equal(a.run('planTier("agency").sites'),10);
  assert.equal(a.run('planTier("business").sites'),50);
  assert.equal(a.run('planTier("bogus").sites'),1); /* unknown plan falls back to Free */
  assert.equal(a.run("isPaidPlan()"),false);
  a.run('currentPlan="pro";');
  assert.equal(a.run("isPaidPlan()"),true);
  assert.equal(a.run("siteLimitForPlan()"),3);
  a.run('currentPlan="agency";');
  assert.equal(a.run("siteLimitForPlan()"),10);
  a.run('currentPlan="business";');
  assert.equal(a.run("siteLimitForPlan()"),50);
  a.run('currentPlan="free";');
  assert.equal(a.run("siteLimitForPlan()"),1);
  /* Owner stays unlimited on every tier (and is not capped below Business on sites). */
  a.run('currentUser={id:"x",email:"syedsinterprises@gmail.com"}; currentPlan="free";');
  assert.equal(a.run("siteLimitForPlan()"),50);
  assert.match(a.run("limitNoteText()"),/Admin — unlimited/);
  /* Free limits include the AI and site caps. */
  assert.equal(a.run("PLAN_LIMITS.aiMessagesPerDay"),5);
  assert.equal(a.run("PLAN_LIMITS.sites"),1);
  assert.equal(a.run("PLAN_LIMITS.auditsPerMonth"),5);
});
test("Plan tiers: the upgrade picker lists all four plans with honest prices",()=>{
  const a=app();
  a.run('currentPlan="free";');
  const h=a.run("planPickerHtml()");
  assert.match(h,/Pro/); assert.match(h,/\$9\/month/);
  assert.match(h,/Agency/); assert.match(h,/\$29\/month/);
  assert.match(h,/Business/); assert.match(h,/Custom/);
  assert.match(h,/Talk to sales/);
  assert.match(h,/mailto:contact@syedsenterprises\.org/);
  a.run('upgradeBilling="yearly";');
  const y=a.run("planPickerHtml()");
  assert.match(y,/\$90\/year/); assert.match(y,/save \$18/);
  assert.match(y,/\$290\/year/); assert.match(y,/save \$58/);
  assert.match(y,/Custom/); /* Business never changes with the toggle */
});
test("Plan tiers: the plan card names the tier and its limits",()=>{
  const a=app();
  a.run('currentUser={id:"o",email:"someone@example.com"}; currentPlan="agency";');
  a.run("renderPlanCard()");
  assert.match(a.elements.get("planCard").innerHTML,/Agency is active/);
  assert.match(a.elements.get("planCard").innerHTML,/10 sites/);
  a.run('currentPlan="business";');
  a.run("renderPlanCard()");
  assert.match(a.elements.get("planCard").innerHTML,/Business is active/);
  assert.match(a.elements.get("planCard").innerHTML,/50 sites/);
});
/* ---------- v2.11.0: share deep links (the Magnet) ---------- */
test("Share links: #tab=health&url= parses and validates the URL",()=>{
  const a=app();
  assert.equal(a.run('parseShareHash("#tab=health&url=https%3A%2F%2Fexample.com")'),"https://example.com");
  assert.equal(a.run('parseShareHash("#tab=health&url=example.com")'),"https://example.com");
  assert.equal(a.run('parseShareHash("#tab=health&url=javascript%3Aalert(1)")'),"");
  assert.equal(a.run('parseShareHash("#tab=health")'),"");
  assert.equal(a.run('parseShareHash("")'),"");
  assert.equal(a.run('parseTabHash("#tab=health&url=https%3A%2F%2Fexample.com")'),"health");
});
/* ---------- v2.11.1 audit fixes: save-link hash (#auth=signup&tab=health&url=) ---------- */
test("Save links: #auth=signup&tab=health&url= parses tab, auth and URL",()=>{
  const a=app();
  const save="#auth=signup&tab=health&url=https%3A%2F%2Fexample.com";
  assert.equal(a.run('parseShareHash("'+save+'")'),"https://example.com");
  assert.equal(a.run('parseTabHash("'+save+'")'),"health");
  assert.equal(a.run('parseAuthHash("'+save+'")'),"signup");
  /* Same shape with signin, and a junk URL still validates to "". */
  assert.equal(a.run('parseShareHash("#auth=signin&tab=health&url=example.com")'),"https://example.com");
  assert.equal(a.run('parseShareHash("#auth=signup&tab=health&url=javascript%3Aalert(1)")'),"");
});
test("Paid tiers are unlimited: Agency/Business pass every free-plan limit gate",()=>{
  const a=app();
  a.run("S.mode='cloud';");
  assert.equal(a.run("planLimitApplies()"),true); /* Free + cloud: limits apply */
  a.run('currentPlan="pro";');
  assert.equal(a.run("planLimitApplies()"),false);
  a.run('currentPlan="agency";');
  assert.equal(a.run("planLimitApplies()"),false);
  a.run('currentPlan="business";');
  assert.equal(a.run("planLimitApplies()"),false);
  /* Local mode never limits; the owner never limits either. */
  a.run('currentPlan="free"; S.mode="local";');
  assert.equal(a.run("planLimitApplies()"),false);
  a.run('S.mode="cloud"; currentUser={id:"x",email:"syedsinterprises@gmail.com"};');
  assert.equal(a.run("planLimitApplies()"),false);
});
test("Share card leads with the stable Speed Score, PageSpeed stamped with run time",()=>{
  const a=app();
  const full=a.run('auditShareText({site:"https://example.com",score:73,sfScore:87,sfGrade:"Good",lcp:"4.4 s",cls:"0",date:"2026-11-23",time:"20:41"})');
  assert.match(full,/Speed Score 87\/100/);
  assert.ok(full.indexOf("Speed Score")<full.indexOf("PageSpeed"),"Speed Score must lead, PageSpeed is secondary");
  assert.match(full,/PageSpeed 73\/100 at 20:41/);
  assert.match(full,/varies run to run/);
  /* PageSpeed-only mode (no Speed Score): PageSpeed still stamped, never a stable badge. */
  const psiOnly=a.run('auditShareText({site:"https://example.com",score:54,sfScore:null,sfGrade:null,lcp:null,cls:null,date:"2026-11-23",time:"20:41"})');
  assert.match(psiOnly,/PageSpeed 54\/100 at 20:41/);
  assert.match(psiOnly,/varies run to run/);
  assert.doesNotMatch(psiOnly,/Speed Score/);
});
test("PageSpeed direct call requests the SEO category (else the SEO list is always empty)",async()=>{
  const a=app();
  let captured="";
  a.context.fetch=async(url)=>{ captured=String(url); throw new Error("stubbed"); };
  await assert.rejects(a.run("runPSIDirect('https://example.com','mobile')"));
  assert.match(captured,/category=performance&category=seo/);
});
/* ---------- v2.11.1 audit fixes (round 2): genuine reports + empty states + cloud-load gate ---------- */
test("Content Brief stores the real H1 and the SERP title separately, never one as the other",()=>{
  const a=app();
  assert.doesNotMatch(code,/h1:p\.h1\|\|p\.title/);
  assert.match(code,/h1:p\.h1\|\|null, serpTitle:p\.title\|\|null, words:p\.words, error:p\.error\|\|null/);
  const out=a.run('briefHtml({keyword:"x",targetWordCount:100,headings:[],questions:[],competitors:[{url:"https://a.com",h1:null,serpTitle:"A Page Title",words:500},{url:"https://b.com",h1:null,serpTitle:null,words:null,error:"fetch failed"}]})');
  assert.match(out,/A Page Title/); /* SERP title shown as the title, not as the H1 */
  assert.match(out,/could not read/); /* failed page is labelled, not silently blank */
});
test("Sitemap generator never fabricates a <lastmod> date",()=>{
  /* The emitted <url> element carries <loc> only — no <lastmod> stamped with
     today's date (the generator never reads any page's real modification
     date). The comment above the generator may mention the tag by name. */
  assert.match(code,/'\s*<url><loc>' \+ esc\(u\) \+ '<\/loc><\/url>'/);
  assert.doesNotMatch(code,/<\/loc><lastmod>/);
});
test("A share link pasted while already in the app runs the Health Check (hashchange)",()=>{
  assert.match(code,/addEventListener\("hashchange"/);
  assert.match(code,/const shared = parseShareHash\(location\.hash\);/);
  assert.match(code,/if\(shared\)\{[\s\S]{0,400}runHealth\(\);/);
});
test("Hero fallback fetch times out instead of hanging the audit button",()=>{
  assert.match(landing,/AbortController/);
  assert.match(landing,/api\.allorigins\.win\/raw\?url=/);
  assert.match(landing,/timed out after 15 seconds/);
});
test("Robots tab has a visible loading element",()=>{
  assert.match(html,/id="rbProg"/);
});
test("Every tool tab has a static empty state (no blank output area)",()=>{
  const hints={
    kwOut:"No suggestions yet", serpOut:"No preview yet", blOut:"No link check yet",
    rdOut:"No redirect trace yet", scOut:"No scan yet", rbOut:"No robots.txt fetched yet",
    estOut:"No estimate yet", hcOut:"No health check yet", bkOut:"No bulk audit yet",
    auditOut:"No audit yet", lvOut:"No link check yet", brOut:"No brief yet",
    cpOut:"No comparison yet", gscOut:"No Search Console report yet", ga4Out:"No Analytics report yet",
    rgOut:"No robots.txt generated yet", smOut:"No sitemap yet"
  };
  for(const [id, text] of Object.entries(hints)){
    assert.match(html, new RegExp('id="'+id+'"><p class="muted">'+text));
  }
});
test("Dashboard in cloud mode shows — until the account data loads (never fake zeros)",()=>{
  const a=app();
  a.run('S.mode="cloud"; S.cache.audits=[{url:"https://example.com",psi:80}];');
  a.run("renderDashboard()");
  assert.equal(a.elements.get("stAudits").textContent,"—");
  assert.match(a.elements.get("dashHealth").innerHTML,/Loading your account data/);
  a.run("renderDashboardExtras()");
  assert.match(a.elements.get("revCompare").innerHTML,/Loading your account data/);
  a.run('cloudDataFailed=true;');
  a.run("renderDashboard()");
  assert.match(a.elements.get("dashHealth").innerHTML,/could not load/);
  a.run('cloudDataLoaded=true; cloudDataFailed=false;');
  a.run("renderDashboard()");
  assert.equal(a.elements.get("stAudits").textContent,1);
});
test("Revenue compare says 'nothing logged' when no entries exist (no bare $0.00 vs $0.00)",()=>{
  const a=app();
  a.run("renderDashboardExtras()");
  assert.match(a.elements.get("revCompare").innerHTML,/nothing logged for this month or last month/);
  a.run('LS.set("revenue",[{date:todayISO(),network:"AdSense",amount:12.5}]);');
  a.run("renderDashboardExtras()");
  assert.match(a.elements.get("revCompare").innerHTML,/\$12\.50 this month vs \$0\.00 last month/);
});
test("GSC/GA4 totals say 'not reported' when the API reports nothing (never a fake zero)",async()=>{
  const a=app();
  a.run('googleApi=async()=>({totals:{}});');
  a.elements.get("gscSite").value="https://example.com";
  a.elements.get("gscStart").value="2026-10-27";
  a.elements.get("gscEnd").value="2026-11-23";
  await a.run("runGscReport()");
  assert.match(a.elements.get("gscOut").innerHTML,/not reported/);
  assert.doesNotMatch(a.elements.get("gscOut").innerHTML,/0 clicks/);
  a.run('googleApi=async()=>({sessions:null,users:null});');
  a.elements.get("ga4Prop").value="properties/123";
  await a.run("runGa4Report()");
  assert.match(a.elements.get("ga4Out").innerHTML,/not reported/);
  a.run('googleApi=async()=>({sessions:21,users:13});');
  await a.run("runGa4Report()");
  assert.match(a.elements.get("ga4Out").innerHTML,/21/);
  assert.doesNotMatch(a.elements.get("ga4Out").innerHTML,/not reported/);
});
test("Featured listings: Agency/Admin only, featured sorts first",()=>{
  const a=app();
  assert.equal(a.run('toggleFeaturedListing("custom-1")'),false); /* free user */
  a.run('currentPlan="agency";');
  assert.equal(a.run('toggleFeaturedListing("custom-1")'),true);
  assert.equal(a.run('featuredFirst([{id:"custom-2"},{id:"custom-1"}])[0].id'),"custom-1");
  a.run('toggleFeaturedListing("custom-1")');
  assert.equal(a.run('featuredFirst([{id:"custom-2"},{id:"custom-1"}])[0].id'),"custom-2");
  /* Owner can feature without a plan. */
  a.run('currentUser={id:"x",email:"syedsinterprises@gmail.com"}; currentPlan="free";');
  assert.equal(a.run('toggleFeaturedListing("custom-2")'),true);
});
test("Featured listings: Business includes everything in Agency, so it can feature too",()=>{
  const a=app();
  a.run('currentPlan="business";');
  assert.equal(a.run('toggleFeaturedListing("custom-1")'),true);
  assert.equal(a.run("canFeatureListings()"),true);
  a.run('currentPlan="pro";');
  assert.equal(a.run('toggleFeaturedListing("custom-1")'),false);
  assert.equal(a.run("canFeatureListings()"),false);
});
test("Forge counts: rank checks live in keywords[].checks, links are summed .count",()=>{
  const a=app();
  /* A stray rankChecks key (the old bug's source) must be ignored. */
  a.run('LS.set("keywords",[{keyword:"a",url:"",checks:[{position:1},{position:2}]},{keyword:"b",url:"",checks:[{position:4}]}]); LS.set("rankChecks",[{id:"x"},{id:"y"},{id:"z"}]); LS.set("links",[{id:"1",count:42},{id:"2",count:3}]);');
  assert.equal(a.run("agentDataCounts().ranks"),3);
  assert.equal(a.run("agentDataCounts().links"),45);
  assert.match(a.run('agentLocalAnswer("how many links have I verified?")'),/45 verified links/);
  assert.match(a.run('agentLocalAnswer("how many keywords am I tracking?")'),/3 rank checks/);
});
test("Competitors: www. and bare host in the SAME run insert once",async()=>{
  const a=app();
  await a.run('recordCompetitors(["https://www.example.com","https://example.com"])');
  assert.equal(a.run('S.get("competitors", []).length'),1);
  /* Two genuinely different paths still insert as two rows. */
  await a.run('recordCompetitors(["https://example.com/a","https://example.com/b"])');
  assert.equal(a.run('S.get("competitors", []).length'),3);
});
test("Compares are counted by runs, not by stored rows",()=>{
  const a=app();
  a.run('LS.set("toolChecks",[{date:todayISO(),type:"compare",url:"a vs b"},{date:todayISO(),type:"compare",url:"c vs d"},{date:todayISO(),type:"broken-links",url:"x"}]);');
  assert.equal(a.run("v25Usage().comparesUsed"),2);
  assert.equal(a.run("v25Usage().toolChecksUsed"),1); /* "compare" rows do not consume the tool-checks limit */
});
test("Dashboard links stat shows the check count visibly, not only in a tooltip",()=>{
  const a=app();
  a.run('LS.set("links",[{id:"1",count:42}]);');
  a.run("renderDashboard()");
  assert.equal(a.elements.get("stLinks").textContent,"42 · 1 check");
  a.run('LS.set("links",[{id:"1",count:40},{id:"2",count:2}]);');
  a.run("renderDashboard()");
  assert.equal(a.elements.get("stLinks").textContent,"42 · 2 checks");
});
/* ---------- v2.11.0: trust helpers ---------- */
test("Trust: score ring, verify link, measured line",()=>{
  const a=app();
  const ring=a.run("scoreRingSVG(87)");
  assert.match(ring,/<svg/);
  assert.match(ring,/87/);
  assert.equal(a.run('pagespeedVerifyUrl("https://example.com")'),"https://pagespeed.web.dev/analysis?url=https%3A%2F%2Fexample.com");
  assert.match(a.run('measuredLine("PageSpeed score: measured by Google PageSpeed Insights")'),/How this is measured/);
  assert.match(a.run('measuredLine("x")'),/checked just now/);
});
/* ---------- v2.11.0: app presentation pass ---------- */
test("App presentation: every tab section has a page header, the guest action is a quiet text link, 10 site slots",()=>{
  assert.equal((html.match(/class="card page-head"/g)||[]).length,19);
  assert.match(html,/<button type="button" class="text-link" id="authGuestLink">Continue without an account<\/button>/);
  assert.doesNotMatch(html,/headerGuestBtn/); /* no redundant header "Launch app" button — guest entry is the card's quiet link */
  for(let i=1;i<=10;i++) assert.ok(html.includes('id="siteSlot'+i+'"'),"missing siteSlot"+i);
});
/* ---------- v2.11.x: auth view is one mode at a time ---------- */
test("Auth view: heading and single primary button always match the mode",()=>{
  const a=app();
  a.run('showAuthView("signup")');
  assert.equal(a.run("authMode"),"signup");
  assert.equal(a.elements.get("authViewTitle").textContent,"Create your free account");
  assert.equal(a.elements.get("signUpBtn").hidden,false);
  assert.equal(a.elements.get("signInBtn").hidden,true);
  assert.equal(a.elements.get("forgotPassword").hidden,true); /* reset is sign-in only */
  assert.equal(a.elements.get("googleSignInBtn").hidden,false);
  assert.equal(a.elements.get("authGuestLink").hidden,false);
  assert.match(a.elements.get("authModeSwitch").textContent,/Already have an account\? Sign in/);
  assert.equal(a.elements.get("authModeSwitch").href,"#auth=signin");
  assert.equal(a.context.document.documentElement.dataset.authView,"1"); /* minimal header while the card is up */
  a.run('showAuthView("signin")');
  assert.equal(a.run("authMode"),"signin");
  assert.equal(a.elements.get("authViewTitle").textContent,"Sign in to SEOForge");
  assert.equal(a.elements.get("signInBtn").hidden,false);
  assert.equal(a.elements.get("signUpBtn").hidden,true);
  assert.equal(a.elements.get("forgotPassword").hidden,false);
  assert.equal(a.elements.get("googleSignInBtn").hidden,false);
  assert.match(a.elements.get("authModeSwitch").textContent,/No account yet\? Create a free account/);
  assert.equal(a.elements.get("authModeSwitch").href,"#auth=signup");
  a.run("showApp()");
  assert.equal(a.context.document.documentElement.dataset.authView,undefined); /* full header returns with the app */
  assert.equal(a.elements.get("authView").hidden,true);
});
/* ---------- v2.11.x: pre-render gate applies the auth mode at first paint ---------- */
/* The mode switch in app.js only runs after the async session check, so without
   the gate a #auth=signup link first paints the static sign-in form. The gate
   runs the same mode switch inline, before first paint. */
function gate(hash){
  const elements=new Map();
  for(const match of html.matchAll(/id="([^"]+)"/g)){
    elements.set(match[1],{value:"",textContent:"",innerHTML:"",hidden:false,style:{},dataset:{},classList:{toggle(){}},listeners:{},addEventListener(name,cb){this.listeners[name]=cb;},querySelectorAll(){return[];},appendChild(){},focus(){},remove(){}});
  }
  const m=html.match(/<script>\n\/\* Pre-render gate:[\s\S]*?\}\)\(\);\n<\/script>/);
  assert.ok(m,"pre-render gate script missing from app.html");
  const context={console,URL,URLSearchParams,Date,Math,JSON,Promise,
    localStorage:storage(),sessionStorage:storage(),
    location:{href:"https://example.com/app.html"+hash,search:"",hash,reload(){}},
    history:{replaceState(){},pushState(){}},
    document:{getElementById:id=>{assert.ok(elements.has(id),"missing DOM element: "+id);return elements.get(id);},querySelectorAll:()=>[],addEventListener(){},createElement:()=>fakeEl(),documentElement:{dataset:{},style:{setProperty(){}}}}};
  context.window=context;
  vm.createContext(context);
  vm.runInContext(m[0].replace(/<\/?script>/g,""),context);
  return {context,elements};
}
test("Pre-render gate: #auth=signup paints the signup form before app.js runs",()=>{
  const g=gate("#auth=signup");
  assert.equal(g.elements.get("authViewTitle").textContent,"Create your free account");
  assert.equal(g.elements.get("signInBtn").hidden,true);
  assert.equal(g.elements.get("signUpBtn").hidden,false);
  assert.equal(g.elements.get("forgotPassword").hidden,true);
  assert.match(g.elements.get("authModeSwitch").textContent,/Already have an account\? Sign in/);
  assert.equal(g.elements.get("authModeSwitch").href,"#auth=signin");
});
test("Pre-render gate: #auth=signin paints the sign-in form; no hash leaves the static sign-in form",()=>{
  const g=gate("#auth=signin");
  assert.equal(g.elements.get("authViewTitle").textContent,"Sign in to SEOForge");
  assert.equal(g.elements.get("signInBtn").hidden,false);
  assert.equal(g.elements.get("signUpBtn").hidden,true);
  assert.equal(g.elements.get("forgotPassword").hidden,false);
  assert.equal(g.elements.get("authModeSwitch").href,"#auth=signup");
  const n=gate("");
  assert.equal(n.elements.get("signInBtn").hidden,false);
  assert.equal(n.elements.get("signUpBtn").hidden,false); /* gate touches nothing without a hash */
});
test("Auth view: Enter submits the shown mode, not always sign-in",async()=>{
  const a=app();
  a.run('cloudAvailable=true; sb={auth:{signUp:async()=>({data:{user:{identities:[]}},error:null}),signInWithPassword:async()=>({data:{},error:{message:"Invalid login credentials"}})}};');
  a.elements.get("authEmail").value="someone@example.com";
  a.elements.get("authPass").value="a-very-long-password";
  a.run('showAuthView("signup")');
  await a.elements.get("authPass").listeners.keydown({key:"Enter"});
  assert.match(a.elements.get("authMsg").textContent,/already exists/);
  a.run('showAuthView("signin")');
  await a.elements.get("authPass").listeners.keydown({key:"Enter"});
  assert.match(a.elements.get("authMsg").textContent,/Sign-in failed/);
});
test("Theme: the Settings select lists Light first (the new default)",()=>{
  const m=html.match(/<select id="prefTheme">([\s\S]*?)<\/select>/);
  assert.ok(m,"prefTheme select missing");
  assert.deepEqual([...m[1].matchAll(/value="([^"]+)"/g)].map(x=>x[1]),["light","dark","system"]);
});
/* ---------- v2.11.0: landing redesign (item 14) ---------- */
test("Landing: the three paths are real buttons with the right destinations",()=>{
  assert.match(landing,/<a class="btn" href="\.\/app\.html#auth=signup">Create free account<\/a>/);
  assert.match(landing,/<a class="btn secondary" href="\.\/app\.html#auth=signin">Sign in<\/a>/);
  assert.match(landing,/<a class="text-link" href="\.\/app\.html#guest">Continue without an account<\/a>/); /* guest path is a quiet text link, not a button */
  assert.equal((landing.match(/href="\.\/app\.html#auth=signup"/g)||[]).length,4); /* header + hero + pricing + closing — one per section, no repeats after sections */
  assert.doesNotMatch(landing,/assets\/app\.js/); /* the landing never loads the app */
  assert.match(landing,/assets\/core\.js/); /* the hero widget needs the shared scoring module */
});
/* ---------- v2.11.x: landing CTA discipline + mobile hamburger ---------- */
test("Landing: account buttons live only where the user decides — no repeated pairs after sections",()=>{
  /* "Create free account" appears exactly 3 times: header, hero, closing.
     Pricing has one "Create a free account" button (a different string). */
  assert.equal((landing.match(/>Create free account</g)||[]).length,3);
  assert.equal((landing.match(/href="\.\/app\.html#auth=signup"/g)||[]).length,4); /* header + hero + pricing + closing */
  assert.equal((landing.match(/href="\.\/app\.html#auth=signin"/g)||[]).length,1); /* header only */
  assert.equal((landing.match(/<div class="cta">/g)||[]).length,2); /* hero + closing only */
  assert.doesNotMatch(landing,/btn-ghost/); /* no ghost buttons left on the landing */
  /* The only "Sign in" text outside the header button is the FAQ sentence. */
  assert.equal((landing.match(/Sign in/g)||[]).length,2);
});
test("Landing: mobile header is a hamburger that opens the same nav + auth as a dropdown",()=>{
  assert.match(landing,/<button id="landingNavToggle" class="landing-nav-toggle" type="button" aria-expanded="false" aria-controls="landingNavPanel" aria-label="Menu">/);
  assert.match(landing,/<div class="landing-nav-panel" id="landingNavPanel">/);
  assert.match(landing,/landingHeader\.classList\.toggle\("nav-open"\)/);
  assert.match(landing,/navToggle\.setAttribute\("aria-expanded"/);
  const css=fs.readFileSync("assets/styles.css","utf8");
  assert.match(css,/\.landing-nav-toggle\{display:none/); /* hidden on desktop */
  assert.match(css,/@media \(max-width:768px\)/);
  assert.match(css,/\.landing-header\.nav-open \.landing-nav-panel\{display:flex/); /* panel opens as a dropdown */
  assert.match(css,/\.landing-nav-panel\{display:contents\}/); /* layout-transparent on desktop */
  /* Header contrast (the audit fix) is intact in the stylesheet: the header
     is an accent tint (never a hardcoded dark block) and its text is the
     theme ink, so it stays readable in light and dark themes. */
  assert.match(css,/\.landing-header\{[^}]*background:var\(--accent-tint\)/);
  assert.match(css,/\.landing-nav a\{color:var\(--ink\)/);
  assert.match(css,/\.landing-auth a\.btn\.secondary\{[^}]*border-color:var\(--accent-line\)/);
});
test("Accent: applyPreferences sets --accent and the --teal alias live, no reload",()=>{
  const a=app();
  const seen={};
  a.context.document.documentElement.style.setProperty=(k,v)=>{seen[k]=v;};
  a.run('applyPreferences(SEOForgeCore.validatePreferences({theme:"light",accent:"#7c3aed"}))');
  assert.deepEqual(seen,{"--accent":"#7c3aed","--teal":"#7c3aed","--accent-on":"#ffffff","--accent-dark":"#7c3aed","--accent-ink":"#7c3aed"});
  /* Saving through Settings persists the pick in the same store the
     landing reads, so landing and app always agree. */
  a.run('LS.set("preferences",SEOForgeCore.validatePreferences({accent:"#ea580c"}))');
  assert.equal(a.run('LS.get("preferences",{}).accent'),"#ea580c");
  assert.equal(a.run('SEOForgeCore.validatePreferences(LS.get("preferences",{})).accent'),"#ea580c");
});
test("Accent: the Good score band follows --accent, other bands keep their meaning",()=>{
  const a=app();
  const good=a.run('scoreRingSVG(85)');
  assert.match(good,/stroke:var\(--accent\)/);
  assert.doesNotMatch(good,/#0f766e/);
  assert.match(a.run('scoreRingSVG(73)'),/stroke:var\(--accent\)/);
  assert.match(a.run('scoreRingSVG(95)'),/#15803d/); /* Excellent stays green */
  assert.match(a.run('scoreRingSVG(60)'),/#b45309/); /* Needs work stays amber */
  assert.match(a.run('scoreRingSVG(40)'),/#b91c1c/); /* Poor stays red */
  assert.match(a.run('scoreRingSVG(null)'),/#94a3b8/); /* not scored stays grey */
  assert.doesNotMatch(a.run('scoreRingSVG(85)'),/stroke="#0f766e"/);
});
test("Accent: landing and app pre-paint scripts read the same stored accent",()=>{
  /* Both pages read localStorage key "syedSuite.preferences" (the guest key
     Settings writes) and set --accent + --teal before first paint. */
  assert.match(landing,/localStorage\.getItem\("syedSuite\.preferences"\)/);
  assert.match(landing,/setProperty\("--accent",_a\)/);
  assert.match(landing,/setProperty\("--teal",_a\)/);
  assert.match(html,/localStorage\.getItem\("syedSuite\.preferences"\)/);
  assert.match(html,/setProperty\("--accent",_a\)/);
  /* The landing hero ring's Good band follows --accent too (or the darkened
     form for a light accent — ringVar), and the landing re-applies the
     accent on storage events (live, no reload). */
  assert.match(landing,/var ringVar = "var\(--accent\)"/);
  assert.match(landing,/style="stroke:'\+ringVar\+'"/);
  assert.match(landing,/addEventListener\("storage"/);
  /* R2b: both pre-paint scripts also read the signed-in user's namespaced
     prefs key (from the saved session token) before the guest key. */
  assert.match(landing,/syedSuite\.user\."\+_uid\+"\.preferences/);
  assert.match(html,/syedSuite\.user\."\+_uid\+"\.preferences/);
});
test("Landing: the showcase is a labelled demo, never our own site's numbers",()=>{
  assert.match(landing,/Demo — real run of example\.com/);
  assert.match(landing,/Mobile performance score 100\/100/);
  assert.match(landing,/Sample — format only/);
  assert.doesNotMatch(landing,/87\/100/); /* no real stats from our own sites */
  assert.doesNotMatch(landing,/lookforit\.xyz scored/);
  assert.match(landing,/data-showcase="audit"/);
  assert.match(landing,/data-showcase="keywords"/);
  assert.match(landing,/data-showcase="links"/);
  assert.match(landing,/id="tryKw"/);
  assert.match(landing,/id="heroUrl"/);
  assert.match(landing,/id="heroAuditBtn"/);
  assert.match(landing,/id="heroAuditOut"/);
  assert.match(landing,/id="heroShareBtn"|Share your score/); /* the share action is in the widget script */
});
test("Landing: pricing has all four tiers with exact limits and the monthly/yearly toggle",()=>{
  for(const t of ["Free","Pro","Agency","Business"]) assert.ok(landing.includes("<h3>"+t+"</h3>"));
  assert.match(landing,/data-billing="monthly"/);
  assert.match(landing,/data-billing="yearly"/);
  assert.match(landing,/Custom/);
  assert.match(landing,/Talk to sales/);
  assert.match(landing,/mailto:contact@syedsenterprises\.org\?subject=SEOForge%20Business%20plan/);
  assert.match(landing,/\$9.*\/month/);
  assert.match(landing,/\$90.*\/year/);
  assert.match(landing,/\$29.*\/month/);
  assert.match(landing,/\$290.*\/year/);
  assert.match(landing,/save \$18/);
  assert.match(landing,/save \$58/);
});
test("Landing: Learn links to the three real LookForIt articles; Hire names only what is true",()=>{
  for(const u of ["best-free-ai-tools-for-nonprofits-2026","best-ai-tools-for-authors-2026","best-ai-tools-to-repurpose-content-2026"]) assert.ok(landing.includes("https://lookforit.xyz/articles/"+u+".html"),u);
  assert.match(landing,/Hire Syed/);
  assert.match(landing,/final-year Computer Science student/);
  assert.match(landing,/SEO content writer/);
  assert.match(landing,/founder of Syed Enterprises/);
  assert.match(landing,/mailto:contact@syedsenterprises\.org/);
  assert.match(landing,/https:\/\/syedsenterprises\.org/);
  assert.match(landing,/More from Syed Enterprises/);
  assert.match(landing,/https:\/\/www\.lookforit\.xyz/);
  assert.match(landing,/https:\/\/www\.estatepath\.online/);
  assert.doesNotMatch(landing,/testimonial/i);
  assert.doesNotMatch(landing,/partner/i); /* no fake partners */
});
test("Landing: 'Why SEOForge' carries the positioning and the honest gap",()=>{
  assert.match(landing,/Why SEOForge/);
  assert.match(landing,/\$9 vs \$139/);
  assert.match(landing,/freelancers, students, small publishers, bloggers in India/);
  assert.match(landing,/Semrush has no link marketplace/);
  assert.match(landing,/we do NOT have a backlink index/);
  assert.match(landing,/never claim "Semrush power" or "Ahrefs alternative"/);
  assert.match(landing,/Why trust this/);
  assert.match(landing,/Measured by Google's own API/);
  assert.match(landing,/Verify it yourself in one click/);
  assert.match(landing,/Free audit first, no card/);
  assert.match(landing,/We admit what we can't do/);
});
test("Landing: every nav and footer link resolves to a real target",()=>{
  for(const id of ["tools","pricing","solutions","learn","faq","hire"]) assert.ok(landing.includes('id="'+id+'"'),"missing anchor #"+id);
  const tabs=["audit","keywords","links","brief","gsc","ads","preferences"];
  for(const t of tabs) assert.ok(html.includes('data-tab="'+t+'"'),"missing app tab "+t);
  for(const t of tabs) assert.ok(landing.includes('./app.html#tab='+t),"footer missing "+t);
  assert.ok(landing.includes('./privacy'));
  assert.ok(landing.includes('./terms'));
  /* Canonical clean URLs: /privacy.html and /terms.html 307-redirect to
     /privacy and /terms, so the footer links the canonical form and no
     .html legal link may remain. */
  assert.doesNotMatch(landing, /\.\/privacy\.html/);
  assert.doesNotMatch(landing, /\.\/terms\.html/);
});

/* ---------- v2.11.0 round 3: human-audit fixes ---------- */
/* Shared setup for runAudit tests: a fake DOMParser that reads <loc> values
   out of sitemap XML (and reports a <parsererror> for HTML error pages). */
function auditSetup(a, n){
  a.context.DOMParser=class{
    parseFromString(text){
      const t=String(text||"");
      const isIndex=/<sitemapindex/i.test(t);
      const locs=[...t.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>({textContent:m[1]}));
      const isHtml=/<html/i.test(t);
      return {
        querySelectorAll:(sel)=> sel==="url > loc" ? (isIndex?[]:locs) : sel==="sitemap > loc" ? (isIndex?locs:[]) : [],
        querySelector:(sel)=> sel==="parsererror" ? (isHtml?{}:null) : null,
        documentElement:{tagName:isHtml?"html":(isIndex?"sitemapindex":"urlset")},
        body:null
      };
    }
  };
  const urls=Array.from({length:n},(_,i)=>"https://example.com/p"+i);
  a.run('__sitemapXml="<urlset>'+urls.map(u=>"<url><loc>"+u+"</loc></url>").join("")+'</urlset>";');
  a.elements.get("auditUrl").value="https://example.com";
  return urls;
}
test("N1: Agency saves 10 sites, reload refills all 10 slots, re-save keeps 10",()=>{
  const a=app();
  const sites=Array.from({length:10},(_,i)=>"https://site"+(i+1)+".example");
  a.run('currentPlan="agency";');
  a.run('LS.set("sites",'+JSON.stringify(sites)+');');
  a.run("loadSiteSlots()");
  for(let i=1;i<=10;i++) assert.equal(a.elements.get("siteSlot"+i).value,sites[i-1]);
  a.elements.get("siteSaveBtn").listeners.click();
  assert.equal(a.run('LS.get("sites", []).length'),10);
  assert.equal(a.run('JSON.stringify(LS.get("sites", []))'),JSON.stringify(sites));
});
test("N1/B4: Business gets dynamic slots up to the 50-site plan limit",()=>{
  const a=app();
  const sites=Array.from({length:12},(_,i)=>"https://site"+(i+1)+".example");
  a.run('currentPlan="business";');
  a.run('LS.set("sites",'+JSON.stringify(sites)+');');
  a.run("loadSiteSlots()");
  assert.equal(a.run("extraSiteSlotEls.length"),40);
  assert.equal(a.elements.get("siteSlot1").value,"https://site1.example");
  assert.equal(a.run("extraSiteSlotEls[1].input.value"),"https://site12.example");
  a.elements.get("siteSaveBtn").listeners.click();
  assert.equal(a.run('LS.get("sites", []).length'),12);
  /* Dropping back to Free removes the extra slots — and the save caps at 1. */
  a.run('currentPlan="free"; loadSiteSlots();');
  assert.equal(a.run("extraSiteSlotEls.length"),0);
});
test("N4: a failed save never erases a Broken Links result",async()=>{
  const a=app();
  a.elements.set("blCsvBtn",a.elements.get("blBtn"));
  a.run('recordToolCheck=async()=>{throw new Error("insert failed")};');
  a.run('fetchPageDoc=async()=>({doc:{querySelectorAll:()=>[],querySelector:()=>null},status:200,text:""});');
  a.elements.get("blUrl").value="https://example.com";
  await a.run("runBrokenLinks()");
  const out=a.elements.get("blOut").innerHTML;
  assert.match(out,/0 OK/);
  assert.match(out,/could not be saved to your history/);
  assert.doesNotMatch(out,/Check failed/);
});
test("N4: a failed save never erases a Schema result",async()=>{
  const a=app();
  a.run('recordToolCheck=async()=>{throw new Error("insert failed")};');
  a.run('fetchPageDoc=async()=>({doc:{querySelectorAll:()=>[],querySelector:()=>null},status:200,text:""});');
  a.elements.get("scUrl").value="https://example.com";
  await a.run("runSchema()");
  const out=a.elements.get("scOut").innerHTML;
  assert.match(out,/No JSON-LD found/);
  assert.match(out,/could not be saved to your history/);
  assert.doesNotMatch(out,/Check failed/);
});
test("N4: a failed save never erases a Robots result (404 branch)",async()=>{
  const a=app();
  a.run('recordToolCheck=async()=>{throw new Error("insert failed")};');
  a.run('fetchViaProxy=async()=>({status:404,ok:false,text:""});');
  a.elements.get("rbSite").value="https://example.com";
  await a.run("runRobotsFetch()");
  const out=a.elements.get("rbOut").innerHTML;
  assert.match(out,/No robots\.txt found/);
  assert.match(out,/could not be saved to your history/);
  assert.doesNotMatch(out,/Fetch failed/);
});
test("N4: a failed save never erases a Sitemap result",async()=>{
  const a=app();
  a.elements.set("smCopyBtn",a.elements.get("smBtn"));
  a.elements.set("smDlBtn",a.elements.get("smBtn"));
  a.run('recordToolCheck=async()=>{throw new Error("insert failed")};');
  a.run('fetchPageDoc=async()=>({doc:{querySelectorAll:()=>[],querySelector:()=>null},status:200,text:""});');
  a.elements.get("smSite").value="https://example.com";
  await a.run("runSitemapGen()");
  const out=a.elements.get("smOut").innerHTML;
  assert.match(out,/1 internal URL\(s\) found/);
  assert.match(out,/could not be saved to your history/);
  assert.doesNotMatch(out,/Generation failed/);
});
test("N5: the Rank Tracker Add button disables during the save and restores after",async()=>{
  const a=app();
  a.run('saveKeyword=async(kw,url)=>{ await new Promise(r=>{__saveGate=r;}); const list=LS.get("keywords",[]); list.push({keyword:kw,url:url||"",checks:[],difficulty:null}); LS.set("keywords",list); return "saved"; };');
  a.elements.get("rkKw").value="seo tools";
  a.elements.get("rkUrl").value="https://example.com";
  const btn=a.elements.get("rkAddBtn");
  const done=btn.listeners.click();
  assert.equal(btn.disabled,true);
  assert.equal(btn.textContent,"Saving…");
  a.context.__saveGate("saved");
  await done;
  assert.equal(btn.disabled,false);
  assert.equal(btn.textContent,"Add to tracker");
  assert.equal(a.run('LS.get("keywords", []).length'),1);
});
test("N5: revenue and listing Add buttons disable during the save (finally restores)",()=>{
  assert.match(code,/\$\("revAddBtn"\)\.addEventListener\("click", async \(\) => \{[\s\S]*?btn\.disabled = true; btn\.textContent = "Logging…"/);
  assert.match(code,/btn\.disabled = false; btn\.textContent = "Log revenue"/);
  assert.match(code,/\$\("mkAddBtn"\)\.addEventListener\("click", async \(\) => \{[\s\S]*?btn\.disabled = true; btn\.textContent = "Adding…"/);
  assert.match(code,/btn\.disabled = false; btn\.textContent = "Add listing"/);
});
test("N6: a PayPal cancel return says no charge was made and strips the token",()=>{
  const a=app("?token=BA-123CANCEL");
  assert.equal(a.run("handlePaypalReturn()"),true);
  assert.match(a.elements.get("topBanner").textContent,/Checkout cancelled — no charge was made and your plan is unchanged/);
  assert.equal(a.run("currentPlan"),"free");
});
test("N7: Admin compares use the run count, not floor(rows/2)",async()=>{
  const a=app();
  a.run('fillAdminHealth=async()=>{}; fillAdminPay=async()=>{}; fillAdminUsers=async()=>{};');
  a.run('currentUser={id:"owner",email:"syedsinterprises@gmail.com"}; currentPlan="free";');
  a.run('LS.set("toolChecks",[{date:todayISO(),type:"compare",url:"a vs b"}]);');
  a.run("renderAdminSection()");
  await a.run("renderAdmin()");
  assert.match(a.run("adminPanelEl.innerHTML"),/Competitor compares: <b>1<\/b>/);
});
test("N12: guest work is explained on first sign-in, once, never auto-uploaded",async()=>{
  const a=app();
  a.run('LS.set("audits",[{date:todayISO(),url:"https://example.com"}]);');
  await a.run('afterSignIn({id:"u1",email:"a@example.com"})');
  assert.match(a.elements.get("topBanner").textContent,/Your guest work stays in this browser/);
  assert.match(a.elements.get("topBanner").textContent,/export it from Workspace settings/);
  assert.equal(a.run('S.cache.audits.length'),0);
  a.elements.get("topBanner").textContent="";
  await a.run('afterSignIn({id:"u1",email:"a@example.com"})');
  assert.equal(a.elements.get("topBanner").textContent,"");
});
test("N13/F12: showTab keeps &url= on the Health tab, strips it elsewhere",()=>{
  const a=app();
  let seen="";
  a.context.history={pushState:(s,t,u)=>{seen=u;},replaceState:(s,t,u)=>{seen=u;}};
  a.context.location.hash="#tab=health&url=https%3A%2F%2Fexample.com";
  a.run('showTab("health", true)');
  assert.match(seen,/#tab=health&url=https%3A%2F%2Fexample.com/);
  /* F12: on a non-health tab &url= is a dead share link — strip it. */
  a.context.location.hash="#tab=health&url=https%3A%2F%2Fexample.com";
  a.run('showTab("dashboard", true)');
  assert.equal(seen,"#tab=dashboard");
  assert.doesNotMatch(seen,/url=/);
});
test("N14: Site Audit stops at the 120 s deadline with partial results",async()=>{
  const a=app();
  auditSetup(a,10);
  a.run('fetchViaProxy=async(u)=> u.includes("sitemap") ? {status:200,ok:true,text:__sitemapXml} : {status:200,ok:true};');
  /* Fake clock: the first two Date.now() calls are the audit start, every
     later call is 121 s on — so the second batch never starts. */
  a.run('__t0=Date.now(); __calls=0; Date=class extends Date{ static now(){ __calls++; return __calls<=2 ? __t0 : __t0+121000; } };');
  await a.run("runAudit(false)");
  const out=a.elements.get("auditOut").innerHTML;
  assert.match(out,/Stopped after 120 s — 5 of 10 URLs checked/);
  assert.match(out,/Sitemap crawl — 5 URLs/);
  assert.match(out,/5 reachable/);
});
test("N14: Site Audit Cancel stops the crawl with partial results",async()=>{
  const a=app();
  auditSetup(a,10);
  a.run('__resolvers=[]; fetchViaProxy=async(u)=> u.includes("sitemap") ? {status:200,ok:true,text:__sitemapXml} : new Promise(r=>__resolvers.push(r));');
  const done=a.run("runAudit(false)");
  await new Promise(r=>setTimeout(r,25));
  a.run("auditCancelled=true;");
  a.run("__resolvers.forEach(r=>r({status:200,ok:true}));");
  await done;
  const out=a.elements.get("auditOut").innerHTML;
  assert.match(out,/Audit cancelled — 5 of 10 URLs checked/);
  assert.match(out,/Sitemap crawl — 5 URLs/);
});
test("N16: a full localStorage keeps the audit result and warns instead",async()=>{
  const a=app();
  auditSetup(a,1);
  a.run('fetchViaProxy=async(u)=> u.includes("sitemap") ? {status:200,ok:true,text:__sitemapXml} : {status:200,ok:true,text:"<html><head><title>t</title></head><body>hi</body></html>"};');
  a.run('runPSI=async()=>({score:80,lcp:"1.0 s",cls:"0",seo:[],finalUrl:"https://example.com"});');
  a.run('__origSet=LS.set; LS.set=(k,v)=>{ if(k==="audits") throw new Error("storage full"); return __origSet.call(LS,k,v); };');
  await a.run("runAudit(false)");
  const out=a.elements.get("auditOut").innerHTML;
  assert.match(out,/PageSpeed Insights/);
  assert.match(out,/This audit ran, but saving it failed/);
  assert.doesNotMatch(out,/Check failed/);
});
test("N17: featured badge and sort vanish on a plan downgrade",()=>{
  const a=app();
  a.run('currentPlan="agency"; toggleFeaturedListing("custom-1");');
  a.run('LS.set("listings",[{id:"custom-1",site:"https://example.com",niche:"Test",price:10,da:"",dr:"",title:"Example",desc:"d"}]);');
  a.run("renderMarket()");
  assert.match(a.elements.get("mktList").innerHTML,/Featured/);
  assert.equal(a.run('featuredFirst([{id:"custom-2"},{id:"custom-1"}])[0].id'),"custom-1");
  a.run('currentPlan="pro"; renderMarket();');
  assert.doesNotMatch(a.elements.get("mktList").innerHTML,/Featured/);
  assert.equal(a.run('featuredFirst([{id:"custom-2"},{id:"custom-1"}])[0].id'),"custom-2");
});
test("N18: seed listings can never be force-featured via stored ids",()=>{
  const a=app();
  a.run('currentPlan="agency";');
  assert.equal(a.run('toggleFeaturedListing("seed-1")'),false);
  assert.equal(a.run('toggleFeaturedListing("custom-9")'),true);
  a.run('LS.set("featuredListings",["seed-1","custom-9"]);');
  assert.equal(a.run('featuredFirst([{id:"seed-1"},{id:"custom-9"},{id:"custom-2"}])[0].id'),"custom-9");
  /* Even with only a seed id stored, it never sorts first. */
  a.run('LS.set("featuredListings",["seed-1"]);');
  assert.equal(a.run('featuredFirst([{id:"custom-2"},{id:"seed-1"}])[0].id'),"custom-2");
});
test("N19: default site is only the fallback when My-sites is empty",()=>{
  const a=app();
  a.run('LS.set("preferences",{defaultSite:"https://default.example"}); LS.set("sites",[]);');
  assert.equal(a.run("selectedSite()"),"https://default.example");
  a.run('currentPlan="agency"; LS.set("sites",["https://a.example","https://b.example"]); LS.set("selectedSite","https://b.example");');
  assert.equal(a.run("selectedSite()"),"https://b.example");
  /* applyPreferences must not overwrite what applySelectedSite filled. */
  a.run('applyPreferences(SEOForgeCore.validatePreferences(LS.get("preferences",{})))');
  assert.equal(a.elements.get("auditUrl").value,"https://b.example");
  assert.doesNotMatch(code,/el\.value=p\.defaultSite/);
});
test("N19: the last-run audit URL still beats the default site on reload",()=>{
  const a=app();
  a.run('LS.set("preferences",{defaultSite:"https://example.com"}); LS.set("lastAuditUrl","https://example.org"); LS.set("sites",[]);');
  a.run('applyPreferences(SEOForgeCore.validatePreferences(LS.get("preferences",{})))');
  assert.equal(a.elements.get("auditUrl").value,"https://example.org");
  /* …while the other tool inputs still take the default site. */
  assert.equal(a.elements.get("serpUrl").value,"https://example.com");
});
test("B1: no alert() or confirm() calls remain in the app",()=>{
  assert.doesNotMatch(code,/alert\(/);
  assert.doesNotMatch(code,/confirm\(/);
});
test("B2: loading indicators on rank/ads/market saves and the GSC status check",()=>{
  assert.match(code,/btn\.textContent = "Saving…"/);
  assert.match(code,/btn\.textContent = "Logging…"/);
  assert.match(code,/btn\.textContent = "Adding…"/);
  assert.match(code,/b\.textContent = "Deleting…"/);
  assert.match(code,/Checking Google connection…/);
});
test("B3: a child sitemap that 404s is never parsed as a sitemap",async()=>{
  const a=app();
  auditSetup(a,0);
  a.run('fetchViaProxy=async(u)=> u.includes("child.xml") ? {status:404,ok:false,text:""} : {status:200,ok:true,text:"<sitemapindex><sitemap><loc>https://example.com/child.xml</loc></sitemap></sitemapindex>"};');
  await a.run("runAudit(false)");
  assert.match(a.elements.get("auditOut").innerHTML,/Child sitemap fetch failed \(HTTP 404\)/);
});
test("B3: a child sitemap that returns an error page is rejected, not parsed",async()=>{
  const a=app();
  auditSetup(a,0);
  a.run('fetchViaProxy=async(u)=> u.includes("child.xml") ? {status:200,ok:true,text:"<html><body>Sorry, this page is unavailable</body></html>"} : {status:200,ok:true,text:"<sitemapindex><sitemap><loc>https://example.com/child.xml</loc></sitemap></sitemapindex>"};');
  await a.run("runAudit(false)");
  assert.match(a.elements.get("auditOut").innerHTML,/did not return a valid sitemap/);
});
test("B3: SERP and Suggest refuse non-2xx bodies instead of parsing them",async()=>{
  const a=app();
  a.run('fetchViaProxy=async()=>({status:403,ok:false,text:"blocked"});');
  await assert.rejects(a.run('serpTopResults("seo tools", 5)'),/HTTP 403/);
  await assert.rejects(a.run('suggestOne("seo tools")'),/HTTP 403/);
});
test("D4/D5: no-image pages score Images N/A and rescale, never full marks",()=>{
  const a=app();
  const noImg=a.run('SEOForgeCore.scoreSpeedMetrics({ttfbMs:100,bytes:1000,textBytes:1000,blocking:0,compressed:true,encoding:"",cache:"",imgs:0,sized:0,raster:0,modern:0,resources:1})');
  const noImgRow=noImg.rows.find(r=>r.name==="Images");
  assert.equal(noImgRow.na,true);
  assert.equal(noImgRow.pts,null);
  assert.match(noImgRow.detail,/not applicable/);
  assert.equal(noImg.score,92); /* 78 earned over 85 applicable points */
  const vec=a.run('SEOForgeCore.scoreSpeedMetrics({ttfbMs:100,bytes:1000,textBytes:1000,blocking:0,compressed:true,encoding:"",cache:"",imgs:2,sized:2,raster:0,modern:0,resources:1})');
  const vecRow=vec.rows.find(r=>r.name==="Images");
  assert.equal(vecRow.pts,7); /* dimensions only — the format half is N/A */
  assert.equal(vecRow.max,7);
  assert.match(vecRow.detail,/not applicable/);
  assert.equal(vec.score,92); /* 85 earned over 92 applicable points */
  /* The N/A row renders as "N/A", never "null / 15". */
  assert.match(a.run('speedScoreHtml('+JSON.stringify(noImg)+')'),/N\/A/);
  assert.doesNotMatch(a.run('speedScoreHtml('+JSON.stringify(noImg)+')'),/null \/ 15/);
});
test("N15: disconnecting Google arms an inline confirm row, never a modal",async()=>{
  const a=app();
  let called=false;
  a.run('googleApi=async()=>{__googleCalled=true; return {};};');
  await a.run("disconnectGoogle()");
  assert.match(a.elements.get("gscDisconnectConfirm").innerHTML,/Disconnect Google\?/);
  assert.match(a.elements.get("gscDisconnectConfirm").innerHTML,/Yes, disconnect/);
  assert.match(a.elements.get("gscDisconnectConfirm").innerHTML,/Keep connected/);
  assert.equal(a.context.__googleCalled,undefined);
  await a.run("doDisconnectGoogle()");
  assert.equal(a.context.__googleCalled,true);
  assert.match(a.elements.get("topBanner").textContent,/Google disconnected/);
});

/* ------------------------------------------------------------------ */
/* Round-4 fix tests (F2/F3/F4/F5/F6/F7/F8/F9/F15/R2/R3)               */
/* ------------------------------------------------------------------ */

test("F2: a plan downgrade never deletes stored sites on save",()=>{
  const a=app();
  const sites=Array.from({length:50},(_,i)=>"https://site"+(i+1)+".example");
  a.run('currentPlan="business";');
  a.run('LS.set("sites",'+JSON.stringify(sites)+');');
  a.run("loadSiteSlots()");
  assert.equal(a.run("activeSites().length"),50);
  a.run('currentPlan="agency"; loadSiteSlots();');
  assert.equal(a.run("activeSites().length"),10);
  assert.equal((a.elements.get("siteKeptList").innerHTML.match(/data-remove-kept/g)||[]).length,40);
  a.elements.get("siteSaveBtn").listeners.click();
  assert.deepEqual(a.run('LS.get("sites", [])'),sites);
  assert.match(a.elements.get("siteSaved").textContent,/40 extra kept/);
  /* Kept-list Remove deletes exactly one site, and only a kept one. */
  a.run('removeKeptSite(0);');
  assert.equal(a.run('LS.get("sites", []).length'),49);
  assert.equal(a.run('LS.get("sites", [])[0]'),"https://site1.example");
  assert.equal(a.run('LS.get("sites", [])[9]'),"https://site10.example");
  assert.equal(a.run('LS.get("sites", [])[10]'),"https://site12.example");
});

test("F6: Save my sites keeps the selected site when it is still in the list",()=>{
  const a=app();
  a.run('currentPlan="agency";');
  a.run('LS.set("sites",["https://a.example","https://b.example","https://c.example"]); LS.set("selectedSite","https://b.example");');
  a.run("loadSiteSlots()");
  a.elements.get("siteSaveBtn").listeners.click();
  assert.equal(a.run('LS.get("selectedSite", "")'),"https://b.example");
  /* Selected site removed from the list -> falls back to the first site. */
  a.run('LS.set("sites",["https://a.example","https://c.example"]); LS.set("selectedSite","https://b.example"); loadSiteSlots();');
  a.elements.get("siteSaveBtn").listeners.click();
  assert.equal(a.run('LS.get("selectedSite", "")'),"https://a.example");
});

test("F5: a double click on Health Check saves one audit row, not two",async()=>{
  const a=app();
  a.run('fetchPageDoc=async()=>({doc:{querySelector:()=>null,querySelectorAll:()=>[]},status:200,text:"<html></html>",ttfbMs:100,totalMs:100,bytes:100,compressed:true,headers:{encoding:"",cache:""}});');
  a.run('runPSI=async()=>({score:80,lcp:"1.0 s",cls:"0",seo:[],finalUrl:"https://example.com"});');
  a.elements.get("hcUrl").value="https://example.com";
  const p1=a.run("runHealth()");
  const p2=a.run("runHealth()");
  await p1; await p2;
  assert.equal(a.run('LS.get("audits", []).length'),1);
  assert.equal(a.elements.get("hcBtn").disabled,false);
});

test("F7: Health Check keeps its result when the save fails, with a warning",async()=>{
  const a=app();
  a.run('fetchPageDoc=async()=>({doc:{querySelector:()=>null,querySelectorAll:()=>[]},status:200,text:"<html></html>",ttfbMs:100,totalMs:100,bytes:100,compressed:true,headers:{encoding:"",cache:""}});');
  a.run('runPSI=async()=>({score:80,lcp:"1.0 s",cls:"0",seo:[],finalUrl:"https://example.com"});');
  a.run('currentUser={id:"u1",email:"a@example.com"}; S.mode="cloud"; cloudInsertAudit=async()=>{ throw new Error("insert failed"); };');
  a.elements.get("hcUrl").value="https://example.com";
  await a.run("runHealth()");
  const out=a.elements.get("hcOut").innerHTML;
  assert.match(out,/Mobile performance score 80\/100/);
  assert.match(out,/saving it failed/);
  assert.doesNotMatch(out,/Health check failed/);
});

test("F7: Bulk Audit keeps a scored row when its save fails (never 'Not scored')",async()=>{
  const a=app();
  a.run('runPSI=async()=>({score:80,lcp:"1.0 s",cls:"0",seo:[],finalUrl:"https://example.com"});');
  a.run('currentUser={id:"u1",email:"a@example.com"}; S.mode="cloud"; cloudInsertAudit=async()=>{ throw new Error("insert failed"); };');
  a.elements.get("bkUrls").value="https://example.com";
  await a.run("runBulkAudit()");
  const out=a.elements.get("bkOut").innerHTML;
  assert.match(out,/80/);
  assert.match(out,/could not be saved/);
  assert.doesNotMatch(out,/Not scored/);
});

test("F9: Disconnect Google from Settings arms the confirm in Settings, not the hidden GSC tab",async()=>{
  const a=app();
  await a.run('disconnectGoogle("int")');
  assert.match(a.elements.get("intDisconnectConfirm").innerHTML,/Disconnect Google\?/);
  assert.equal(a.elements.get("gscDisconnectConfirm").innerHTML,"");
  await a.run('disconnectGoogle("gsc")');
  assert.match(a.elements.get("gscDisconnectConfirm").innerHTML,/Disconnect Google\?/);
  assert.equal(a.elements.get("intDisconnectConfirm").innerHTML,"");
});

test("R3: renderLimitNotes never lets the RPC compares value overwrite the client run-count",async()=>{
  const a=app();
  a.run('currentUser={id:"u1",email:"a@example.com"}; S.mode="cloud"; cloudDataLoaded=true;');
  a.run('S.cache.toolChecks=[{date:todayISO(),type:"compare",url:"a vs b"},{date:todayISO(),type:"compare",url:"c vs d"}];');
  a.run('sb={rpc:async()=>({data:{auditsUsed:0,linksUsed:0,briefsUsed:0,comparesUsed:0,toolChecksUsed:0,keywordsUsed:0},error:null})};');
  await a.run("renderLimitNotes()");
  await a.run("Promise.resolve()");
  assert.equal(a.run("v25Usage().comparesUsed"),2);
  assert.match(a.run("limitNoteText()"),/1 of 3 competitor compares left/);
});

test("F3/F4: Cancel aborts only the audit run's requests, never other tools'",async()=>{
  const a=app();
  let aborted=false;
  a.context.fetch=async(url,opts)=>{ const s=opts&&opts.signal; s.addEventListener("abort",()=>{aborted=true;}); return new Promise(()=>{}); };
  const scope=a.run("new Set()");
  a.context.__scope=scope;
  a.run("fetchTimeout('https://example.com/x', 60000, __scope)");
  assert.equal(a.run("__scope.size"),1);
  assert.equal(a.run("activeRequests.size"),0);
  a.run("auditRunScope=__scope; cancelAuditRequests();");
  assert.equal(aborted,true);
  assert.equal(a.run("__scope.size"),0);
  assert.equal(a.run("activeRequests.size"),0);
  /* A global (unscoped) request from another tool is untouched by the audit cancel. */
  aborted=false;
  a.run("fetchTimeout('https://example.com/y', 60000)");
  assert.equal(a.run("activeRequests.size"),1);
  a.run("cancelAuditRequests();");
  assert.equal(aborted,false);
  a.run("cancelPendingRequests();");
  assert.equal(aborted,true);
});

test("F8: a full localStorage on Add to tracker shows an inline error, not silence",async()=>{
  const a=app();
  a.context.localStorage.setItem=()=>{throw Error("QuotaExceeded");};
  a.elements.get("rkKw").value="seo tools";
  await a.elements.get("rkAddBtn").listeners.click();
  assert.match(a.elements.get("rkList").innerHTML,/Could not save that keyword/);
  assert.equal(a.elements.get("rkAddBtn").disabled,false);
  /* The same catch exists on the other two N5 buttons and the Explorer save. */
  assert.match(code,/prependNote\("revList", "err", "Could not log that revenue/);
  assert.match(code,/formErr\("mkErr", "Could not add that listing/);
  assert.match(code,/b\.textContent = "Save failed — retry"; b\.disabled = false;/);
});

test("F15: Redirects has one 60 s total cap covering walk + supplement + PageSpeed",()=>{
  assert.match(code,/const deadline = Date\.now\(\) \+ 60000;/);
  assert.match(code,/Math\.max\(1000, Math\.min\(12000, deadline - Date\.now\(\)\)\)/);
  assert.match(code,/if\(!finalUrl && Date\.now\(\) < deadline\)/);
  assert.match(code,/PageSpeed final-URL check skipped — the 60 s overall limit/);
  /* The two legs that used to blow the cap are now deadline-clamped: the
     fetchViaProxy fallback (skipped past the deadline, timeout clamped) and
     the PageSpeed leg (timeout threaded through runPSI/runPSIDirect). */
  assert.match(code,/fetchViaProxy\(start, Math\.max\(1000, Math\.min\(15000, deadline - Date\.now\(\)\)\)\)/);
  assert.match(code,/runPSI\(start, "mobile", undefined, Math\.max\(5000, deadline - Date\.now\(\)\)\)/);
  assert.match(code,/async function runPSI\(url, strategy, scope, timeoutMs\)/);
  assert.match(code,/async function runPSIDirect\(url, strategy, key, scope, timeoutMs\)/);
});

test("R2: the app re-themes on storage events, and a share URL runs at most once per page load",()=>{
  assert.match(code,/window\.addEventListener\("storage", \(e\) => \{[\s\S]*?if\(e\.key === LS\.key\("preferences"\)\)\{ try\{ loadPreferences\(\); \}catch\(err\)\{\} \}/);
  assert.match(code,/if\(!shareRuns\.has\(key\)\)\{ shareRuns\.add\(key\); runHealth\(\); \}/);
  assert.match(code,/shareRuns\.add\("health\|" \+ sharedUrl\); runHealth\(\);/);
});
