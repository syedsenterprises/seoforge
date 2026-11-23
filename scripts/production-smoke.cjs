const assert=require("node:assert/strict");
(async()=>{
  /* Landing split (v2.10.0): the root is the landing only — it must NOT load
     app.js. The app lives at /app.html (noindex, not in the sitemap). */
  const site=await fetch("https://seoforge.syedsenterprises.org/",{signal:AbortSignal.timeout(15000)});
  assert.equal(site.status,200);
  const html=await site.text();
  assert.doesNotMatch(html,/assets\/app\.js/);
  assert.match(html,/app\.html#auth=signup/);
  assert.match(html,/Continue without an account/);
  const app=await fetch("https://seoforge.syedsenterprises.org/app.html",{signal:AbortSignal.timeout(15000)});
  assert.equal(app.status,200);
  const appHtml=await app.text();
  assert.match(appHtml,/assets\/app\.js/);
  assert.match(appHtml,/name="robots" content="noindex"/);
  assert.match(appHtml,/id="sidebar"/);
  const root="https://mzbesucdnjecinkdawzy.supabase.co/functions/v1/";
  const status=await fetch(root+"status",{signal:AbortSignal.timeout(15000)});
  assert.equal(status.status,200); const readiness=await status.json(); assert.equal(readiness.core,true); assert.equal(readiness.version,"2.10.0"); console.log("Integration readiness:",JSON.stringify(readiness));
  for(const name of ["billing","google-oauth","send-alert"]){
    const res=await fetch(root+name,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}",signal:AbortSignal.timeout(15000)});
    assert.equal(res.status,401,name+" must deny unauthenticated requests");
  }
  const webhook=await fetch(root+"paypal-webhook",{method:"POST",headers:{"Content-Type":"application/json"},body:'{"event_type":"BILLING.SUBSCRIPTION.ACTIVATED"}',signal:AbortSignal.timeout(15000)});
  assert.equal(webhook.status,400);
  /* PageSpeed edge function (v2.10.0): no URL -> honest 400, never a score. */
  const psi=await fetch(root+"pagespeed",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}",signal:AbortSignal.timeout(15000)});
  assert.equal(psi.status,400);
  console.log("PASS: production landing/app/status reachable; private endpoints reject unauthenticated access; pagespeed answers honestly.");
})().catch(e=>{console.error(e);process.exitCode=1;});
