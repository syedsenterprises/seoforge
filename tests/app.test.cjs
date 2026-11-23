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
  assert.equal(a.elements.get("stLinks").textContent,45);
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
  /* Owner stays unlimited on every tier. */
  a.run('currentUser={id:"x",email:"syedsinterprises@gmail.com"}; currentPlan="free";');
  assert.equal(a.run("siteLimitForPlan()"),10);
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
/* ---------- v2.11.0: featured listings ---------- */
test("Featured listings: Agency/Admin only, featured sorts first",()=>{
  const a=app();
  assert.equal(a.run('toggleFeaturedListing("seed-1")'),false); /* free user */
  a.run('currentPlan="agency";');
  assert.equal(a.run('toggleFeaturedListing("seed-1")'),true);
  assert.equal(a.run('featuredFirst([{id:"seed-2"},{id:"seed-1"}])[0].id'),"seed-1");
  a.run('toggleFeaturedListing("seed-1")');
  assert.equal(a.run('featuredFirst([{id:"seed-2"},{id:"seed-1"}])[0].id'),"seed-2");
  /* Owner can feature without a plan. */
  a.run('currentUser={id:"x",email:"syedsinterprises@gmail.com"}; currentPlan="free";');
  assert.equal(a.run('toggleFeaturedListing("seed-2")'),true);
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
test("App presentation: every tab section has a page header, the guest action is a button, 10 site slots",()=>{
  assert.equal((html.match(/class="card page-head"/g)||[]).length,19);
  assert.match(html,/<button type="button" class="btn secondary" id="authGuestLink">Continue without an account<\/button>/);
  for(let i=1;i<=10;i++) assert.ok(html.includes('id="siteSlot'+i+'"'),"missing siteSlot"+i);
});
/* ---------- v2.11.0: landing redesign (item 14) ---------- */
test("Landing: the three paths are real buttons with the right destinations",()=>{
  assert.match(landing,/<a class="btn" href="\.\/app\.html#auth=signup">Create free account<\/a>/);
  assert.match(landing,/<a class="btn secondary" href="\.\/app\.html#auth=signin">Sign in<\/a>/);
  assert.match(landing,/<a class="btn-ghost" href="\.\/app\.html#guest">Continue without an account<\/a>/);
  assert.equal((landing.match(/href="\.\/app\.html#auth=signup"/g)||[]).length,14); /* primary CTA repeats after every section */
  assert.doesNotMatch(landing,/assets\/app\.js/); /* the landing never loads the app */
  assert.match(landing,/assets\/core\.js/); /* the hero widget needs the shared scoring module */
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
  assert.ok(landing.includes('./privacy.html'));
  assert.ok(landing.includes('./terms.html'));
});
