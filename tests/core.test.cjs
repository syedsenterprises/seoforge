
const {test}=require("node:test");
const assert=require("node:assert/strict");
const core=require("../assets/core.js");
test("URLs reject executable schemes and embedded credentials",()=>{
  for(const input of ["javascript:alert(1)","data:text/html,hi","https://user:pass@example.com","https://bad host.com","file:///etc/passwd"]) assert.equal(core.normaliseSite(input),"",input);
  assert.equal(core.normaliseSite("example.com"),"https://example.com");
  assert.equal(core.normHost("https://WWW.Example.com/path?q=1"),"example.com");
});
test("CSV cells neutralize spreadsheet formulas and quote content",()=>{
  for(const input of ["=cmd()","+cmd()","-cmd()","@cmd()","\t=cmd()"," \r+cmd()"]) assert.ok(core.csvCell(input).startsWith('"\''));
  assert.equal(core.csvCell('a,"b"'),'"a,""b"""');
  assert.equal(core.csvCell(null),'""');
});
test("Preferences validate arbitrary imported or stored values",()=>{
  assert.deepEqual(core.validatePreferences({theme:"evil",accent:"red;display:none",density:"broken",defaultSite:"javascript:x",brand:"x".repeat(100)}),{theme:"system",accent:"#0f766e",density:"comfortable",brand:"x".repeat(60),defaultSite:"",strategy:"mobile"});
});

/* ---------- v2.11.0: Health Check rules as pure data (shared with the landing hero widget) ---------- */
test("Health Check rules: eight checks, all-pass and each failure mode",()=>{
  const base={url:"https://example.com",title:"A perfectly sized example title here!",desc:"A meta description that is long enough to pass the one hundred and twenty character minimum and stays under the one sixty maximum.",h1s:1,imgs:2,noAlt:0,viewport:true,psiScore:82,sfScore:87,sfGrade:"Good"};
  const all=core.healthChecks(base);
  assert.equal(all.length,8);
  assert.equal(all.filter(c=>c.pass).length,8);
  assert.equal(core.healthChecks({...base,url:"http://example.com"}).find(c=>c.name==="HTTPS").pass,false);
  assert.equal(core.healthChecks({...base,title:""}).find(c=>c.name==="Title tag").pass,false);
  assert.equal(core.healthChecks({...base,title:"short"}).find(c=>c.name==="Title tag").warn,true);
  assert.equal(core.healthChecks({...base,desc:""}).find(c=>c.name==="Meta description").pass,false);
  assert.equal(core.healthChecks({...base,h1s:0}).find(c=>c.name==="Exactly one H1").pass,false);
  assert.equal(core.healthChecks({...base,h1s:2}).find(c=>c.name==="Exactly one H1").pass,false);
  assert.equal(core.healthChecks({...base,noAlt:2}).find(c=>c.name==="Image alt text").pass,false);
  assert.equal(core.healthChecks({...base,viewport:false}).find(c=>c.name==="Viewport meta tag").pass,false);
  assert.equal(core.healthChecks({...base,psiScore:40}).find(c=>c.name==="Mobile PageSpeed ≥ 50").pass,false);
  const un=core.healthChecks({...base,psiScore:null,psiErr:"quota exhausted"});
  assert.equal(un.find(c=>c.name==="Mobile PageSpeed ≥ 50").warn,true);
  assert.match(un.find(c=>c.name==="Mobile PageSpeed ≥ 50").detail,/quota exhausted/);
  assert.equal(core.healthChecks({...base,sfScore:60}).find(c=>c.name==="SEOForge Speed Score").warn,true);
  assert.equal(core.healthChecks({...base,sfScore:40}).find(c=>c.name==="SEOForge Speed Score").pass,false);
});
test("extractSpeedMetrics reads the raw inputs the Speed Score is built from",()=>{
  const el=(attrs)=>({getAttribute:n=>attrs[n]??null});
  const doc={querySelectorAll:(s)=>{
    if(s==="img") return [el({src:"https://x/a.jpg",width:"100",height:"100"}),el({src:"https://x/b.webp",width:"",height:""})];
    if(s==="head script[src]") return [el({})];
    if(s==='head link[rel="stylesheet"]') return [el({media:"screen"})];
    if(s==="script[src]") return [el({}),el({})];
    if(s==='link[rel="stylesheet"]') return [el({})];
    if(s==='link[rel="preload"]') return [];
    if(s==="source[src]") return [];
    return [];
  }};
  const m=core.extractSpeedMetrics(doc,"<html>hello</html>",{ttfbMs:150,bytes:80000,compressed:true,headers:{encoding:"gzip",cache:"public, max-age=86400"}});
  assert.equal(m.ttfbMs,150);
  assert.equal(m.bytes,80000);
  assert.equal(m.blocking,2); /* 1 head script + 1 head stylesheet */
  assert.equal(m.compressed,true);
  assert.equal(m.imgs,2); assert.equal(m.sized,1); assert.equal(m.raster,2); assert.equal(m.modern,1);
  assert.equal(m.resources,5);
  /* No timings: the score says so instead of inventing them. */
  const n=core.extractSpeedMetrics(doc,"<html>hello</html>",null);
  assert.equal(n.ttfbMs,null); assert.equal(n.bytes,null); assert.equal(n.compressed,null);
});
