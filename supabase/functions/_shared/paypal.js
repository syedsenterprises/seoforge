
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
export function verifiedSubscription(subscription,plan,userId){
  if(subscription.plan_id!==plan || subscription.custom_id!==userId) throw new Error("Subscription ownership or plan mismatch");
  return subscription.status==="ACTIVE"?"pro":"free";
}
