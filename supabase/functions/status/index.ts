import {json,originFor} from "../_shared/http.js";
Deno.serve(req=>{
  let origin="";
  try {
    origin=originFor(req);
    if(req.method==="OPTIONS") return json({},200,origin);
    if(req.method!=="GET") return json({error:"Method not allowed"},405,origin);
    const configured=(names)=>names.every(name=>!!Deno.env.get(name));
    return json({version:"2.9.2",core:true,
      google:configured(["GOOGLE_CLIENT_SECRET"]),
      billing:Deno.env.get("BILLING_ENABLED")==="true" && configured(["PAYPAL_CLIENT_ID","PAYPAL_CLIENT_SECRET","PAYPAL_PLAN_ID","PAYPAL_WEBHOOK_ID","PAYPAL_MODE"]),
      email:configured(["RESEND_API_KEY","RESEND_FROM","CRON_SECRET"]),
      emailScheduled:Deno.env.get("SUMMARY_SCHEDULE_ENABLED")==="true"
    },200,origin);
  } catch { return json({error:"Request not allowed"},403,origin); }
});
