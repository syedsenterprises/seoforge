const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
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
      await page.route("**/*",route=>{
        const url=route.request().url();
        if(url.startsWith(base)) return route.continue();
        if(url.endsWith("/functions/v1/status")) return route.fulfill({contentType:"application/json",body:JSON.stringify({google:false,billing:false,email:false,emailScheduled:false})});
        return route.abort();
      });
      /* 1. Landing: hero + three paths, dark theme pre-applied, no app.js. */
      await page.goto(base,{waitUntil:"networkidle"});
      assert.match(await page.locator("body").innerText(),/Create free account/);
      assert.match(await page.locator("body").innerText(),/Continue without an account/);
      assert.equal(await page.locator(".feature").first().evaluate(el=>getComputedStyle(el).backgroundColor),"rgb(30, 41, 59)");
      assert.equal(await page.locator(".price-card").first().evaluate(el=>getComputedStyle(el).backgroundColor),"rgb(30, 41, 59)");
      assert.ok(!(await page.content()).includes("assets/app.js"),"landing must not load app.js");
      /* 1b. Landing (v2.11.0): the three paths are real buttons, the showcase
         tabs swap, the try-it box answers, the pricing toggle swaps prices,
         the hero widget validates its input without any network. */
      assert.equal(await page.locator('a.btn[href="./app.html#auth=signup"]').count(),14);
      assert.ok(await page.locator(".landing-header img").isVisible());
      await page.locator('button[data-showcase="keywords"]').click();
      assert.ok(await page.locator("#showcase-keywords").isVisible());
      assert.ok(await page.locator("#showcase-audit").isHidden());
      await page.locator("#tryKw").fill("ai tools");
      await page.locator("#tryKwBtn").click();
      assert.match(await page.locator("#tryKwOut").innerText(),/Sample suggestions for "ai tools"/);
      await page.locator('button[data-billing="yearly"]').click();
      assert.match(await page.locator("#pricing").innerText(),/\$90\/year/);
      assert.match(await page.locator("#pricing").innerText(),/Custom/);
      await page.locator("#heroAuditBtn").click();
      assert.match(await page.locator("#heroAuditOut").innerText(),/Enter a site URL first/);
      assert.equal(await page.locator("#pricing .price-card").count(),4);
      /* 1c. Share deep link: the Health Check opens with the URL prefilled. */
      await page.goto(base+"/app.html#tab=health&url=https%3A%2F%2Fexample.com",{waitUntil:"networkidle"});
      assert.ok(await page.locator("#tab-health").isVisible());
      assert.equal(await page.locator("#hcUrl").inputValue(),"https://example.com");
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
      await context.close();
      console.log("PASS browser flows at "+viewport.width+"px: landing split, deep links, sidebar/bottom bar, persisted customization, rank/revenue CRUD, export, forged billing return");
    }
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
