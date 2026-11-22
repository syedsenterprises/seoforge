
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
