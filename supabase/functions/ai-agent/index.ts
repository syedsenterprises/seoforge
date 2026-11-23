import {body,serve} from "../_shared/http.js";
/* Forge Assistant — the in-site AI agent. The browser sends the user's OWN API
   key + provider + messages; this function only forwards the request to the
   provider's OpenAI-compatible chat endpoint and returns the reply. No key is
   stored server-side and no site-wide key exists — a user without a key gets a
   clear "add your key in Settings" error, never a reply paid for by the site.
   Guards: https only, private/loopback targets blocked (same posture as the
   fetch proxy), at most 10 messages, each at most 2000 chars, 800 max output
   tokens, 25s timeout, 4 KB reply cap. */
const MAX_MSGS = 10, MAX_CHARS = 2000, MAX_TOKENS = 800;
function blockedTarget(u){
  if(u.protocol!=="http:" && u.protocol!=="https:") return "Only http and https provider URLs are allowed";
  if(u.username || u.password) return "URLs with credentials are not allowed";
  const h = u.hostname.toLowerCase();
  if(h==="localhost" || h.endsWith(".localhost")) return "Local addresses are not allowed";
  if(/^(\d{1,3}\.){3}\d{1,3}$/.test(h)){
    const p = h.split(".").map(Number);
    if(p[0]===10 || p[0]===127 || p[0]===0) return "Private addresses are not allowed";
    if(p[0]===172 && p[1]>=16 && p[1]<=31) return "Private addresses are not allowed";
    if(p[0]===192 && p[1]===168) return "Private addresses are not allowed";
    if(p[0]===169 && p[1]===254) return "Private addresses are not allowed";
  }
  if(h==="::1" || h==="[::1]" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return "Private addresses are not allowed";
  return "";
}
serve(async req=>{
  const input = await body(req);
  const apiKey = String(input.apiKey||"").trim();
  if(!apiKey) throw new Error("Add your AI key in Settings first — the assistant runs on your own key (CoArena, Gemini or any OpenAI-compatible provider).");
  const baseUrl = String(input.baseUrl||"").trim();
  if(!baseUrl) throw new Error("Choose an AI provider in Settings first.");
  let u;
  try{ u = new URL(baseUrl); }catch{ throw new Error("The provider URL in Settings is not a valid URL."); }
  const blocked = blockedTarget(u);
  if(blocked) throw new Error(blocked);
  const model = String(input.model||"").trim();
  if(!model) throw new Error("Choose a model in Settings first.");
  const msgs = Array.isArray(input.messages) ? input.messages : [];
  if(!msgs.length || msgs.length > MAX_MSGS) throw new Error("Send between 1 and 10 messages.");
  const clean = msgs.map(m=>({role:(m.role==="assistant"?"assistant":"user"), content:String(m.content||"").slice(0,MAX_CHARS)})).filter(m=>m.content.trim());
  if(!clean.length) throw new Error("Write a message first.");
  const endpoint = u.href.replace(/\/+$/,"") + "/chat/completions";
  let res;
  try{
    res = await fetch(endpoint, {method:"POST", headers:{"Content-Type":"application/json","Authorization":"Bearer "+apiKey}, body:JSON.stringify({model, messages:clean, max_tokens:MAX_TOKENS, temperature:0.7}), signal:AbortSignal.timeout(25000)});
  }catch(e){ throw new Error("Could not reach the AI provider ("+((e&&e.name==="TimeoutError")?"timed out":"network error")+"). Check the provider URL in Settings."); }
  const data = await res.json().catch(()=>({}));
  if(!res.ok){
    const msg = (data.error && (data.error.message||data.error)) || ("HTTP "+res.status);
    throw new Error("The AI provider refused the request ("+res.status+"): "+String(msg).slice(0,300));
  }
  const reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if(!reply) throw new Error("The AI provider returned no reply.");
  return {reply:String(reply).slice(0,4000)};
});
