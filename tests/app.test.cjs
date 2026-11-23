
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const html=fs.readFileSync("index.html","utf8");
const code=fs.readFileSync("assets/app.js","utf8");
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
  await a.run('checkRank(0,{disabled:false,textContent:""})');
  assert.equal(a.run('LS.get("keywords",[])[0].checks.length'),0);
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
