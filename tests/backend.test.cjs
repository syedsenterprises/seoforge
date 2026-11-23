
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const source=file=>fs.readFileSync(file,"utf8").replace(/^import .*;\r?$/gm,"").replaceAll("export ","");
test("Billing entitlement requires matching plan and bound account",()=>{
  const plans={PAYPAL_PLAN_ID:"P-PRO-M",PAYPAL_PLAN_PRO_MONTHLY:"P-PRO-M",PAYPAL_PLAN_PRO_YEARLY:"P-PRO-Y",PAYPAL_PLAN_AGENCY_MONTHLY:"P-AG-M",PAYPAL_PLAN_AGENCY_YEARLY:"P-AG-Y"};
  const ctx=vm.createContext({env:(n)=>plans[n],optEnv:(n)=>plans[n]||""});
  vm.runInContext(source("supabase/functions/_shared/paypal.js"),ctx);
  /* Legacy single-plan-ID string still means Pro. */
  assert.equal(ctx.verifiedSubscription({plan_id:"p",custom_id:"u",status:"ACTIVE"},"p","u"),"pro");
  assert.equal(ctx.verifiedSubscription({plan_id:"p",custom_id:"u",status:"SUSPENDED"},"p","u"),"free");
  assert.throws(()=>ctx.verifiedSubscription({plan_id:"wrong",custom_id:"u",status:"ACTIVE"},"p","u"),/mismatch/);
  assert.throws(()=>ctx.verifiedSubscription({plan_id:"p",custom_id:"other",status:"ACTIVE"},"p","u"),/mismatch/);
  /* Plan map (v2.11.0): Pro and Agency plan IDs resolve to their tiers; an
     unconfigured plan ID never grants a paid plan; a pending subscription
     never grants a paid plan either. */
  /* deepEqual across vm realms fails on prototypes — compare key by key. */
  const map=ctx.planToTier();
  assert.equal(map["P-PRO-M"],"pro");
  assert.equal(map["P-PRO-Y"],"pro");
  assert.equal(map["P-AG-M"],"agency");
  assert.equal(map["P-AG-Y"],"agency");
  assert.equal(Object.keys(map).length,4);
  assert.equal(ctx.verifiedSubscription({plan_id:"P-AG-M",custom_id:"u",status:"ACTIVE"},map,"u"),"agency");
  assert.equal(ctx.verifiedSubscription({plan_id:"P-PRO-Y",custom_id:"u",status:"ACTIVE"},map,"u"),"pro");
  assert.equal(ctx.verifiedSubscription({plan_id:"P-AG-M",custom_id:"u",status:"APPROVAL_PENDING"},map,"u"),"free");
  assert.throws(()=>ctx.verifiedSubscription({plan_id:"P-UNKNOWN",custom_id:"u",status:"ACTIVE"},map,"u"),/mismatch/);
});
test("planToTier never throws on a missing plan secret (legacy-only and empty configs)",()=>{
  /* Legacy-only: only PAYPAL_PLAN_ID set — Pro monthly still maps, the other
     three are simply absent, and nothing throws. */
  const legacy={PAYPAL_PLAN_ID:"P-LEGACY"};
  const ctxLegacy=vm.createContext({env:(n)=>legacy[n],optEnv:(n)=>legacy[n]||""});
  vm.runInContext(source("supabase/functions/_shared/paypal.js"),ctxLegacy);
  const legacyMap=ctxLegacy.planToTier();
  assert.equal(legacyMap["P-LEGACY"],"pro");
  assert.equal(Object.keys(legacyMap).length,1);
  /* Empty: no plan secrets at all — empty map, no throw. */
  const ctxEmpty=vm.createContext({env:(n)=>undefined,optEnv:()=>""});
  vm.runInContext(source("supabase/functions/_shared/paypal.js"),ctxEmpty);
  assert.equal(Object.keys(ctxEmpty.planToTier()).length,0);
});
test("Status billing readiness accepts a legacy-only plan config",async()=>{
  const runStatus=async(envMap)=>{
    let handler;
    const ctx=vm.createContext({Deno:{env:{get:n=>envMap[n]},serve:fn=>{handler=fn;}},Response,JSON});
    vm.runInContext(source("supabase/functions/_shared/http.js"),ctx);
    vm.runInContext(source("supabase/functions/status/index.ts"),ctx);
    const res=await handler(new Request("https://db.example/functions/status",{method:"GET",headers:{origin:"https://example.com"}}));
    return res.json();
  };
  const base={APP_ORIGINS:"https://example.com",GOOGLE_CLIENT_SECRET:"s",BILLING_ENABLED:"true",PAYPAL_CLIENT_ID:"id",PAYPAL_CLIENT_SECRET:"sec",PAYPAL_WEBHOOK_ID:"wh",PAYPAL_MODE:"live"};
  /* Legacy-only plan var: billing ready. */
  assert.equal((await runStatus({...base,PAYPAL_PLAN_ID:"P-LEGACY"})).billing,true);
  /* New four-var config, no legacy var: billing ready. */
  assert.equal((await runStatus({...base,PAYPAL_PLAN_PRO_MONTHLY:"P-PRO-M"})).billing,true);
  /* No plan var at all: billing NOT ready, while the rest still reports. */
  const none=await runStatus(base);
  assert.equal(none.billing,false);
  assert.equal(none.google,true);
});
test("Google endpoint fails closed without authentication",async()=>{
  let handler;
  const ctx=vm.createContext({Deno:{env:{get:n=>({APP_ORIGINS:"https://example.com",SUPABASE_URL:"https://db.example",SUPABASE_SERVICE_ROLE_KEY:"test"})[n]},serve:fn=>{handler=fn;}},Response,JSON,AbortSignal});
  vm.runInContext(source("supabase/functions/_shared/http.js"),ctx);
  vm.runInContext(source("supabase/functions/google-oauth/index.ts"),ctx);
  const res=await handler(new Request("https://db.example/functions/google-oauth",{method:"POST",headers:{origin:"https://example.com"},body:'{"action":"status"}'}));
  assert.equal(res.status,401);
  assert.equal((await res.json()).error,"Authentication required");
});
test("Webhook rejects unsigned events before any provider or database calls",async()=>{
  let handler;
  const ctx=vm.createContext({Deno:{env:{get:n=>n==="APP_ORIGINS"?"https://example.com":undefined},serve:fn=>handler=fn},Response,JSON,AbortSignal});
  vm.runInContext(source("supabase/functions/_shared/http.js"),ctx);
  vm.runInContext(source("supabase/functions/paypal-webhook/index.ts"),ctx);
  const res=await handler(new Request("https://db.example/webhook",{method:"POST",body:'{"event_type":"BILLING.SUBSCRIPTION.ACTIVATED","resource":{"id":"I-FAKE"}}'}));
  assert.equal(res.status,400);
  assert.match((await res.json()).error,/signature/);
});
test("Email endpoint cannot be used to send arbitrary mail",async()=>{
  let handler;
  const ctx=vm.createContext({Deno:{env:{get:n=>n==="APP_ORIGINS"?"https://example.com":undefined},serve:fn=>handler=fn},Response,JSON,AbortSignal});
  vm.runInContext(source("supabase/functions/_shared/http.js"),ctx);
  vm.runInContext(source("supabase/functions/send-alert/index.ts"),ctx);
  const res=await handler(new Request("https://db.example/send-alert",{method:"POST",body:'{"to":"victim@example.com","html":"spam"}'}));
  assert.equal(res.status,401);
});

test("New Supabase secret keys do not inherit legacy bearer headers",async()=>{
  let headers;
  const ctx=vm.createContext({Deno:{env:{get:n=>({SUPABASE_URL:"https://db.example",SUPABASE_SECRET_KEYS:'{"default":"sb_secret_test"}',SUPABASE_SERVICE_ROLE_KEY:"legacy"})[n]}},AbortSignal,fetch:async(url,options)=>{headers=options.headers;return{ok:true,json:async()=>[]};}});
  vm.runInContext(source("supabase/functions/_shared/http.js"),ctx);
  await ctx.db("profiles");
  assert.equal(headers.apikey,"sb_secret_test");
  assert.equal(headers.Authorization,undefined);
});

test("Admin stats: owner JWT gets counts, non-owner gets 403, missing JWT gets 401",async()=>{
  const fetchMock=async(url,options)=>{
    const auth=(options&&options.headers&&options.headers.Authorization)||"";
    if(String(url).includes("/auth/v1/user")){
      if(auth==="Bearer owner-token") return {ok:true,json:async()=>({id:"owner-id",email:"syedsinterprises@gmail.com"})};
      if(auth==="Bearer other-token") return {ok:true,json:async()=>({id:"other-id",email:"someone@example.com"})};
      return {ok:false,status:401,json:async()=>({})};
    }
    if(String(url).includes("/rest/v1/profiles")){
      const total=String(url).includes("plan=eq.pro")?"0-0/3":String(url).includes("plan=eq.agency")?"0-0/2":String(url).includes("plan=eq.business")?"0-0/1":String(url).includes("created_at=gte")?"0-0/5":"0-0/42";
      return {ok:true,headers:{get:n=>n.toLowerCase()==="content-range"?total:null}};
    }
    if(String(url).includes("/rest/v1/audits")) return {ok:true,headers:{get:n=>n.toLowerCase()==="content-range"?"0-0/17":null}};
    if(String(url).includes("/rest/v1/billing_subscriptions")){
      if(String(url).includes("status=eq.ACTIVE")) return {ok:true,headers:{get:n=>n.toLowerCase()==="content-range"?"0-0/4":null}};
      return {ok:true,json:async()=>([{subscription_id:"I-ABC",status:"ACTIVE"}])};
    }
    throw Error("unexpected fetch "+url);
  };
  let handler;
  const ctx=vm.createContext({Deno:{env:{get:n=>({APP_ORIGINS:"https://example.com",SUPABASE_URL:"https://db.example",SUPABASE_SERVICE_ROLE_KEY:"test-service-key",PAYPAL_PLAN_ID:"P-TEST"})[n]},serve:fn=>{handler=fn;}},Response,JSON,AbortSignal,fetch:fetchMock,URL,Date});
  vm.runInContext(source("supabase/functions/_shared/http.js"),ctx);
  vm.runInContext(source("supabase/functions/admin-stats/index.ts"),ctx);
  const req=(token)=>new Request("https://db.example/functions/admin-stats",{method:"POST",headers:{origin:"https://example.com",...(token?{authorization:"Bearer "+token}:{})},body:"{}"});
  const owner=await handler(req("owner-token"));
  assert.equal(owner.status,200);
  const data=await owner.json();
  assert.equal(data.totalUsers,42);
  assert.equal(data.proUsers,3);
  assert.equal(data.agencyUsers,2);
  assert.equal(data.businessUsers,1);
  assert.equal(data.payingUsers,4); /* ACTIVE billing_subscriptions only */
  assert.equal(data.signups7d,5);
  assert.equal(data.auditsThisMonth,17);
  assert.equal(data.paypalPlanId,"P-TEST");
  assert.equal(data.subscription.status,"ACTIVE");
  assert.equal(data.subscription.id,"I-ABC");
  const other=await handler(req("other-token"));
  assert.equal(other.status,403);
  const anon=await handler(req(null));
  assert.equal(anon.status,401);
});

test("Admin stats: owner call works with the platform sb_secret_ key (no Bearer to PostgREST)",async()=>{
  /* Regression (live 23 Nov 2026): the owner call returned 400 although the
     JWT authenticated fine. Cause: countRows() sent "Authorization: Bearer
     sb_secret_…" to PostgREST, and a new-style secret key is not a JWT, so
     every count 401'd. The fix sends the secret as apikey only. This test
     reproduces the live shape — 1 free user, 0 paid — with ONLY the
     platform-provided SUPABASE_SECRET_KEYS set (no legacy service-role key)
     and asserts no /rest/v1/ request carries an Authorization header. */
  const restAuth=[];
  const fetchMock=async(url,options)=>{
    const auth=(options&&options.headers&&options.headers.Authorization)||"";
    if(String(url).includes("/auth/v1/user")){
      if(auth==="Bearer owner-token") return {ok:true,json:async()=>({id:"owner-id",email:"syedsinterprises@gmail.com"})};
      return {ok:false,status:401,json:async()=>({})};
    }
    if(String(url).includes("/rest/v1/")){
      restAuth.push(auth);
      assert.equal((options.headers||{}).apikey,"sb_secret_test","secret key must travel as apikey");
      const u=String(url);
      const total=u.includes("plan=eq.pro")||u.includes("plan=eq.agency")||u.includes("plan=eq.business")?"0-0/0":u.includes("created_at=gte")?"0-0/0":u.includes("/audits")?"0-0/0":u.includes("status=eq.ACTIVE")?"0-0/0":"0-0/1";
      if(u.includes("billing_subscriptions") && !u.includes("status=eq")) return {ok:true,json:async()=>([])};
      return {ok:true,headers:{get:n=>n.toLowerCase()==="content-range"?total:null}};
    }
    throw Error("unexpected fetch "+url);
  };
  let handler;
  const ctx=vm.createContext({Deno:{env:{get:n=>({APP_ORIGINS:"https://example.com",SUPABASE_URL:"https://db.example",SUPABASE_SECRET_KEYS:'{"default":"sb_secret_test"}'})[n]},serve:fn=>{handler=fn;}},Response,JSON,AbortSignal,fetch:fetchMock,URL,Date});
  vm.runInContext(source("supabase/functions/_shared/http.js"),ctx);
  vm.runInContext(source("supabase/functions/admin-stats/index.ts"),ctx);
  const res=await handler(new Request("https://db.example/functions/admin-stats",{method:"POST",headers:{origin:"https://example.com",authorization:"Bearer owner-token"},body:"{}"}));
  assert.equal(res.status,200);
  const data=await res.json();
  assert.equal(data.totalUsers,1);
  assert.equal(data.proUsers,0);
  assert.equal(data.agencyUsers,0);
  assert.equal(data.businessUsers,0);
  assert.equal(data.payingUsers,0);
  assert.equal(data.signups7d,0);
  assert.equal(data.auditsThisMonth,0);
  assert.equal(data.subscription,null);
  assert.ok(restAuth.length>0,"the counts must actually hit PostgREST");
  assert.ok(restAuth.every(a=>!a),"no PostgREST call may carry an Authorization header, got "+JSON.stringify(restAuth));
});

/* ---------- v2.11.0 round 3: fetch-proxy / ai-agent SSRF + redirect fixes ---------- */
function proxyCtx(fetchMock){
  let handler;
  const ctx=vm.createContext({Deno:{env:{get:n=>({APP_ORIGINS:"https://example.com"})[n]},serve:fn=>{handler=fn;}},Response,JSON,AbortSignal,fetch:fetchMock,URL,TextDecoder,performance});
  vm.runInContext(source("supabase/functions/_shared/http.js"),ctx);
  vm.runInContext(source("supabase/functions/fetch-proxy/index.ts"),ctx);
  return handler;
}
function proxyResp(status, text, location){
  const bytes=new TextEncoder().encode(text||"");
  return {status, ok:status>=200&&status<300, headers:{get:n=> n.toLowerCase()==="location" ? (location||null) : null}, arrayBuffer:async()=>bytes.buffer,
    /* F10: the proxy now streams through res.body — the harness response
       carries a real reader so the streaming cap is exercised, not skipped. */
    body:{getReader:()=>{ let sent=false; return {read:async()=>{ if(sent) return {done:true,value:undefined}; sent=true; return {done:false,value:bytes}; }, cancel:async()=>{ sent=true; }}; }}};
}
const proxyReq=(url)=>new Request("https://db.example/functions/fetch-proxy",{method:"POST",headers:{origin:"https://example.com"},body:JSON.stringify({url})});
test("N2: fetch-proxy no longer blocks public fc*/fd* hostnames",async()=>{
  const handler=proxyCtx(async()=>proxyResp(200,"<html>ok</html>"));
  for(const u of ["https://fda.gov/","https://fcc.gov/","https://fc2.com/","https://fcm.googleapis.com/"]){
    const res=await handler(proxyReq(u));
    assert.equal(res.status,200,u);
    assert.match(await res.text(),/ok/);
  }
});
test("N2: fetch-proxy still blocks IPv6 ULA/link-local and IPv4-mapped private hosts",async()=>{
  const handler=proxyCtx(async()=>proxyResp(200,"<html>ok</html>"));
  for(const u of ["http://[fc00::1]/","http://[fd00::1]/","http://[fe80::1]/","http://[::1]/","http://[::ffff:127.0.0.1]/","http://[::ffff:10.0.0.1]/"]){
    const res=await handler(proxyReq(u));
    assert.equal(res.status,400,u);
    assert.match((await res.json()).error,/Private addresses/);
  }
  /* A mapped PUBLIC address is not private. */
  const ok=await handler(proxyReq("http://[::ffff:8.8.8.8]/"));
  assert.equal(ok.status,200);
});
test("N3: fetch-proxy re-validates every redirect hop (SSRF)",async()=>{
  const handler=proxyCtx(async(url)=>{
    if(String(url).includes("public.example/r")) return proxyResp(302,"", "http://169.254.169.254/latest/meta-data/");
    if(String(url).includes("ftp-hop.example")) return proxyResp(302,"", "ftp://example.com/x");
    return proxyResp(200,"<html>ok</html>");
  });
  const meta=await handler(proxyReq("https://public.example/r"));
  assert.equal(meta.status,400);
  assert.match((await meta.json()).error,/Private addresses/);
  const ftp=await handler(proxyReq("https://ftp-hop.example/"));
  assert.equal(ftp.status,400);
  assert.match((await ftp.json()).error,/non-http/);
});
test("N3/N20: fetch-proxy follows a good redirect and stops a loop with a redirect error",async()=>{
  let hops=0;
  const handler=proxyCtx(async(url)=>{
    if(String(url).includes("start.example")) return proxyResp(302,"", "https://ok.example/page");
    if(String(url).includes("loop.example")){ hops++; return proxyResp(302,"", "https://loop.example/"); }
    return proxyResp(200,"<html>final</html>");
  });
  const good=await handler(proxyReq("https://start.example/"));
  assert.equal(good.status,200);
  assert.match(await good.text(),/final/);
  const loop=await handler(proxyReq("https://loop.example/"));
  assert.equal(loop.status,400);
  assert.match((await loop.json()).error,/Too many redirects — the URL redirects in a loop/);
  assert.ok(hops<=11);
});
function agentCtx(fetchMock){
  let handler;
  const ctx=vm.createContext({Deno:{env:{get:n=>({APP_ORIGINS:"https://example.com"})[n]},serve:fn=>{handler=fn;}},Response,JSON,AbortSignal,fetch:fetchMock,URL});
  vm.runInContext(source("supabase/functions/_shared/http.js"),ctx);
  vm.runInContext(source("supabase/functions/ai-agent/index.ts"),ctx);
  return handler;
}
const agentReq=(baseUrl)=>new Request("https://db.example/functions/ai-agent",{method:"POST",headers:{origin:"https://example.com"},body:JSON.stringify({apiKey:"k",baseUrl,model:"m",messages:[{role:"user",content:"hi"}]})});
test("N2/N3: ai-agent allows a public provider host, blocks private and redirected-private targets",async()=>{
  const okFetch=async()=>({status:200,ok:true,headers:{get:()=>null},json:async()=>({choices:[{message:{content:"hello"}}]})});
  const handler=agentCtx(okFetch);
  const ok=await handler(agentReq("https://fda.gov"));
  assert.equal(ok.status,200);
  assert.equal((await ok.json()).reply,"hello");
  const blocked=await handler(agentReq("http://[fc00::1]"));
  assert.equal(blocked.status,400);
  assert.match((await blocked.json()).error,/Private addresses/);
  const redir=agentCtx(async(url)=>{
    if(String(url).includes("provider.example")) return {status:307,ok:false,headers:{get:n=>n.toLowerCase()==="location"?"http://127.0.0.1/x":null},json:async()=>({})};
    return {status:200,ok:true,headers:{get:()=>null},json:async()=>({choices:[{message:{content:"hi"}}]})};
  });
  const r2=await redir(agentReq("https://provider.example/v1"));
  assert.equal(r2.status,400);
  assert.match((await r2.json()).error,/Private addresses/);
});
test("F10: fetch-proxy streams with a real 2 MB cap (never buffers the whole body)",async()=>{
  /* A 5 MB body in 500 KB chunks: a post-hoc slice would read all 5 MB
     before cutting it down. The streaming reader must stop at the cap. */
  let delivered=0;
  const big=async()=>{
    const chunk=new TextEncoder().encode("x".repeat(500000));
    let n=0;
    return {status:200, ok:true, headers:{get:()=>null}, body:{getReader:()=>({read:async()=>{ if(n>=10) return {done:true,value:undefined}; n++; delivered+=chunk.byteLength; return {done:false,value:chunk}; }, cancel:async()=>{}})}};
  };
  const handler=proxyCtx(big);
  const res=await handler(proxyReq("https://example.com/big"));
  assert.equal(res.status,200);
  const data=await res.json();
  assert.equal(data.bytes,2000000);
  assert.equal(data.text.length,2000000);
  assert.equal(data.truncated,true);
  assert.ok(delivered<=2500000,"streaming must stop near the cap, delivered "+delivered+" of 5000000");
});
test("F11: ai-agent never sends the key to a cross-host redirect target",async()=>{
  const seen=[];
  const handler=agentCtx(async(url)=>{
    seen.push(String(url));
    if(String(url).includes("provider.example")) return {status:307,ok:false,headers:{get:n=>n.toLowerCase()==="location"?"https://evil.example/steal":null},json:async()=>({})};
    return {status:200,ok:true,headers:{get:()=>null},json:async()=>({choices:[{message:{content:"hi"}}]})};
  });
  const res=await handler(agentReq("https://provider.example/v1"));
  assert.equal(res.status,400);
  assert.match((await res.json()).error,/different host/);
  assert.ok(!seen.some(u=>u.includes("evil.example")),"the key must never be sent to the redirect target");
  /* Same-host redirect still works, and the key stays on that host. */
  const sentAuth=[];
  const okHandler=agentCtx(async(url,opts)=>{
    sentAuth.push((opts&&opts.headers&&opts.headers.Authorization)||"");
    if(String(url).includes("retry=1")) return {status:200,ok:true,headers:{get:()=>null},json:async()=>({choices:[{message:{content:"same-host ok"}}]})};
    return {status:307,ok:false,headers:{get:n=>n.toLowerCase()==="location"?"https://provider.example/v1/chat/completions?retry=1":null},json:async()=>({})};
  });
  const ok=await okHandler(agentReq("https://provider.example/v1"));
  assert.equal(ok.status,200);
  assert.equal((await ok.json()).reply,"same-host ok");
  assert.ok(sentAuth.every(h=>h==="Bearer k"),"the key is sent on same-host hops only");
});
test("N11: the weekly summary email says Bing observations, not DuckDuckGo",()=>{
  const src=fs.readFileSync("supabase/functions/send-alert/index.ts","utf8");
  assert.match(src,/Bing observations/);
  assert.doesNotMatch(src,/DuckDuckGo observations/);
});
