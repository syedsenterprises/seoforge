
import {env,db,body,serve} from "../_shared/http.js";
import {paypal,verifiedSubscription} from "../_shared/paypal.js";
serve(async req=>{
  const event=await body(req);
  const headers=["paypal-auth-algo","paypal-cert-url","paypal-transmission-id","paypal-transmission-sig","paypal-transmission-time"];
  if(headers.some(h=>!req.headers.get(h))) throw new Error("Missing PayPal signature");
  const verification=await paypal("/v1/notifications/verify-webhook-signature","POST",{
    auth_algo:req.headers.get(headers[0]),cert_url:req.headers.get(headers[1]),transmission_id:req.headers.get(headers[2]),transmission_sig:req.headers.get(headers[3]),transmission_time:req.headers.get(headers[4]),webhook_id:env("PAYPAL_WEBHOOK_ID"),webhook_event:event
  });
  if(verification.verification_status!=="SUCCESS") throw new Error("Invalid PayPal signature");
  if(!/^BILLING\.SUBSCRIPTION\./.test(event.event_type||"")) return {ignored:true};
  const id=event.resource?.id;
  if(!/^I-[A-Z0-9]+$/.test(id||"")) throw new Error("Invalid subscription ID");
  // Fetch authoritative current state; event delivery order is not authoritative.
  const subscription=await paypal("/v1/billing/subscriptions/"+id);
  const rows=await db("billing_subscriptions?subscription_id=eq."+id);
  if(!rows.length) throw new Error("Subscription is not bound to an account");
  const plan=verifiedSubscription(subscription,env("PAYPAL_PLAN_ID"),rows[0].user_id);
  await db("rpc/apply_billing_event","POST",{p_event_id:event.id,p_subscription_id:id,p_plan:plan,p_status:subscription.status,p_time:subscription.update_time||subscription.create_time});
  return {received:true};
});
