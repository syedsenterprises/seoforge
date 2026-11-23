
import {env,db,request,serve} from "../_shared/http.js";
const escape=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
serve(async req=>{
  // No user-controlled recipients or arbitrary HTML; scheduler-only endpoint.
  const secret=req.headers.get("x-cron-secret")||"";
  if(secret.length<32 || secret!==env("CRON_SECRET")) throw new Error("Authentication required");
  const today=new Date(); today.setUTCDate(today.getUTCDate()-((today.getUTCDay()+6)%7));
  const week=today.toISOString().slice(0,10);
  const users=await db("profiles?weekly_summary=eq.true&select=id,email&order=id&limit=500");
  const results=[];
  for(const user of users){
    if(!user.email) continue;
    const keywords=await db("keywords?user_id=eq."+user.id+"&select=id,keyword&limit=100");
    const checks=await db("rank_checks?user_id=eq."+user.id+"&order=checked_at.desc&limit=1000");
    const html="<h1>Your SEOForge rank summary</h1><p>Latest saved Bing observations. This email does not run new rank checks.</p><ul>"+keywords.map(k=>{
      const history=checks.filter(c=>c.keyword_id===k.id).slice(0,2);
      return "<li>"+escape(k.keyword)+": "+(history.length?(history[0].position==null?"not in parsed results":"#"+Number(history[0].position))+" (checked "+escape(history[0].checked_at)+")":"not checked")+"</li>";
    }).join("")+"</ul>";
    try{
      await request("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+env("RESEND_API_KEY"),"Content-Type":"application/json","Idempotency-Key":"summary-"+user.id+"-"+week},body:JSON.stringify({from:env("RESEND_FROM"),to:[user.email],subject:"Your SEOForge weekly rank summary",html})});
      results.push({user:user.id,sent:true});
    } catch { results.push({user:user.id,sent:false}); }
  }
  return {results,limitedTo:500};
});
