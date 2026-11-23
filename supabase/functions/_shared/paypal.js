
import {env,request} from "./http.js";
export function paypalBase(){
  const mode=env("PAYPAL_MODE");
  if(!["sandbox","live"].includes(mode)) throw new Error("PAYPAL_MODE must be sandbox or live");
  return mode==="live"?"https://api-m.paypal.com":"https://api-m.sandbox.paypal.com";
}
export async function paypal(path,method="GET",payload,requestId){
  const token=await request(paypalBase()+"/v1/oauth2/token",{method:"POST",headers:{Authorization:"Basic "+btoa(env("PAYPAL_CLIENT_ID")+":"+env("PAYPAL_CLIENT_SECRET")),"Content-Type":"application/x-www-form-urlencoded"},body:"grant_type=client_credentials"});
  return request(paypalBase()+path,{method,headers:{Authorization:"Bearer "+token.access_token,"Content-Type":"application/json",...(requestId?{"PayPal-Request-Id":requestId}:{})},...(payload?{body:JSON.stringify(payload)}:{})});
}
/* Plan map (v2.11.0): PayPal plan IDs → SEOForge tiers. Pro monthly keeps the
   existing PAYPAL_PLAN_ID value (PAYPAL_PLAN_PRO_MONTHLY falls back to it);
   the other three are deploy-time secrets — no plan ID is in this code. */
export function planToTier(){
  const m = {};
  const put = (id, tier) => { if(id) m[id] = tier; };
  put(env("PAYPAL_PLAN_PRO_MONTHLY") || env("PAYPAL_PLAN_ID"), "pro");
  put(env("PAYPAL_PLAN_PRO_YEARLY"), "pro");
  put(env("PAYPAL_PLAN_AGENCY_MONTHLY"), "agency");
  put(env("PAYPAL_PLAN_AGENCY_YEARLY"), "agency");
  return m;
}
export function verifiedSubscription(subscription, plan, userId){
  /* plan: a plan→tier map from planToTier(), or (legacy) a single plan ID
     string, which means {"<id>": "pro"}. Returns the tier when ACTIVE, else
     "free" — a pending subscription never grants a paid plan. */
  const map = typeof plan === "string" ? {[plan]: "pro"} : plan;
  const tier = map ? map[subscription.plan_id] : undefined;
  if(!tier || subscription.custom_id!==userId) throw new Error("Subscription ownership or plan mismatch");
  return subscription.status==="ACTIVE" ? tier : "free";
}
