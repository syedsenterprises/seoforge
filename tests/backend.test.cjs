
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const source=file=>fs.readFileSync(file,"utf8").replace(/^import .*;\r?$/gm,"").replaceAll("export ","");
test("Billing entitlement requires matching plan and bound account",()=>{
  const ctx=vm.createContext({});
  vm.runInContext(source("supabase/functions/_shared/paypal.js"),ctx);
  assert.equal(ctx.verifiedSubscription({plan_id:"p",custom_id:"u",status:"ACTIVE"},"p","u"),"pro");
  assert.equal(ctx.verifiedSubscription({plan_id:"p",custom_id:"u",status:"SUSPENDED"},"p","u"),"free");
  assert.throws(()=>ctx.verifiedSubscription({plan_id:"wrong",custom_id:"u",status:"ACTIVE"},"p","u"),/mismatch/);
  assert.throws(()=>ctx.verifiedSubscription({plan_id:"p",custom_id:"other",status:"ACTIVE"},"p","u"),/mismatch/);
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
      const total=String(url).includes("plan=eq.pro")?"0-0/3":String(url).includes("created_at=gte")?"0-0/5":"0-0/42";
      return {ok:true,headers:{get:n=>n.toLowerCase()==="content-range"?total:null}};
    }
    if(String(url).includes("/rest/v1/audits")) return {ok:true,headers:{get:n=>n.toLowerCase()==="content-range"?"0-0/17":null}};
    if(String(url).includes("/rest/v1/billing_subscriptions")) return {ok:true,json:async()=>([{subscription_id:"I-ABC",status:"ACTIVE"}])};
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
