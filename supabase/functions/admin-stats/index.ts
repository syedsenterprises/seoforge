import {originFor,json,authenticate,env,serviceKey,db} from "../_shared/http.js";
/* Owner-only user counts (v2.10.0). The JWT is verified inside the function
   (verify_jwt = false in config.toml, like the other functions, because auth
   is checked here): the caller's email must be the owner email, otherwise
   403. Counts come from the SERVICE-ROLE key (a Supabase secret for this
   function — never in client code, never in the repo) via PostgREST exact
   counts and the owner's own billing_subscriptions row. Only counts leave
   the server — no names, no emails, no other user's data.
   NOTE for deploy: save the service-role key as a Supabase secret for this
   function, or serviceKey() has nothing to count with. */
const OWNER_EMAIL = "syedsinterprises@gmail.com";
async function countRows(table, filter){
  const q = "?select=id&limit=1" + (filter ? "&" + filter : "");
  const res = await fetch(env("SUPABASE_URL") + "/rest/v1/" + table + q, {headers:{apikey:serviceKey(), Authorization:"Bearer "+serviceKey(), Prefer:"count=exact"}});
  if(!res.ok) throw new Error("Could not count " + table);
  const range = res.headers.get("content-range") || "";
  const m = range.match(/\/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : 0;
}
Deno.serve(async req=>{
  let origin="";
  try{
    origin=originFor(req);
    if(req.method==="OPTIONS") return json({},200,origin);
    if(req.method!=="POST") return json({error:"Method not allowed"},405,origin);
    let user;
    try{ user = await authenticate(req); }
    catch(e){ return json({error:"Authentication required"},401,origin); }
    if((user.email||"").toLowerCase() !== OWNER_EMAIL) return json({error:"Forbidden — owner only"},403,origin);
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime()-7*24*60*60*1000).toISOString();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const [totalUsers, proUsers, signups7d, auditsThisMonth] = await Promise.all([
      countRows("profiles", ""),
      countRows("profiles", "plan=eq.pro"),
      countRows("profiles", "created_at=gte."+encodeURIComponent(sevenDaysAgo)),
      countRows("audits", "created_at=gte."+encodeURIComponent(monthStart)),
    ]);
    const subs = await db("billing_subscriptions?user_id=eq."+user.id+"&order=created_at.desc&limit=1");
    const sub = subs[0] ? {id:subs[0].subscription_id||"", status:subs[0].status||""} : null;
    return json({totalUsers, proUsers, signups7d, auditsThisMonth, paypalPlanId:env("PAYPAL_PLAN_ID"), subscription:sub},200,origin);
  }catch(e){
    return json({error:String(e.message||e)},400,origin);
  }
});
