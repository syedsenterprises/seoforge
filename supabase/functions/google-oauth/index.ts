
import {env,request,db,authenticate,body,serve} from "../_shared/http.js";
const tokenURL="https://oauth2.googleapis.com/token";
async function tokenRequest(params){
  return request(tokenURL,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:env("GOOGLE_CLIENT_ID"),client_secret:env("GOOGLE_CLIENT_SECRET"),...params})});
}
async function accessToken(uid){
  const rows=await db("google_tokens?user_id=eq."+uid+"&provider=eq.google");
  const row=rows[0]; if(!row) throw new Error("Connect Google first");
  if(Date.parse(row.expires_at)>Date.now()+60000) return row.access_token;
  if(!row.refresh_token) throw new Error("Reconnect Google to renew access");
  const token=await tokenRequest({grant_type:"refresh_token",refresh_token:row.refresh_token});
  await db("google_tokens?user_id=eq."+uid+"&provider=eq.google","PATCH",{access_token:token.access_token,expires_at:new Date(Date.now()+token.expires_in*1000).toISOString()});
  return token.access_token;
}
serve(async req=>{
  const user=await authenticate(req), input=await body(req), action=input.action;
  if(!await db("rpc/claim_api_request","POST",{p_user:user.id,p_action:"google",p_limit:30})) throw new Error("Too many requests. Try again in one minute.");
  if(action==="status"){
    const rows=await db("google_tokens?select=user_id&user_id=eq."+user.id+"&provider=eq.google");
    return {connected:rows.length>0};
  }
  if(action==="disconnect"){
    await db("google_tokens?user_id=eq."+user.id+"&provider=eq.google","DELETE");
    return {connected:false};
  }
  if(action==="exchange"){
    if(input.redirect_uri!==env("GOOGLE_REDIRECT_URI")) throw new Error("Invalid redirect URI");
    if(typeof input.code!=="string"||input.code.length>4096|| !/^[A-Za-z0-9._~-]{43,128}$/.test(input.code_verifier||"")) throw new Error("Invalid OAuth exchange");
    const token=await tokenRequest({grant_type:"authorization_code",code:input.code,redirect_uri:input.redirect_uri,code_verifier:input.code_verifier});
    if(!token.access_token) throw new Error("Google returned no access token");
    if(!token.refresh_token) throw new Error("Google did not grant offline access. Revoke the old grant in Google account settings and reconnect.");
    await db("google_tokens","POST",{user_id:user.id,provider:"google",access_token:token.access_token,refresh_token:token.refresh_token,expires_at:new Date(Date.now()+token.expires_in*1000).toISOString()});
    return {connected:true};
  }
  const token=await accessToken(user.id);
  const google=(url,payload=undefined)=>request(url,{headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},...(payload?{method:"POST",body:JSON.stringify(payload)}:{})});
  if(action==="sites"){
    const data=await google("https://www.googleapis.com/webmasters/v3/sites");
    return {sites:data.siteEntry||[]};
  }
  if(action==="gsc"){
    if(typeof input.site!=="string"||input.site.length>2048|| !/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(input.endDate)||input.startDate>input.endDate) throw new Error("Invalid site or date range");
    const url="https://www.googleapis.com/webmasters/v3/sites/"+encodeURIComponent(input.site)+"/searchAnalytics/query";
    const query=dimensions=>google(url,{startDate:input.startDate,endDate:input.endDate,dimensions,rowLimit:1000});
    const [total,pages,queries]=await Promise.all([query([]),query(["page"]),query(["query"])]);
    return {totals:total.rows?.[0]||{},pages:pages.rows||[],queries:queries.rows||[]};
  }
  if(action==="ga4properties"){
    const properties=[]; let next="";
    do {
      const data=await google("https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200"+(next?"&pageToken="+encodeURIComponent(next):""));
      for(const account of data.accountSummaries||[]) for(const p of account.propertySummaries||[]) properties.push({name:p.property,displayName:p.displayName});
      next=data.nextPageToken||"";
    } while(next && properties.length<2000);
    return {properties};
  }
  if(action==="ga4"){
    if(!/^properties\/\d+$/.test(input.property)) throw new Error("Invalid GA4 property");
    const data=await google("https://analyticsdata.googleapis.com/v1beta/"+input.property+":runReport",{dateRanges:[{startDate:"28daysAgo",endDate:"yesterday"}],metrics:[{name:"sessions"},{name:"totalUsers"}]});
    return {sessions:Number(data.rows?.[0]?.metricValues?.[0]?.value||0),users:Number(data.rows?.[0]?.metricValues?.[1]?.value||0)};
  }
  throw new Error("Unknown Google action");
});
