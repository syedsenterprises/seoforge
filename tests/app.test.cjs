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
    document:{getElementById:id=>{assert.ok(elements.has(id),"missing DOM element: "+id);return elements.get(id);},querySelectorAll:()=>[],addEventListener(){},createElement:()=>({click(){},remove(){},appendChild(){}}),documentElement:{dataset:{},style:{setProperty(){}}}},
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
  a.context.mockDb={from(table){calls.push(table);return{select(){return this;},eq(){return this;},order(){return this;},range(from,to){return Promise.resolve({data:from===0?Array.from({length:500},(_,i)=>({id:String(i)})):[{id:"last"}],error:null});}};}};
  a.run('currentUser={id:"alice"};sb=mockDb;');
  const data=await a.run("collectAccountExport()");
  assert.equal(data.audits.length,501);
  assert.ok(!calls.includes("google_tokens"));
  assert.ok(!calls.includes("profiles"));
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
  assert.equal(sf.score,66);
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

test("SEOForge Speed Score: compression that cannot be verified scores half, not zero",()=>{
  const a=app();
  const sf=a.run(`scoreSpeedMetrics({ttfbMs:null,bytes:null,textBytes:60000,blocking:2,compressed:null,encoding:"",cache:"max-age=3600",imgs:0,sized:0,raster:0,modern:0,resources:15})`);
  assert.equal(sf.score,62);
  assert.equal(sf.grade,"Needs work");
});

test("Forge Assistant keyless mode: answers data questions without a key",()=>{
  const a=app();
  a.run('LS.set("audits",[{url:"https://example.com",psi:87,ok:50,total:50}]); LS.set("keywords",[{keyword:"seo tools",url:"",checks:[]},{keyword:"ai directory",url:"",checks:[]}]); LS.set("rankChecks",[{id:"1"}]); LS.set("links",[{id:"1"},{id:"2"}]);');
  assert.match(a.run('agentLocalAnswer("what is my latest audit score?")'),/87\/100/);
  assert.match(a.run('agentLocalAnswer("what is my latest audit score?")'),/example\.com/);
  assert.match(a.run('agentLocalAnswer("how many keywords am I tracking?")'),/2 keywords/);
  assert.match(a.run('agentLocalAnswer("how many keywords am I tracking?")'),/seo tools/);
  assert.match(a.run('agentLocalAnswer("how many links have I verified?")'),/2 verified links/);
  assert.match(a.run('agentLocalAnswer("what is my plan?")'),/free plan/);
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
  const bing=bingHtml([["https://example.com/one","One"]]);
  const ddg='<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fddg.example.com%2Fpage">DDG Page</a>';
  a.context.__bing=bing; a.context.__ddg=ddg;
  a.run('fetchViaProxy=async(u)=> u.includes("bing.com") ? {text:__bing} : {text:__ddg};');
  const first=await a.run('serpTopResults("ai tools", 5)');
  assert.equal(first[0].url,"https://example.com/one");
  a.run('fetchViaProxy=async(u)=> u.includes("bing.com") ? {text:"<html>no results here</html>"} : {text:__ddg};');
  const second=await a.run('serpTopResults("ai tools", 5)');
  assert.equal(second[0].url,"https://ddg.example.com/page");
  a.run('fetchViaProxy=async()=>({text:"<html>nothing</html>"});');
  await assert.rejects(a.run('serpTopResults("ai tools", 5)'),/blocked|parsed/);
});
test("Briefs: the brief path runs through serpTopResults (Bing) and never shows a SERP title as page data",async()=>{
  const a=app();
  a.elements.set("brTxtBtn",a.elements.get("brBtn"));
  const bing=bingHtml([["https://example.com/one","One"],["https://example.com/two","Two"],["https://example.com/three","Three"],["https://example.com/four","Four"],["https://example.com/five","Five"]]);
  a.context.__bing=bing;
  a.run('fetchViaProxy=async()=>({text:__bing}); fetchPageDoc=async()=>{throw Error("blocked");}; suggestOne=async()=>[];');
  a.elements.get("brKw").value="ai tools";
  await a.run("runBrief()");
  const out=a.elements.get("brOut").innerHTML;
  assert.match(out,/could not read/);
  assert.doesNotMatch(out,/DuckDuckGo/);
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
test("Version: one source of truth, 2.10.0 everywhere",()=>{
  const a=app();
  assert.equal(a.run("APP_VERSION"),"2.10.0");
  assert.equal(JSON.parse(fs.readFileSync("package.json","utf8")).version,"2.10.0");
  assert.match(fs.readFileSync("supabase/functions/status/index.ts","utf8"),/version:"2\.10\.0"/);
  assert.match(html,/data-app-version/);
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
  assert.equal(a.run('JSON.stringify(normalizeSiteList(["https://a.com","a.com","https://b.com","https://c.com","https://d.com"]))'),'["https://a.com","https://b.com","https://c.com"]'); /* stringify: vm arrays fail strict deepEqual across realms */
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
