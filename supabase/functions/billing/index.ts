
import {env,optEnv,db,authenticate,body,serve} from "../_shared/http.js";
import {paypal,verifiedSubscription,planToTier} from "../_shared/paypal.js";
serve(async req=>{
  const user=await authenticate(req), input=await body(req);
  if(!await db("rpc/claim_api_request","POST",{p_user:user.id,p_action:"billing",p_limit:10})) throw new Error("Too many requests. Try again in one minute.");
  if(input.action==="refresh"){
    const rows=await db("billing_subscriptions?user_id=eq."+user.id);
    if(rows[0]){
      const subscription=await paypal("/v1/billing/subscriptions/"+rows[0].subscription_id);
      const plan=verifiedSubscription(subscription,planToTier(),user.id);
      await db("rpc/apply_billing_event","POST",{p_event_id:"refresh:"+subscription.id+":"+(subscription.update_time||subscription.create_time),p_subscription_id:subscription.id,p_plan:plan,p_status:subscription.status,p_time:subscription.update_time||subscription.create_time});
    }
  }
  if(input.action==="status" || input.action==="refresh"){
    const rows=await db("profiles?select=plan&id=eq."+user.id);
    return {plan:rows[0]?.plan||"free"};
  }
  // Checkout stays disabled until an operator validates the full sandbox lifecycle.
  if(env("BILLING_ENABLED")!=="true") throw new Error("Paid checkout is not enabled");
  if(input.action!=="checkout") throw new Error("Unknown billing action");
  const existing=await db("billing_subscriptions?user_id=eq."+user.id+"&order=created_at.desc&limit=1");
  if(existing[0]){
    const subscription=await paypal("/v1/billing/subscriptions/"+existing[0].subscription_id);
    verifiedSubscription(subscription,planToTier(),user.id);
    if(subscription.status==="ACTIVE") throw new Error("A subscription is already active");
    if(["APPROVAL_PENDING","APPROVED"].includes(subscription.status)){
      const approve=subscription.links?.find(l=>l.rel==="approve")?.href;
      if(approve) return {url:approve};
      throw new Error("Your subscription is awaiting activation");
    }
  }
  /* Plan keys from the app picker: "pro-monthly" | "pro-yearly" |
     "agency-monthly" | "agency-yearly". Business has no PayPal plan (Talk to
     sales). An unconfigured plan fails honestly instead of charging the wrong
     plan — the plan IDs live in Supabase secrets, never in this code. */
  const PLAN_KEYS = {
    "pro-monthly": () => optEnv("PAYPAL_PLAN_PRO_MONTHLY") || optEnv("PAYPAL_PLAN_ID"),
    "pro-yearly": () => optEnv("PAYPAL_PLAN_PRO_YEARLY"),
    "agency-monthly": () => optEnv("PAYPAL_PLAN_AGENCY_MONTHLY"),
    "agency-yearly": () => optEnv("PAYPAL_PLAN_AGENCY_YEARLY"),
  };
  /* Promo code LAUNCH25: 25% off the FIRST YEAR on yearly plans only.
     Pro Yearly $90 → $67.50 year 1, then $90/year. Agency Yearly $290 →
     $217.50 year 1, then $290/year. The discounted first year is a trial
     billing cycle on a separate PayPal plan; the promo plan IDs live in
     Supabase secrets, never in this code. Monthly plans are never discounted. */
  const PROMO_CODE = "LAUNCH25";
  const PROMO_PLAN_KEYS = {
    "pro-yearly": () => optEnv("PAYPAL_PLAN_PRO_YEARLY_PROMO"),
    "agency-yearly": () => optEnv("PAYPAL_PLAN_AGENCY_YEARLY_PROMO"),
  };
  const promo = (input.promo || "").toString().trim().toUpperCase();
  const resolve = PLAN_KEYS[input.plan || "pro-monthly"];
  if(!resolve) throw new Error("Unknown plan — choose Pro or Agency in the app");
  let planId;
  if(promo){
    if(promo !== PROMO_CODE) throw new Error("That promo code is not valid.");
    const promoResolve = PROMO_PLAN_KEYS[input.plan || "pro-monthly"];
    if(!promoResolve) throw new Error("LAUNCH25 applies to yearly plans only — pick Pro Yearly or Agency Yearly.");
    planId = promoResolve();
    if(!planId) throw new Error("LAUNCH25 is not set up yet — try again shortly.");
  }else{
    planId = resolve();
  }
  if(!planId) throw new Error("That plan is not set up yet — the owner is still creating it in PayPal. Free accounts keep working meanwhile.");
  const attempt=await db("rpc/checkout_attempt","POST",{p_user:user.id,p_previous:existing[0]?.subscription_id||null});
  /* Return URL: prefer a dedicated APP_URL secret; fall back to the Google
     redirect URI only because it currently holds the same app URL. APP_URL is
     optional — optEnv, never env(), or an unset APP_URL would throw and break
     every checkout. */
  const appUrl=optEnv("APP_URL") || env("GOOGLE_REDIRECT_URI");
  const result=await paypal("/v1/billing/subscriptions","POST",{plan_id:planId,custom_id:user.id,application_context:{brand_name:"SEOForge",user_action:"SUBSCRIBE_NOW",return_url:appUrl,cancel_url:appUrl}},attempt);
  // Unique user_id prevents simultaneous checkout requests from binding multiple subscriptions.
  await db("billing_subscriptions?on_conflict=user_id","POST",{user_id:user.id,subscription_id:result.id,status:result.status});
  const url=result.links?.find(l=>l.rel==="approve")?.href;
  if(!url) throw new Error("PayPal did not return an approval URL");
  return {url};
});
