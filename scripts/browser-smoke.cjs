
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
      const types={".html":"text/html",".js":"text/javascript",".css":"text/css"};
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
      await page.goto(base,{waitUntil:"networkidle"});
      assert.equal(await page.locator(".feature").first().evaluate(el=>getComputedStyle(el).backgroundColor),"rgb(30, 41, 59)");
      assert.equal(await page.locator(".price-card").first().evaluate(el=>getComputedStyle(el).backgroundColor),"rgb(30, 41, 59)");
      await page.locator("#landingLaunchBtn").click();
      assert.ok(await page.locator("#appView").isVisible());
      const tabs=await page.locator("#tabs button[data-tab]").all();
      for(const button of tabs){
        const name=await button.getAttribute("data-tab");
        await button.click();
        assert.ok(await page.locator("#tab-"+name).isVisible(),"tab "+name);
      }
      await page.locator('[data-tab="preferences"]').click();
      await page.locator("#prefBrand").fill("SEOForge release test");
      await page.locator("#prefTheme").selectOption("dark");
      await page.locator("#prefDensity").selectOption("compact");
      await page.locator("#prefSite").fill("https://example.com");
      await page.locator("#prefSave").click();
      assert.equal(await page.locator("html").getAttribute("data-theme"),"dark");
      await page.reload({waitUntil:"networkidle"});
      await page.locator("#landingLaunchBtn").click();
      await page.locator('[data-tab="preferences"]').click();
      assert.equal(await page.locator("#prefBrand").inputValue(),"SEOForge release test");
      assert.equal(await page.locator("#prefDensity").inputValue(),"compact");
      await page.screenshot({path:"test-results/preferences-"+viewport.width+".png",fullPage:true});
      await page.locator('[data-tab="rank"]').click();
      await page.locator("#rkKw").fill("release test keyword");
      await page.locator("#rkUrl").fill("https://example.com");
      await page.locator("#rkAddBtn").click();
      assert.match(await page.locator("#rkList").innerText(),/release test keyword/);
      await page.locator('[data-tab="ads"]').click();
      await page.locator("#revDate").fill("2026-11-23");
      await page.locator("#revAmt").fill("12.34");
      await page.locator("#revAddBtn").click();
      assert.match(await page.locator("#revTotals").innerText(),/12.34/);
      await page.locator('[data-tab="preferences"]').click();
      const downloadPromise=page.waitForEvent("download");
      await page.locator("#backupExport").click();
      const download=await downloadPromise;
      const data=JSON.parse(await fs.readFile(await download.path(),"utf8"));
      assert.equal(data.version,2);
      assert.ok(data.data.keywords.some(k=>k.keyword==="release test keyword"));
      assert.equal(data.data.revenue[0].amount,12.34);
      assert.ok(!JSON.stringify(data).includes("psiKey"));
      await page.goto(base+"/?subscription_id=I-FORGED",{waitUntil:"networkidle"});
      assert.match(await page.locator("#topBanner").innerText(),/not payment verification/);
      assert.deepEqual(errors,[]);
      await context.close();
      console.log("PASS browser flows at "+viewport.width+"px: all tools, persisted customization, rank/revenue CRUD, export, forged billing return");
    }
    const recovery=await browser.newPage();
    await recovery.route("**/*",route=>{
      const url=route.request().url();
      if(url.startsWith(base)) return route.continue();
      if(url.includes("supabase-js")) return route.fulfill({contentType:"text/javascript",body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:cb=>setTimeout(()=>cb("PASSWORD_RECOVERY",null),10)}})};'});
      return route.abort();
    });
    await recovery.goto(base,{waitUntil:"networkidle"});
    assert.ok(await recovery.locator("#recoveryPassword").isVisible(),"Recovery password input must remain visible after showApp");
    await recovery.close();
    console.log("PASS recovery callback exposes the password form");
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
