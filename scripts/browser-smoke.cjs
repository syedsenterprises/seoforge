const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
/* Colour helpers for the accent checks: getComputedStyle returns solid
   colours as rgb()/rgba() but color-mix() tints as color(srgb r g b) in
   this Chromium — both forms parse to 0–255 channels here. */
function parseColor(s){
  let m=/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(s||"");
  if(m) return [+m[1],+m[2],+m[3]];
  m=/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/.exec(s||"");
  if(m) return [+m[1]*255,+m[2]*255,+m[3]*255];
  throw new Error("unparsable colour: "+s);
}
function luminance(rgb){
  const f=v=>{ v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4); };
  return 0.2126*f(rgb[0])+0.7152*f(rgb[1])+0.0722*f(rgb[2]);
}
function contrastRatio(fg,bg){
  const a=luminance(parseColor(fg)), b=luminance(parseColor(bg));
  return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
}
(async()=>{
  const root=process.cwd();
  const server=http.createServer(async(req,res)=>{
    try {
      const pathname=decodeURIComponent(new URL(req.url,"http://localhost").pathname);
      const file=path.resolve(root,"."+ (pathname==="/" ? "/index.html" : pathname));
      if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
      const types={".html":"text/html",".js":"text/javascript",".css":"text/css",".png":"image/png"};
      res.setHeader("Content-Type",types[path.extname(file)]||"text/plain");
      res.end(await fs.readFile(file));
    }catch{res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const base="http://127.0.0.1:"+server.address().port;
  const browser=await chromium.launch();
  await fs.mkdir("test-results",{recursive:true});
  try {
    for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
      const context=await browser.newContext({viewport,acceptDownloads:true,colorScheme:"dark"});
      const page=await context.newPage();
      const errors=[]; page.on("pageerror",e=>errors.push(e.message));
      /* Console errors, captured on every step (landing, app load, tool runs).
         The route stubs below abort all real network, so failed-resource
         messages for those stubbed requests are harness noise and are
         filtered out of the assertion — but still printed for the report. */
      const consoleErrors=[]; page.on("console",m=>{ if(m.type()==="error") consoleErrors.push(m.text()); });
      /* Log every aborted URL and every failed request, so the console-error
         report names the exact URLs instead of guessing at harness noise. */
      const failedRequests=[]; page.on("requestfailed",r=>failedRequests.push(r.url()+" :: "+(r.failure()&&r.failure().errorText||"")));
      await page.route("**/*",route=>{
        const url=route.request().url();
        if(url.startsWith(base)) return route.continue();
        if(url.endsWith("/functions/v1/status")) return route.fulfill({contentType:"application/json",body:JSON.stringify({google:false,billing:false,email:false,emailScheduled:false})});
        /* Canned edge responses so the hero audit (a real tool run) executes
           end to end with no live network: a tiny example.com page and a
           PageSpeed 73 for it. */
        if(url.endsWith("/functions/v1/fetch-proxy")) return route.fulfill({contentType:"application/json",body:JSON.stringify({status:200,ok:true,text:'<!doctype html><html><head><title>Example Domain</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><h1>Example Domain</h1><p>Example.</p></body></html>',ttfbMs:89,totalMs:95,bytes:577,compressed:null,headers:{encoding:"",cache:"",server:"",type:"text/html"}})});
        if(url.endsWith("/functions/v1/pagespeed")) return route.fulfill({contentType:"application/json",body:JSON.stringify({score:73,lcp:"4.4 s",cls:"0",seo:[],finalUrl:"https://example.com/"})});
        console.log("SMOKE-ABORTED["+viewport.width+"]:",url);
        return route.abort();
      });
      /* 1. Landing: hero + three paths, light theme by default (no app.js).
         The context is dark-OS, so this also proves the default is light
         even when the OS is dark — a new visitor never gets a dark first
         paint. */
      await page.goto(base,{waitUntil:"networkidle"});
      assert.equal(await page.locator("html").getAttribute("data-theme"),null,"no dark theme without a stored pick");
      assert.match(await page.locator("body").innerText(),/Create free account/);
      assert.match(await page.locator("body").innerText(),/Continue without an account/);
      assert.equal(await page.locator(".feature").first().evaluate(el=>getComputedStyle(el).backgroundColor),"rgb(255, 255, 255)");
      assert.equal(await page.locator(".price-card").first().evaluate(el=>getComputedStyle(el).backgroundColor),"rgb(255, 255, 255)");
      assert.ok(!(await page.content()).includes("assets/app.js"),"landing must not load app.js");
      /* 1b. Landing (v2.11.0): the three paths are real buttons, the showcase
         tabs swap, the try-it box answers, the pricing toggle swaps prices,
         the hero widget validates its input without any network. */
      assert.equal(await page.locator('a.btn[href="./app.html#auth=signup"]').count(),6); /* header + hero + 3 pricing cards + closing — no repeats after sections */
      assert.ok(await page.locator(".landing-header img").isVisible());
      /* 1a2. Header nav is legible: the header is an accent tint in both
         themes (never a hardcoded dark block), and its text is the theme
         ink — light theme ink is the dark slate, so the nav colour is the
         light-theme value, not the dark-theme near-white. */
      const landingHeaderBg=await page.locator(".landing-header").evaluate(el=>getComputedStyle(el).backgroundColor);
      assert.notEqual(landingHeaderBg,"rgb(15, 23, 42)","landing header must be an accent tint, not a hardcoded dark block");
      assert.equal(await page.locator(".landing-nav a").first().evaluate(el=>getComputedStyle(el).color),"rgb(31, 41, 55)");
      assert.ok(contrastRatio(await page.locator(".landing-nav a").first().evaluate(el=>getComputedStyle(el).color),landingHeaderBg)>=4.5,"header nav contrast "+landingHeaderBg);
      /* 1a4. Mobile header: hamburger at 390px, inline nav at 1440px. */
      if(viewport.width<768){
        assert.ok(await page.locator("#landingNavToggle").isVisible(),"hamburger visible on mobile");
        assert.ok(await page.locator(".landing-nav-panel").isHidden(),"nav panel closed by default");
        await page.locator("#landingNavToggle").click();
        assert.equal(await page.locator("#landingNavToggle").getAttribute("aria-expanded"),"true");
        assert.ok(await page.locator(".landing-nav-panel").isVisible(),"panel opens on tap");
        assert.ok(await page.locator('.landing-nav-panel a[href="#pricing"]').isVisible(),"panel shows nav links");
        assert.ok(await page.locator('.landing-nav-panel a[href="./app.html#auth=signup"]').isVisible(),"panel shows Create free account");
        await page.locator('.landing-nav-panel a[href="#pricing"]').click();
        assert.equal(await page.locator("#landingNavToggle").getAttribute("aria-expanded"),"false");
        assert.ok(await page.locator(".landing-nav-panel").isHidden(),"panel closes after a link tap");
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),"no horizontal overflow at 390px");
      }else{
        assert.ok(await page.locator("#landingNavToggle").isHidden(),"no hamburger on desktop");
        assert.ok(await page.locator(".landing-nav").isVisible(),"inline nav on desktop");
        assert.ok(await page.locator(".landing-auth").isVisible(),"inline auth buttons on desktop");
      }
      /* 1a3. Showcase arithmetic: the demo table shows 4 Pass + 1 warn + 2 Fail. */
      assert.match(await page.locator("#showcase-audit").innerText(),/4 of 7 checks passed/);
      assert.ok(!(await page.locator("#showcase-audit").innerText()).includes("6 of 7"));
      assert.equal(await page.locator("#showcase-audit table tr").count(),9); /* header row + 8 checks (Speed Score row is "not measured") */
      /* 1b2. Hero audit, end to end on canned edge data: Speed Score leads,
         PageSpeed is a secondary line stamped with the run time, and the
         varies-run-to-run note is present. */
      await page.locator("#heroUrl").fill("https://example.com");
      await page.locator("#heroAuditBtn").click();
      await page.waitForFunction(()=>document.querySelector("#heroAuditOut").innerText.includes("checks passed"),null,{timeout:20000});
      const heroText=await page.locator("#heroAuditOut").innerText();
      assert.match(heroText,/SEOForge Speed Score — 82\/100 \(Good\)/); /* R1: the canned page has no images, so Images is N/A and excluded — 70 earned over an 85 applicable max (25+15+20+0 compression unmeasured+0 caching+10 requests), 70/85 = 82. Was 85 when the N/A row scored a perfect 15/15. */
      assert.match(heroText,/6 of 8 checks passed/);
      assert.match(heroText,/PageSpeed \(mobile\) 73\/100 at \d\d:\d\d/);
      assert.match(heroText,/varies run to run/);
      assert.match(heroText,/Share your score/);
      await page.locator('button[data-showcase="keywords"]').click();
      assert.ok(await page.locator("#showcase-keywords").isVisible());
      assert.ok(await page.locator("#showcase-audit").isHidden());
      await page.locator("#tryKw").fill("ai tools");
      await page.locator("#tryKwBtn").click();
      assert.match(await page.locator("#tryKwOut").innerText(),/Sample suggestions for "ai tools"/);
      await page.locator('button[data-billing="yearly"]').click();
      assert.match(await page.locator("#pricing").innerText(),/\$90\/year/);
      assert.match(await page.locator("#pricing").innerText(),/Custom/);
      await page.locator("#heroUrl").fill(""); /* 1b2 above filled it; empty it for the validation check */
      await page.locator("#heroAuditBtn").click();
      assert.match(await page.locator("#heroAuditOut").innerText(),/Enter a site URL first/);
      assert.equal(await page.locator("#pricing .price-card").count(),4);
      /* 1b3. Auth view: one mode at a time. Signup shows the Create heading
         with exactly one primary button (Create), no Sign in button and no
         Reset password; the mode-switch link flips to sign-in, which shows
         the Sign in heading with exactly one primary button (Sign in) plus
         Reset password. Google + the guest text link are present in both
         modes; the app header is minimal while the card is up. */
      await page.goto(base+"/app.html#auth=signup",{waitUntil:"networkidle"});
      assert.ok(await page.locator("#authView").isVisible(),"auth view shows for #auth=signup");
      assert.equal(await page.locator("#authViewTitle").innerText(),"Create your free account");
      assert.ok(await page.locator("#signUpBtn").isVisible(),"signup primary visible");
      assert.ok(await page.locator("#signInBtn").isHidden(),"no Sign in button in signup mode");
      assert.ok(await page.locator("#forgotPassword").isHidden(),"no Reset password in signup mode");
      assert.ok(await page.locator("#googleSignInBtn").isVisible(),"Google button present in signup mode");
      assert.ok(await page.locator("#authGuestLink").isVisible(),"guest text link present in signup mode");
      assert.equal(await page.locator("#authModeSwitch").innerText(),"Already have an account? Sign in");
      assert.ok(await page.locator("#siteSwitcher").isHidden(),"minimal header on the auth view: no site switcher");
      assert.ok(await page.locator("#globalSearchWrap").isHidden(),"minimal header on the auth view: no search");
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),"no horizontal overflow on the signup view at "+viewport.width+"px");
      await page.screenshot({path:"test-results/auth-signup-"+viewport.width+".png"});
      await page.locator("#authModeSwitch").click();
      await page.waitForFunction(()=>document.querySelector("#authViewTitle").innerText==="Sign in to SEOForge",null,{timeout:5000});
      assert.ok(await page.locator("#signInBtn").isVisible(),"signin primary visible after the mode switch");
      assert.ok(await page.locator("#signUpBtn").isHidden(),"no Create button in signin mode");
      assert.ok(await page.locator("#forgotPassword").isVisible(),"Reset password shows in signin mode");
      assert.ok(await page.locator("#googleSignInBtn").isVisible(),"Google button present in signin mode");
      assert.ok(await page.locator("#authGuestLink").isVisible(),"guest text link present in signin mode");
      assert.equal(await page.locator("#authModeSwitch").innerText(),"No account yet? Create a free account");
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),"no horizontal overflow on the signin view at "+viewport.width+"px");
      await page.screenshot({path:"test-results/auth-signin-"+viewport.width+".png"});
      /* 1c. Share deep link: the Health Check opens with the URL prefilled. */
      await page.goto(base+"/app.html#tab=health&url=https%3A%2F%2Fexample.com",{waitUntil:"networkidle"});
      assert.ok(await page.locator("#tab-health").isVisible());
      assert.equal(await page.locator("#hcUrl").inputValue(),"https://example.com");
      /* 1d. F12: back/forward to an already-run share URL does not re-run or
         re-save the health check (it would burn Free quota). This goto is a
         fresh page load, so the share run happens once; then dashboard, then
         browser Back to the same hash — the hashchange handler must skip the
         run because (health, url) already ran this page load. */
      await page.goto(base+"/app.html#tab=health&url=https%3A%2F%2Fexample.com",{waitUntil:"networkidle"});
      await page.waitForFunction(()=>document.querySelector("#hcOut").innerText.includes("checks passed"),null,{timeout:20000});
      const auditsAfterRun=await page.evaluate(()=>JSON.parse(localStorage.getItem("syedSuite.audits")||"[]").length);
      assert.ok(auditsAfterRun>=1,"the share health check saved one audit row");
      if(viewport.width>=900) await page.locator('#sidebar button[data-tab="dashboard"]').click();
      else await page.locator('#bottomNav button[data-tab="dashboard"]').click();
      assert.ok(await page.locator("#tab-dashboard").isVisible());
      await page.goBack({waitUntil:"networkidle"});
      await page.waitForTimeout(2000);
      assert.ok(await page.locator("#tab-health").isVisible(),"back returns to the Health tab");
      const auditsAfterBack=await page.evaluate(()=>JSON.parse(localStorage.getItem("syedSuite.audits")||"[]").length);
      assert.equal(auditsAfterBack,auditsAfterRun,"back to an already-run share URL must not re-run or re-save (audits "+auditsAfterRun+" -> "+auditsAfterBack+")");
      console.log("F12["+viewport.width+"]: share health check ran once ("+auditsAfterRun+" audit row(s)); back did not re-run");
      /* 2. Continue without an account -> app shell, auth view hidden. */
      await page.goto(base,{waitUntil:"networkidle"}); /* 1c left the page on app.html */
      await page.locator('a[href="./app.html#guest"]').first().click();
      await page.waitForURL("**/app.html#guest");
      assert.ok(await page.locator("#appShell").isVisible());
      assert.ok(await page.locator("#authView").isHidden());
      /* 3. All 19 tools reachable via deep links. */
      const tabs=["dashboard","audit","health","bulk","keywords","rank","compete","links","broken","redirect","brief","serp","schema","robots","gsc","ads","market","estimator","preferences"];
      for(const name of tabs){
        await page.goto(base+"/app.html#tab="+name,{waitUntil:"networkidle"});
        assert.ok(await page.locator("#tab-"+name).isVisible(),"tab "+name);
      }
      /* 3b. Unknown #tab= falls back to the Dashboard with a note, never a
         silent stay on the previous tab. */
      await page.goto(base+"/app.html#tab=keyword",{waitUntil:"networkidle"});
      assert.ok(await page.locator("#tab-dashboard").isVisible(),"unknown tab falls back to dashboard");
      assert.match(await page.locator("#topBanner").innerText(),/Unknown section/);
      /* 4. Sidebar click (desktop) / bottom bar + drawer (mobile). */
      if(viewport.width>=900){
        await page.goto(base+"/app.html#guest",{waitUntil:"networkidle"});
        await page.locator('#sidebar button[data-tab="rank"]').click();
        assert.ok(await page.locator("#tab-rank").isVisible());
      }else{
        await page.goto(base+"/app.html#guest",{waitUntil:"networkidle"});
        await page.locator('#bottomNav button[data-tab="rank"]').click();
        assert.ok(await page.locator("#tab-rank").isVisible());
        await page.locator("#navToggle").click();
        assert.ok(await page.locator("#sidebar").isVisible());
        await page.locator('#sidebar button[data-tab="audit"]').click();
        assert.ok(await page.locator("#tab-audit").isVisible());
      }
      /* 5. Preferences persist across reload (guest mode). */
      await page.goto(base+"/app.html#tab=preferences",{waitUntil:"networkidle"});
      await page.locator("#prefBrand").fill("SEOForge release test");
      await page.locator("#prefTheme").selectOption("dark");
      await page.locator("#prefDensity").selectOption("compact");
      await page.locator("#prefSite").fill("https://example.com");
      await page.locator("#prefSave").click();
      assert.equal(await page.locator("html").getAttribute("data-theme"),"dark");
      await page.reload({waitUntil:"networkidle"});
      assert.ok(await page.locator("#appShell").isVisible(),"guest session survives reload");
      await page.goto(base+"/app.html#tab=preferences",{waitUntil:"networkidle"});
      assert.equal(await page.locator("#prefBrand").inputValue(),"SEOForge release test");
      assert.equal(await page.locator("#prefDensity").inputValue(),"compact");
      await page.screenshot({path:"test-results/preferences-"+viewport.width+".png",fullPage:true});
      /* 6. Rank + revenue CRUD. */
      await page.goto(base+"/app.html#tab=rank",{waitUntil:"networkidle"});
      await page.locator("#rkKw").fill("release test keyword");
      await page.locator("#rkUrl").fill("https://example.com");
      await page.locator("#rkAddBtn").click();
      assert.match(await page.locator("#rkList").innerText(),/release test keyword/);
      await page.goto(base+"/app.html#tab=ads",{waitUntil:"networkidle"});
      await page.locator("#revDate").fill("2026-11-23");
      await page.locator("#revAmt").fill("12.34");
      await page.locator("#revAddBtn").click();
      assert.match(await page.locator("#revTotals").innerText(),/12.34/);
      /* 6b. The last-run Site Audit URL survives a reload (guest-safe
         localStorage). example.org, not example.com, so the saved
         preferences default site (step 5) cannot make this pass by accident. */
      await page.goto(base+"/app.html#tab=audit",{waitUntil:"networkidle"});
      await page.locator("#auditUrl").fill("https://example.org");
      await page.locator("#auditBtn").click();
      await page.waitForFunction(()=>document.querySelector("#auditOut").innerText.length>0,null,{timeout:20000});
      await page.reload({waitUntil:"networkidle"});
      await page.goto(base+"/app.html#tab=audit",{waitUntil:"networkidle"});
      assert.equal(await page.locator("#auditUrl").inputValue(),"https://example.org");
      /* 7. Export (version 2, no psiKey). */
      await page.goto(base+"/app.html#tab=preferences",{waitUntil:"networkidle"});
      const downloadPromise=page.waitForEvent("download");
      await page.locator("#backupExport").click();
      const download=await downloadPromise;
      const data=JSON.parse(await fs.readFile(await download.path(),"utf8"));
      assert.equal(data.version,2);
      assert.ok(data.data.keywords.some(k=>k.keyword==="release test keyword"));
      assert.equal(data.data.revenue[0].amount,12.34);
      assert.ok(!JSON.stringify(data).includes("psiKey"));
      /* 8. Forged billing return on app.html. */
      await page.goto(base+"/app.html?subscription_id=I-FORGED",{waitUntil:"networkidle"});
      assert.match(await page.locator("#topBanner").innerText(),/not payment verification/);
      assert.deepEqual(errors,[]);
      /* 8b. Accent theming: one stored accent re-themes landing + app.
         Default first (step 5 saved the default teal), then two non-default
         accents — purple #7c3aed and orange #ea580c. For each: the landing
         header, landing footer, app header, a primary button and the Good
         score ring must ACTUALLY change colour (computed style differs from
         the default); header/footer text must stay readable in both the
         tint and the footer tint (contrast ratios asserted, not eyeballed).
         The Settings save is also checked live: picking a new accent in
         Workspace settings re-themes the app header with no reload. */
      const measureLanding=async()=>{
        await page.goto(base,{waitUntil:"networkidle"});
        await page.locator("#heroUrl").fill("https://example.com");
        await page.locator("#heroAuditBtn").click();
        await page.waitForFunction(()=>document.querySelector("#heroAuditOut").innerText.includes("checks passed"),null,{timeout:20000});
        return {
          headerBg:await page.locator(".landing-header").evaluate(el=>getComputedStyle(el).backgroundColor),
          headerText:await page.locator(".landing-header").evaluate(el=>getComputedStyle(el).color),
          navColor:await page.locator(".landing-nav a").first().evaluate(el=>getComputedStyle(el).color),
          footerBg:await page.locator(".landing-footer").evaluate(el=>getComputedStyle(el).backgroundColor),
          footerText:await page.locator(".landing-footer").evaluate(el=>getComputedStyle(el).color),
          footerH4:await page.locator(".footer-cols h4").first().evaluate(el=>getComputedStyle(el).color),
          heroBtn:await page.locator(".hero .cta a.btn").first().evaluate(el=>getComputedStyle(el).backgroundColor),
          heroBtnText:await page.locator(".hero .cta a.btn").first().evaluate(el=>getComputedStyle(el).color),
          ring:await page.locator("#heroAuditOut svg circle.score-ring").evaluate(el=>getComputedStyle(el).stroke),
          accentVar:await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()),
          tealVar:await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue("--teal").trim()),
        };
      };
      const measureApp=async()=>{
        await page.goto(base+"/app.html#guest",{waitUntil:"networkidle"});
        return {
          headerBg:await page.locator("header").first().evaluate(el=>getComputedStyle(el).backgroundColor),
          headerText:await page.locator("header").first().evaluate(el=>getComputedStyle(el).color),
          primaryBtn:await page.locator("#agentBtn").evaluate(el=>getComputedStyle(el).backgroundColor),
          primaryBtnText:await page.locator("#agentBtn").evaluate(el=>getComputedStyle(el).color),
          footerBg:await page.locator("footer").first().evaluate(el=>getComputedStyle(el).backgroundColor),
          footerText:await page.locator("footer").first().evaluate(el=>getComputedStyle(el).color),
          accentVar:await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()),
        };
      };
      const assertReadable=(label,m)=>{
        const hc=contrastRatio(m.headerText,m.headerBg), nc=contrastRatio(m.navColor||m.headerText,m.headerBg);
        const fc=contrastRatio(m.footerText,m.footerBg), h4c=m.footerH4?contrastRatio(m.footerH4,m.footerBg):null;
        console.log("ACCENT-READABILITY["+viewport.width+" "+label+"]: header "+hc.toFixed(2)+" nav "+nc.toFixed(2)+" footer "+fc.toFixed(2)+(h4c!=null?" footer-h4 "+h4c.toFixed(2):"")+" | header "+m.headerText+" on "+m.headerBg+" | footer "+m.footerText+" on "+m.footerBg);
        assert.ok(hc>=4.5,label+" header text/background contrast "+hc.toFixed(2));
        assert.ok(nc>=4.5,label+" header nav contrast "+nc.toFixed(2));
        assert.ok(fc>=3.5,label+" footer text/background contrast "+fc.toFixed(2));
        if(h4c!=null) assert.ok(h4c>=4.5,label+" footer heading contrast "+h4c.toFixed(2));
      };
      const defLanding=await measureLanding();
      const defApp=await measureApp();
      assert.equal(defLanding.accentVar,"#0f766e","default --accent");
      assert.equal(defLanding.tealVar,"#0f766e","--teal alias follows the default accent");
      assert.equal(defLanding.heroBtn,"rgb(15, 118, 110)","default primary button is the default teal");
      assert.equal(defLanding.ring,"rgb(15, 118, 110)","default Good score ring is the default teal");
      assert.equal(defApp.primaryBtn,"rgb(15, 118, 110)","default app primary button is the default teal");
      assert.equal(defApp.headerBg,defLanding.headerBg,"app and landing headers agree on the default accent");
      assert.equal(defApp.footerBg,defLanding.footerBg,"app and landing footers agree on the default accent");
      assertReadable("default teal",defLanding);
      console.log("ACCENT-DEFAULT["+viewport.width+"]: header "+defLanding.headerBg+" footer "+defLanding.footerBg+" button/ring "+defLanding.heroBtn);
      /* F1: light accents (#ffffff, #ffff00) must get dark ink on accent
         surfaces — white text on a white/yellow button was 1.00:1 / 1.07:1.
         Ring expectations (F1): a light accent's ring takes the darkened
         readable form (--accent-dark), not the accent itself — white
         #737373 and yellow #737300 in the light theme. Orange's ring in the
         dark theme is its lightened --accent-dark #ec6924, not #ea580c. */
      for(const {hex,rgb,ringRgb,btnText,theme} of [
        {hex:"#7c3aed",rgb:"rgb(124, 58, 237)",ringRgb:"rgb(124, 58, 237)",btnText:"rgb(255, 255, 255)",theme:"system"},
        {hex:"#ea580c",rgb:"rgb(234, 88, 12)",ringRgb:"rgb(236, 105, 36)",btnText:"rgb(17, 24, 39)",theme:"system"},
        {hex:"#ffffff",rgb:"rgb(255, 255, 255)",ringRgb:"rgb(115, 115, 115)",btnText:"rgb(17, 24, 39)",theme:"light"},
        {hex:"#ffff00",rgb:"rgb(255, 255, 0)",ringRgb:"rgb(115, 115, 0)",btnText:"rgb(17, 24, 39)",theme:"light"},
      ]){
        /* Persistence: the stored accent survives a reload on the landing. */
        await page.evaluate(([a,t])=>{ localStorage.setItem("syedSuite.preferences",JSON.stringify({theme:t,accent:a,density:"comfortable",brand:"SEOForge",defaultSite:"",strategy:"mobile"})); },[hex,theme]);
        const land=await measureLanding();
        assert.equal(land.accentVar,hex,"landing --accent for "+hex);
        assert.equal(land.tealVar,hex,"landing --teal alias for "+hex);
        assert.equal(land.heroBtn,rgb,"landing primary button for "+hex);
        assert.equal(land.heroBtnText,btnText,"landing primary button TEXT for "+hex+" (F1 luminance guard)");
        assert.ok(contrastRatio(land.heroBtnText,land.heroBtn)>=4.5,hex+" button text/background contrast "+contrastRatio(land.heroBtnText,land.heroBtn).toFixed(2));
        assert.equal(land.ring,ringRgb,"Good score ring for "+hex);
        assert.notEqual(land.headerBg,defLanding.headerBg,"landing header changes for "+hex);
        assert.notEqual(land.footerBg,defLanding.footerBg,"landing footer changes for "+hex);
        assert.notEqual(land.heroBtn,defLanding.heroBtn,"landing primary button changes for "+hex);
        assert.notEqual(land.ring,defLanding.ring,"score ring changes for "+hex);
        assertReadable(hex,land);
        /* Live apply: changing the accent in Settings re-themes the app
           header immediately, with no reload. */
        await page.goto(base+"/app.html#tab=preferences",{waitUntil:"networkidle"});
        await page.locator("#prefAccent").fill(hex);
        await page.locator("#prefSave").click();
        const liveHeaderBg=await page.locator("header").first().evaluate(el=>getComputedStyle(el).backgroundColor);
        const liveAccent=await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
        assert.equal(liveAccent,hex,"Settings save applies --accent live for "+hex);
        assert.equal(liveHeaderBg,land.headerBg,"app header re-themes live for "+hex+" (no reload)");
        assert.equal(await page.locator("#agentBtn").evaluate(el=>getComputedStyle(el).backgroundColor),rgb,"app primary button re-themes live for "+hex);
        assert.equal(await page.locator("#agentBtn").evaluate(el=>getComputedStyle(el).color),btnText,"app primary button text for "+hex+" (F1)");
        assert.ok(contrastRatio(await page.locator("#agentBtn").evaluate(el=>getComputedStyle(el).color),await page.locator("#agentBtn").evaluate(el=>getComputedStyle(el).backgroundColor))>=4.5,hex+" app button contrast");
        /* Persistence on the app side too: the pick survives a reload. */
        const app=await measureApp();
        assert.equal(app.accentVar,hex,"app --accent persists for "+hex);
        assert.equal(app.headerBg,land.headerBg,"app and landing headers agree for "+hex);
        assert.equal(app.footerBg,land.footerBg,"app and landing footers agree for "+hex);
        assert.equal(app.primaryBtn,rgb,"app primary button for "+hex);
        assert.equal(app.primaryBtnText,btnText,"app primary button text for "+hex);
        assert.notEqual(app.headerBg,defApp.headerBg,"app header changes for "+hex);
        assert.ok(contrastRatio(app.headerText,app.headerBg)>=4.5,hex+" app header contrast");
        assert.ok(contrastRatio(app.footerText,app.footerBg)>=3.5,hex+" app footer contrast");
        console.log("ACCENT["+viewport.width+" "+hex+"]: landing header "+land.headerBg+" footer "+land.footerBg+" button "+rgb+" button-text "+btnText+" ring "+ringRgb+" (btn contrast "+contrastRatio(land.heroBtnText,land.heroBtn).toFixed(2)+")");
      }
      /* Leave the stored accent at the default so later steps (and the
         screenshots) see the standard theme. */
      await page.evaluate(()=>{ localStorage.setItem("syedSuite.preferences",JSON.stringify({theme:"light",accent:"#0f766e",density:"compact",brand:"SEOForge release test",defaultSite:"https://example.com",strategy:"mobile"})); });
      /* Console errors: only stub-induced failed-resource noise is excused. */
      const realConsoleErrors=consoleErrors.filter(t=>!/Failed to load resource|net::ERR_ABORTED|ERR_FAILED|ERR_INTERNET_DISCONNECTED/.test(t));
      if(consoleErrors.length) console.log("console errors at "+viewport.width+"px (raw):",JSON.stringify(consoleErrors));
      if(failedRequests.length) console.log("failed requests at "+viewport.width+"px:",JSON.stringify(failedRequests));
      assert.deepEqual(realConsoleErrors,[],"unexpected console errors at "+viewport.width+"px");
      await context.close();
      console.log("PASS browser flows at "+viewport.width+"px: landing split, deep links, sidebar/bottom bar, persisted customization, rank/revenue CRUD, export, forged billing return");
    }
    /* 9. Header nav is legible in the LIGHT theme too (the header is an
       accent tint in both themes — the fix must not depend on dark mode). */
    const lightCtx=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:"light"});
    const lightPage=await lightCtx.newPage();
    await lightPage.goto(base,{waitUntil:"networkidle"});
    const lightHeaderBg=await lightPage.locator(".landing-header").evaluate(el=>getComputedStyle(el).backgroundColor);
    const lightNavColor=await lightPage.locator(".landing-nav a").first().evaluate(el=>getComputedStyle(el).color);
    const lightFooterBg=await lightPage.locator(".landing-footer").evaluate(el=>getComputedStyle(el).backgroundColor);
    const lightFooterText=await lightPage.locator(".landing-footer").evaluate(el=>getComputedStyle(el).color);
    assert.notEqual(lightHeaderBg,"rgb(15, 23, 42)","light-theme header must be an accent tint, not a hardcoded dark block");
    assert.equal(lightNavColor,"rgb(31, 41, 55)","light-theme nav links are the theme ink");
    assert.ok(contrastRatio(lightNavColor,lightHeaderBg)>=4.5,"light-theme header nav contrast");
    assert.ok(contrastRatio(lightFooterText,lightFooterBg)>=3.5,"light-theme footer contrast");
    console.log("ACCENT-LIGHT: header "+lightNavColor+" on "+lightHeaderBg+" ("+contrastRatio(lightNavColor,lightHeaderBg).toFixed(2)+"), footer "+lightFooterText+" on "+lightFooterBg+" ("+contrastRatio(lightFooterText,lightFooterBg).toFixed(2)+")");
    await lightCtx.close();
    console.log("PASS landing header contrast in light theme");
    const recovery=await browser.newPage();
    await recovery.route("**/*",route=>{
      const url=route.request().url();
      if(url.startsWith(base)) return route.continue();
      if(url.includes("supabase-js")) return route.fulfill({contentType:"text/javascript",body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:cb=>setTimeout(()=>cb("PASSWORD_RECOVERY",null),10)}})};'});
      return route.abort();
    });
    await recovery.goto(base+"/app.html",{waitUntil:"networkidle"});
    assert.ok(await recovery.locator("#recoveryPassword").isVisible(),"Recovery password input must remain visible after showApp");
    await recovery.close();
    console.log("PASS recovery callback exposes the password form");
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
