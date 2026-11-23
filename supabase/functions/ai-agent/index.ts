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
function ipv4IsPrivate(p){
  if(p[0]===10 || p[0]===127 || p[0]===0) return true;
  if(p[0]===172 && p[1]>=16 && p[1]<=31) return true;
  if(p[0]===192 && p[1]===168) return true;
  if(p[0]===169 && p[1]===254) return true;
  return false;
}
/* Decode an IPv4-mapped IPv6 address (::ffff:127.0.0.1, normalised by the
   URL parser to ::ffff:7f00:1) to its four IPv4 octets, or null when the
   mapped form cannot be parsed (blocked defensively — it is still a
   mapped address, so it is never treated as a public host). */
function mappedIPv4(v6){
  const rest = v6.slice("::ffff:".length);
  if(rest.includes(".")){
    const m = rest.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    return m ? m.slice(1).map(Number) : null;
  }
  const parts = rest.split(":").filter(Boolean);
  if(parts.length === 2){
    const hi = parseInt(parts[0], 16), lo = parseInt(parts[1], 16);
    if(!isNaN(hi) && !isNaN(lo)) return [(hi>>8)&255, hi&255, (lo>>8)&255, lo&255];
  }
  return null;
}
function blockedTarget(u){
  if(u.protocol!=="http:" && u.protocol!=="https:") return "Only http and https provider URLs are allowed";
  if(u.username || u.password) return "URLs with credentials are not allowed";
  const h = u.hostname.toLowerCase();
  if(h==="localhost" || h.endsWith(".localhost")) return "Local addresses are not allowed";
  if(/^(\d{1,3}\.){3}\d{1,3}$/.test(h)){
    if(ipv4IsPrivate(h.split(".").map(Number))) return "Private addresses are not allowed";
  }
  /* IPv6 literals arrive bracketed ("[fc00::1]", "[::ffff:7f00:1]"). The
     fc/fd/fe80 test applies ONLY here — applied to the raw hostname it
     wrongly blocked ordinary DNS names such as fda.gov and fc2.com. */
  if(h.startsWith("[") && h.endsWith("]")){
    const v6 = h.slice(1, -1);
    if(v6 === "::1" || v6.startsWith("fe80:") || v6.startsWith("fc") || v6.startsWith("fd")) return "Private addresses are not allowed";
    if(v6.startsWith("::ffff:")){
      const mapped = mappedIPv4(v6);
      if(!mapped || ipv4IsPrivate(mapped)) return "Private addresses are not allowed";
    }
  }
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
  /* Redirects are followed manually (at most 10 hops), re-validating every
     hop like the fetch proxy: a provider URL must never 302 to a private
     address. Only 307/308 keep the POST; any other redirect is refused —
     a chat-completions endpoint has no reason to 301 a POST elsewhere.
     F11: the user's Bearer key is NEVER sent to a redirect target on a
     different host — a cross-host 307/308 is rejected outright, so a
     compromised provider URL cannot leak the key to a third party. A
     same-host redirect (same hostname + port) keeps the key, as before. */
  let res, current = endpoint, hops = 0;
  for(;;){
    try{
      res = await fetch(current, {method:"POST", headers:{"Content-Type":"application/json","Authorization":"Bearer "+apiKey}, body:JSON.stringify({model, messages:clean, max_tokens:MAX_TOKENS, temperature:0.7}), signal:AbortSignal.timeout(25000), redirect:"manual"});
    }catch(e){
      const msg = String((e && (e.message || e.name)) || "");
      if(/redirect/i.test(msg)) throw new Error("Too many redirects — the AI provider URL redirects in a loop. Check the provider URL in Settings.");
      throw new Error("Could not reach the AI provider ("+((e&&e.name==="TimeoutError")?"timed out":"network error")+"). Check the provider URL in Settings.");
    }
    if(res.status !== 307 && res.status !== 308) break;
    const loc = res.headers.get("location");
    if(!loc) break;
    if(++hops > 10) throw new Error("Too many redirects — the AI provider URL redirects in a loop. Check the provider URL in Settings.");
    let next;
    try{ next = new URL(loc, current); }catch{ throw new Error("The AI provider redirected to an invalid URL. Check the provider URL in Settings."); }
    if(next.protocol !== "http:" && next.protocol !== "https:") throw new Error("The AI provider redirected to a non-http(s) URL. Check the provider URL in Settings.");
    const b = blockedTarget(next);
    if(b) throw new Error(b);
    const from = new URL(current);
    if(next.hostname !== from.hostname || next.port !== from.port) throw new Error("The AI provider redirected to a different host (" + next.hostname + ") — the request was not followed, so your API key was not sent there. Check the provider URL in Settings.");
    current = next.href;
  }
  const data = await res.json().catch(()=>({}));
  if(!res.ok){
    const msg = (data.error && (data.error.message||data.error)) || ("HTTP "+res.status);
    throw new Error("The AI provider refused the request ("+res.status+"): "+String(msg).slice(0,300));
  }
  const reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if(!reply) throw new Error("The AI provider returned no reply.");
  return {reply:String(reply).slice(0,4000)};
});
