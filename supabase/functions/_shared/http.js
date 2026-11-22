
const defaults={APP_ORIGINS:"https://syedsenterprises.github.io",GOOGLE_CLIENT_ID:"158848063786-cmdknljpjj6po7j2uc4r26dp31qm4nek.apps.googleusercontent.com",GOOGLE_REDIRECT_URI:"https://syedsenterprises.github.io/seoforge/",BILLING_ENABLED:"false"};
export function env(name){ const value=Deno.env.get(name)||defaults[name]; if(!value) throw new Error("Missing server configuration: "+name); return value; }
export function json(data,status=200,origin=""){
  return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store","Access-Control-Allow-Origin":origin,"Vary":"Origin","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info, x-cron-secret","Access-Control-Allow-Methods":"POST, OPTIONS"}});
}
export function originFor(req){
  const origin=req.headers.get("origin")||"";
  const allowed=env("APP_ORIGINS").split(",").map(s=>s.trim());
  if(origin && !allowed.includes(origin)) throw new Error("Origin not allowed");
  return origin;
}
export async function request(url,options={}){
  const res=await fetch(url,{...options,signal:AbortSignal.timeout(20000)});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error("Upstream request failed ("+res.status+")");
  return data;
}
export function serviceKey(){
  try { const keys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}"); if(keys.default) return keys.default; } catch {}
  return env("SUPABASE_SERVICE_ROLE_KEY");
}
export async function db(path,method="GET",body){
  const key=serviceKey();
  return request(env("SUPABASE_URL")+"/rest/v1/"+path,{
    method,headers:{apikey:key,...(key.startsWith("sb_secret_")?{}:{Authorization:"Bearer "+key}),"Content-Type":"application/json",Prefer:"return=representation,resolution=merge-duplicates"},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
}
export async function authenticate(req){
  const token=req.headers.get("authorization")||"";
  if(!/^Bearer .+/.test(token)) throw new Error("Authentication required");
  const user=await request(env("SUPABASE_URL")+"/auth/v1/user",{headers:{Authorization:token,apikey:serviceKey()}});
  if(!user.id) throw new Error("Authentication required");
  return user;
}
export async function body(req){
  const raw=await req.text();
  if(raw.length>64000) throw new Error("Request too large");
  return JSON.parse(raw);
}
export function serve(handler){
  Deno.serve(async req=>{
    let origin="";
    try{
      origin=originFor(req);
      if(req.method==="OPTIONS") return json({},200,origin);
      if(req.method!=="POST") return json({error:"Method not allowed"},405,origin);
      return json(await handler(req),200,origin);
    }catch(e){
      const message=String(e.message||e);
      const auth=/Authentication required/.test(message);
      return json({error:message},auth?401:400,origin);
    }
  });
}
