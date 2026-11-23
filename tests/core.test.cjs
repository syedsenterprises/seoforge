
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
test("Accent: resolveAccent validates, lowercases and falls back to default teal",()=>{
  assert.equal(core.resolveAccent("#7c3aed"),"#7c3aed");
  assert.equal(core.resolveAccent("#7C3AED"),"#7c3aed");
  assert.equal(core.resolveAccent("#ea580c"),"#ea580c");
  for(const bad of [undefined,null,"","red","#fff","#12345g","red;display:none","#0f766e;--x:1"]) assert.equal(core.resolveAccent(bad),"#0f766e",String(bad));
});
test("Accent: accentProperties sets --accent and the --teal alias to the same value",()=>{
  /* F1: accentProperties also sets --accent-on (text on accent surfaces)
     and --accent-dark/--accent-ink (readable accent text on cards). Purple
     keeps white ink and its own dark form; an invalid value falls back to
     the default teal in every property. */
  assert.deepEqual(core.accentProperties("#7c3aed"),{"--accent":"#7c3aed","--teal":"#7c3aed","--accent-on":"#ffffff","--accent-dark":"#7c3aed","--accent-ink":"#7c3aed"});
  assert.deepEqual(core.accentProperties("not-a-colour"),{"--accent":"#0f766e","--teal":"#0f766e","--accent-on":"#ffffff","--accent-dark":"#0f766e","--accent-ink":"#0f766e"});
});
test("Accent: light accents get dark ink and a darkened readable form (F1)",()=>{
  for(const a of ["#ffffff","#ffff00","#ea580c"]){
    assert.equal(core.accentOn(a),"#111827",a+" must use dark ink, not white");
    assert.ok(core.contrastRatioHex(core.accentOn(a),a)>=4.5,a+" ink contrast");
    assert.ok(core.contrastRatioHex(core.accentReadableOn(a,"light"),"#ffffff")>=4.5,a+" readable form on white");
  }
  for(const a of ["#000000","#7c3aed","#0f766e"]){
    assert.equal(core.accentOn(a),"#ffffff",a+" keeps white ink");
    assert.ok(core.contrastRatioHex(core.accentOn(a),a)>=4.5,a+" ink contrast");
  }
  /* Every accent in the smoke set reads at 4.5:1 both as button text (ink on
     accent) and as a score number (readable form on the card), light theme. */
  for(const a of ["#ffffff","#ffff00","#000000","#7c3aed","#ea580c","#0f766e"]){
    assert.ok(core.contrastRatioHex(core.accentOn(a),a)>=4.5,"button text "+a);
    assert.ok(core.contrastRatioHex(core.accentReadableOn(a,"light"),"#ffffff")>=4.5,"score number "+a);
  }
});
test("Health Check: an https-to-http downgrade fails the HTTPS check (F14d)",()=>{
  const base={url:"https://example.com",title:"A perfectly sized example title here!",desc:"A meta description that is long enough to pass the one hundred and twenty character minimum and stays under the one sixty maximum.",h1s:1,imgs:2,noAlt:0,viewport:true,psiScore:82,sfScore:87,sfGrade:"Good"};
  assert.equal(core.healthChecks({...base,finalUrl:"http://example.com/"}).find(c=>c.name==="HTTPS").pass,false);
  assert.match(core.healthChecks({...base,finalUrl:"http://example.com/"}).find(c=>c.name==="HTTPS").detail,/redirected to plain HTTP/);
  assert.equal(core.healthChecks({...base,finalUrl:"https://example.com/"}).find(c=>c.name==="HTTPS").pass,true);
  assert.equal(core.healthChecks(base).find(c=>c.name==="HTTPS").pass,true); /* no finalUrl: input URL is the evidence */
});
test("Speed Score: a metric with nothing to measure is N/A and excluded (R1)",()=>{
  /* No images at all: Images is N/A, the score rescales to 100 over the
     other 85 points (78 earned -> 92). The old code awarded 15/15. */
  const noImg=core.scoreSpeedMetrics({ttfbMs:100,bytes:1000,textBytes:1000,blocking:0,compressed:true,encoding:"",cache:"",imgs:0,sized:0,raster:0,modern:0,resources:1});
  const imgRow=noImg.rows.find(r=>r.name==="Images");
  assert.equal(imgRow.na,true); assert.equal(imgRow.pts,null);
  assert.match(imgRow.detail,/not applicable/);
  assert.equal(noImg.score,92);
  /* Vector-only images: the format half is N/A, Images scores out of 7
     (dimensions only) and the total rescales over 92 points (85 -> 92). */
  const vec=core.scoreSpeedMetrics({ttfbMs:100,bytes:1000,textBytes:1000,blocking:0,compressed:true,encoding:"",cache:"",imgs:2,sized:2,raster:0,modern:0,resources:1});
  const vecRow=vec.rows.find(r=>r.name==="Images");
  assert.equal(vecRow.pts,7); assert.equal(vecRow.max,7);
  assert.match(vecRow.detail,/not applicable/);
  assert.equal(vec.score,92);
  /* A normal page is unchanged: all metrics applicable, score out of 100. */
  const full=core.scoreSpeedMetrics({ttfbMs:150,bytes:80000,textBytes:80000,blocking:0,compressed:true,encoding:"",cache:"public, max-age=31536000, immutable",imgs:2,sized:2,raster:2,modern:2,resources:12});
  assert.equal(full.score,100);
  assert.equal(full.rows.filter(r=>r.na).length,0);
});
test("Accent: applyAccent writes both properties on the root and returns the resolved accent",()=>{
  const seen={};
  const root={style:{setProperty:(k,v)=>{seen[k]=v;}}};
  /* F1: applyAccent also writes --accent-on (dark ink for orange, whose
     white-on-accent contrast is only 3.56:1) and the darkened readable form. */
  assert.equal(core.applyAccent(root,"#ea580c"),"#ea580c");
  assert.deepEqual(seen,{"--accent":"#ea580c","--teal":"#ea580c","--accent-on":"#111827","--accent-dark":"#c74b0a","--accent-ink":"#c74b0a"});
  assert.equal(core.applyAccent(root,"red;display:none"),"#0f766e");
  assert.deepEqual(seen,{"--accent":"#0f766e","--teal":"#0f766e","--accent-on":"#ffffff","--accent-dark":"#0f766e","--accent-ink":"#0f766e"});
  assert.equal(core.applyAccent(null,"#7c3aed"),"#7c3aed"); /* no root: no throw */
  assert.equal(core.applyAccent({},"#7c3aed"),"#7c3aed"); /* no style object: no throw */
});
test("Accent: a stored accent survives the validate/store round-trip (persistence)",()=>{
  const stored=JSON.stringify(core.validatePreferences({accent:"#7c3aed"}));
  assert.equal(core.validatePreferences(JSON.parse(stored)).accent,"#7c3aed");
  assert.equal(core.validatePreferences(JSON.parse(stored)).theme,"system");
  assert.equal(core.validatePreferences({accent:"red"}).accent,"#0f766e");
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
test("Health Check rules: a missing Speed Score never prints undefined/100",()=>{
  const base={url:"https://example.com",title:"A perfectly sized example title here!",desc:"A meta description that is long enough to pass the one hundred and twenty character minimum and stays under the one sixty maximum.",h1s:1,imgs:2,noAlt:0,viewport:true,psiScore:82};
  const row=core.healthChecks(base).find(c=>c.name==="SEOForge Speed Score");
  assert.equal(row.warn,true);
  assert.equal(row.pass,false);
  assert.doesNotMatch(row.detail,/undefined/);
  assert.match(row.detail,/could not be measured/);
  const zero=core.healthChecks({...base,sfScore:0,sfGrade:"Poor"}).find(c=>c.name==="SEOForge Speed Score");
  assert.equal(zero.pass,false);
  assert.match(zero.detail,/^0\/100/);
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
