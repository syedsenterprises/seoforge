
import {env,db,authenticate,body,serve} from "../_shared/http.js";
import {paypal,verifiedSubscription} from "../_shared/paypal.js";
serve(async req=>{
  const user=await authenticate(req), input=await body(req);
  if(input.action==="status"){
    const rows=await db("profiles?select=plan&id=eq."+user.id);
    return {plan:rows[0]?.plan||"free"};
  }
  // Checkout stays disabled until an operator validates the full sandbox lifecycle.
  if(env("BILLING_ENABLED")!=="true") throw new Error("Paid checkout is not enabled");
  if(input.action!=="checkout") throw new Error("Unknown billing action");
  const existing=await db("billing_subscriptions?user_id=eq."+user.id+"&order=created_at.desc&limit=1");
  if(existing[0]){
    const subscription=await paypal("/v1/billing/subscriptions/"+existing[0].subscription_id);
    verifiedSubscription(subscription,env("PAYPAL_PLAN_ID"),user.id);
    if(subscription.status==="ACTIVE") throw new Error("A subscription is already active");
    if(["APPROVAL_PENDING","APPROVED"].includes(subscription.status)){
      const approve=subscription.links?.find(l=>l.rel==="approve")?.href;
      if(approve) return {url:approve};
      throw new Error("Your subscription is awaiting activation");
    }
  }
  const result=await paypal("/v1/billing/subscriptions","POST",{plan_id:env("PAYPAL_PLAN_ID"),custom_id:user.id,application_context:{brand_name:"SEOForge",user_action:"SUBSCRIBE_NOW",return_url:env("GOOGLE_REDIRECT_URI"),cancel_url:env("GOOGLE_REDIRECT_URI")}},user.id);
  // Unique user_id prevents simultaneous checkout requests from binding multiple subscriptions.
  await db("billing_subscriptions?on_conflict=user_id","POST",{user_id:user.id,subscription_id:result.id,status:result.status});
  const url=result.links?.find(l=>l.rel==="approve")?.href;
  if(!url) throw new Error("PayPal did not return an approval URL");
  return {url};
});
