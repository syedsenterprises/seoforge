import {body,serve} from "../_shared/http.js";
/* Server-side fetch proxy for the audit tools. The browser cannot fetch other
   sites directly (CORS), and the free public proxies are unreliable, so the
   app calls this function first and falls back to the public proxies.
   No sign-in required (the tools work logged out too); the shared serve()
   helper enforces the app-origin allowlist. Guards: http(s) only, no
   credentials in the URL, private/loopback/link-local targets blocked on
   the input URL and on every redirect hop, 20s timeout, 2 MB response cap. It also measures the fetch (time to first
   byte, total time, exact byte size, compression/cache headers) so the app can
   compute its own SEOForge Speed Score without Google's PageSpeed API. */
const MAX_BYTES = 2000000;
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
  if(u.protocol!=="http:" && u.protocol!=="https:") return "Only http and https URLs can be checked";
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
  const raw = String(input.url||"");
  if(!raw || raw.length>2048) throw new Error("Enter a valid URL");
  let u;
  try{ u = new URL(raw); }catch{ throw new Error("Enter a valid URL"); }
  const blocked = blockedTarget(u);
  if(blocked) throw new Error(blocked);
  const t0 = performance.now();
  /* Redirects are followed manually (at most 10 hops), re-validating every
     hop: following them blindly let a public URL 302 to a private address
     (e.g. cloud metadata at 169.254.169.254) and return its body as the
     "page". Non-http(s) hop targets are rejected outright. */
  let res, current = u, hops = 0;
  for(;;){
    try{
      res = await fetch(current.href, {signal:AbortSignal.timeout(20000), headers:{"User-Agent":"SEOForge fetch-proxy (https://seoforge.syedsenterprises.org/)"}, redirect:"manual"});
    }catch(e){
      /* F14c: the old /redirect/i branch here was dead code — manual mode
         never throws a redirect error; a loop is caught by the hops>10
         throw below. Removed, so the only error is the honest fetch error. */
      throw new Error("Could not fetch the URL ("+((e&&e.name==="TimeoutError")?"timed out":"network error")+"). The site may be down or blocking automated requests.");
    }
    if(res.status < 300 || res.status >= 400) break;
    const loc = res.headers.get("location");
    if(!loc) break;
    if(++hops > 10) throw new Error("Too many redirects — the URL redirects in a loop.");
    let next;
    try{ next = new URL(loc, current.href); }catch{ throw new Error("Could not fetch the URL (invalid redirect target). The site may be down or blocking automated requests."); }
    if(next.protocol !== "http:" && next.protocol !== "https:") throw new Error("Redirect to a non-http(s) URL is not allowed");
    const b = blockedTarget(next);
    if(b) throw new Error(b);
    current = next;
  }
  const ttfbMs = Math.round(performance.now() - t0);
  /* Real streaming cap (F10): the old code did res.arrayBuffer() first and
     sliced afterwards, so a fast server could push far more than 2 MB into
     memory before the "cap" applied. Now the body is read through a reader
     with a byte counter and the read aborts the moment MAX_BYTES is
     exceeded — the whole body is never buffered. bytes is the capped size
     (the value the Speed Score's page-weight math actually measures). */
  let bytes = 0, truncated = false;
  const chunks = [];
  if(res.body){
    const reader = res.body.getReader();
    for(;;){
      const {done, value} = await reader.read();
      if(done) break;
      const room = MAX_BYTES - bytes;
      if(room <= 0){ truncated = true; try{ await reader.cancel(); }catch(e){} break; }
      if(value.byteLength > room){
        chunks.push(value.subarray(0, room));
        bytes += room; truncated = true;
        try{ await reader.cancel(); }catch(e){}
        break;
      }
      chunks.push(value);
      bytes += value.byteLength;
    }
  }
  const totalMs = Math.round(performance.now() - t0);
  const buf = new Uint8Array(bytes);
  let off = 0;
  for(const chunk of chunks){ buf.set(chunk, off); off += chunk.byteLength; }
  const text = new TextDecoder().decode(buf);
  /* Compression: the runtime decompresses transparently and strips the
     content-encoding header, so it can never be read from headers. Instead
     compare the wire size (content-length, when the server sends one) with
     the decompressed size — smaller wire size means the transfer was
     compressed. Null when the server sends no content length. */
  const clRaw = res.headers.get("content-length");
  const cl = clRaw ? parseInt(clRaw, 10) : null;
  const compressed = (cl!=null && !isNaN(cl)) ? cl < bytes : null;
  return {status:res.status, ok:res.ok, text, ttfbMs, totalMs, bytes, compressed, truncated, headers:{encoding:res.headers.get("content-encoding")||"", cache:res.headers.get("cache-control")||"", server:res.headers.get("server")||"", type:res.headers.get("content-type")||""}};
});
