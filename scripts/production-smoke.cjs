
const assert=require("node:assert/strict");
(async()=>{
  const site=await fetch("https://syedsenterprises.github.io/seoforge/",{signal:AbortSignal.timeout(15000)});
  assert.equal(site.status,200);
  const html=await site.text();
  assert.match(html,/assets\/app.js/);
  const root="https://mzbesucdnjecinkdawzy.supabase.co/functions/v1/";
  const status=await fetch(root+"status",{signal:AbortSignal.timeout(15000)});
  assert.equal(status.status,200); const readiness=await status.json(); assert.equal(readiness.core,true); console.log("Integration readiness:",JSON.stringify(readiness));
  for(const name of ["billing","google-oauth","send-alert"]){
    const res=await fetch(root+name,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}",signal:AbortSignal.timeout(15000)});
    assert.equal(res.status,401,name+" must deny unauthenticated requests");
  }
  const webhook=await fetch(root+"paypal-webhook",{method:"POST",headers:{"Content-Type":"application/json"},body:'{"event_type":"BILLING.SUBSCRIPTION.ACTIVATED"}',signal:AbortSignal.timeout(15000)});
  assert.equal(webhook.status,400);
  console.log("PASS: production frontend/status reachable; private endpoints reject unauthenticated access.");
})().catch(e=>{console.error(e);process.exitCode=1;});
