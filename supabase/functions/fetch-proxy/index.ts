import {body,serve} from "../_shared/http.js";
/* Server-side fetch proxy for the audit tools. The browser cannot fetch other
   sites directly (CORS), and the free public proxies are unreliable, so the
   app calls this function first and falls back to the public proxies.
   No sign-in required (the tools work logged out too); the shared serve()
   helper enforces the app-origin allowlist. Guards: http(s) only, no
   credentials in the URL, private/loopback/link-local targets blocked,
   20s timeout, 2 MB response cap. It also measures the fetch (time to first
   byte, total time, exact byte size, compression/cache headers) so the app can
   compute its own SEOForge Speed Score without Google's PageSpeed API. */
const MAX_BYTES = 2000000;
function blockedTarget(u){
  if(u.protocol!=="http:" && u.protocol!=="https:") return "Only http and https URLs can be checked";
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
  const raw = String(input.url||"");
  if(!raw || raw.length>2048) throw new Error("Enter a valid URL");
  let u;
  try{ u = new URL(raw); }catch{ throw new Error("Enter a valid URL"); }
  const blocked = blockedTarget(u);
  if(blocked) throw new Error(blocked);
  const t0 = performance.now();
  let res;
  try{
    res = await fetch(u.href, {signal:AbortSignal.timeout(20000), headers:{"User-Agent":"SEOForge fetch-proxy (https://seoforge.syedsenterprises.org/)"}, redirect:"follow"});
  }catch(e){ throw new Error("Could not fetch the URL ("+((e&&e.name==="TimeoutError")?"timed out":"network error")+"). The site may be down or blocking automated requests."); }
  const ttfbMs = Math.round(performance.now() - t0);
  const buf = await res.arrayBuffer();
  const totalMs = Math.round(performance.now() - t0);
  const bytes = buf.byteLength;
  const text = new TextDecoder().decode(buf).slice(0, MAX_BYTES);
  /* Compression: the runtime decompresses transparently and strips the
     content-encoding header, so it can never be read from headers. Instead
     compare the wire size (content-length, when the server sends one) with
     the decompressed size — smaller wire size means the transfer was
     compressed. Null when the server sends no content length. */
  const clRaw = res.headers.get("content-length");
  const cl = clRaw ? parseInt(clRaw, 10) : null;
  const compressed = (cl!=null && !isNaN(cl)) ? cl < bytes : null;
  return {status:res.status, ok:res.ok, text, ttfbMs, totalMs, bytes, compressed, headers:{encoding:res.headers.get("content-encoding")||"", cache:res.headers.get("cache-control")||"", server:res.headers.get("server")||"", type:res.headers.get("content-type")||""}};
});
