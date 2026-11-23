import {originFor,json,authenticate,env,optEnv,serviceKey,db} from "../_shared/http.js";
/* Owner-only user counts (v2.10.0). The JWT is verified inside the function
   (verify_jwt = false in config.toml, like the other functions, because auth
   is checked here): the caller's email must be the owner email, otherwise
   403. Counts come from the platform-provided Supabase secret key via
   PostgREST exact counts and the owner's own billing_subscriptions row —
   never a custom secret (the dashboard rejects SUPABASE_ secret names) and
   never in client code, never in the repo. Only counts leave the server —
   no names, no emails, no other user's data. */
const OWNER_EMAIL = "syedsinterprises@gmail.com";
async function countRows(table, filter){
  /* Count via content-range, selecting * — NOT a named id column: some
     tables have no `id` column (billing_subscriptions is keyed by user_id),
     and PostgREST 400s a select for a column that does not exist, which
     this function used to surface as a 400 for the owner (live, 23–24 Nov
     2026: the panel showed "User stats unavailable" while auth succeeded).
     select=* works on every table; the count comes from the header. */
  const q = "?select=*&limit=1" + (filter ? "&" + filter : "");
  const key = serviceKey();
  /* A new-style secret key (sb_secret_…) is NOT a JWT: PostgREST accepts it
     as the apikey header only — sending it as "Authorization: Bearer
     sb_secret_…" makes PostgREST reject every count with 401, which this
     function used to surface as a 400 for the owner (live, 23 Nov 2026:
     the panel showed "User stats unavailable" while auth itself succeeded).
     Legacy JWT service keys still go in both headers, exactly as before.
     This mirrors db() in _shared/http.js, which already omits the Bearer
     header for sb_secret_ keys. */
  const headers = {apikey:key, Prefer:"count=exact", ...(key.startsWith("sb_secret_") ? {} : {Authorization:"Bearer " + key})};
  const res = await fetch(env("SUPABASE_URL") + "/rest/v1/" + table + q, {headers});
  if(!res.ok) throw new Error("Could not count " + table + " (HTTP " + res.status + ")");
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
    const [totalUsers, proUsers, agencyUsers, businessUsers, payingUsers, signups7d, auditsThisMonth] = await Promise.all([
      countRows("profiles", ""),
      countRows("profiles", "plan=eq.pro"),
      countRows("profiles", "plan=eq.agency"),
      countRows("profiles", "plan=eq.business"),
      /* Paying users = ACTIVE billing_subscriptions only. An abandoned
         APPROVAL_PENDING subscription (left by an earlier QA walkthrough)
         never counts here. */
      countRows("billing_subscriptions", "status=eq.ACTIVE"),
      countRows("profiles", "created_at=gte."+encodeURIComponent(sevenDaysAgo)),
      countRows("audits", "created_at=gte."+encodeURIComponent(monthStart)),
    ]);
    const subs = await db("billing_subscriptions?user_id=eq."+user.id+"&order=created_at.desc&limit=1");
    const sub = subs[0] ? {id:subs[0].subscription_id||"", status:subs[0].status||""} : null;
    return json({totalUsers, proUsers, agencyUsers, businessUsers, payingUsers, signups7d, auditsThisMonth, paypalPlanId:optEnv("PAYPAL_PLAN_PRO_MONTHLY") || optEnv("PAYPAL_PLAN_ID"), subscription:sub},200,origin);
  }catch(e){
    return json({error:String(e.message||e)},400,origin);
  }
});
