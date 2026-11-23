import {json,originFor} from "../_shared/http.js";
Deno.serve(req=>{
  let origin="";
  try {
    origin=originFor(req);
    if(req.method==="OPTIONS") return json({},200,origin);
    if(req.method!=="GET") return json({error:"Method not allowed"},405,origin);
    const configured=(names)=>names.every(name=>!!Deno.env.get(name));
    return json({version:"2.11.0",core:true,
      google:configured(["GOOGLE_CLIENT_SECRET"]),
      /* Billing is ready when the credentials are set AND at least one plan
         is configured. The legacy PAYPAL_PLAN_ID alone must not be required:
         under the four-var v2.11.0 config it may be unset while
         PAYPAL_PLAN_PRO_MONTHLY holds the same Pro monthly plan. */
      billing:Deno.env.get("BILLING_ENABLED")==="true" && configured(["PAYPAL_CLIENT_ID","PAYPAL_CLIENT_SECRET","PAYPAL_WEBHOOK_ID","PAYPAL_MODE"]) && !!(Deno.env.get("PAYPAL_PLAN_PRO_MONTHLY") || Deno.env.get("PAYPAL_PLAN_ID")),
      email:configured(["RESEND_API_KEY","RESEND_FROM","CRON_SECRET"]),
      emailScheduled:Deno.env.get("SUMMARY_SCHEDULE_ENABLED")==="true"
    },200,origin);
  } catch { return json({error:"Request not allowed"},403,origin); }
});
