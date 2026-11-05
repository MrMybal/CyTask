import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {mkdtemp,mkdir} from "node:fs/promises";
import {existsSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import net from "node:net";
import {chromium} from "playwright";
const root=fileURLToPath(new URL("../../../",import.meta.url));
const fixture=await mkdtemp(path.join(tmpdir(),"CyTask-help-server-"));
const output=path.join(root,".build/help-tests");await mkdir(output,{recursive:true});
const listener=net.createServer();await new Promise(resolve=>listener.listen(0,"127.0.0.1",resolve));
const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));const origin="http://127.0.0.1:"+port;
const runtime=path.join(root,".tools/dotnet",process.platform==="win32"?"dotnet.exe":"dotnet");
const environment=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.toLowerCase().startsWith("cytask__")));
const server=spawn(existsSync(runtime)?runtime:"dotnet",[path.join(root,"apps/server/src/CyTask.Api/bin/Release/net10.0/CyTask.Api.dll")],{
 cwd:path.join(root,"apps/server/src/CyTask.Api"),windowsHide:true,stdio:"ignore",
 env:{...environment,ASPNETCORE_ENVIRONMENT:"Development",ASPNETCORE_URLS:origin,ASPNETCORE_WEBROOT:path.join(root,"apps/web/dist"),
 CyTask__UseInMemoryStore:"true",CyTask__LocalMode:"false",CyTask__MfaPolicy:"disabled",CyTask__MediaStoragePath:fixture}
});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));let browser;
try{
  let ready=false;
  for(let i=0;i<150;i++){try{if((await fetch(origin+"/health/ready")).ok){ready=true;break;}}catch{}await sleep(100);}
  assert.ok(ready,"Isolated server ready");
  browser=await chromium.launch({headless:true,chromiumSandbox:true,...(process.env.CYTASK_TEST_BROWSER?{channel:process.env.CYTASK_TEST_BROWSER}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.route("**/*",route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  assert.equal((await context.request.get(origin+"/api/v1/projects")).status(),401);
  const response=await context.request.get(origin+"/help/index.html");
  assert.equal(response.status(),200);assert.match(response.headers()["content-security-policy"],/connect-src 'none'/);
  const appPolicy=(await context.request.get(origin+"/")).headers()["content-security-policy"];
  assert.match(appPolicy,/nonce-/);assert.ok(!appPolicy.includes("unsafe-inline"),"Application CSP unchanged");
  assert.equal((await context.request.get(origin+"/help/cytask-help.zip")).status(),200);
  const page=await context.newPage();
  await page.goto(origin+"/");
  await page.getByRole("link",{name:"User guide",exact:true}).waitFor();
  const result=await context.request.post(origin+"/api/v1/bootstrap",{data:{
    email:"guide-owner@fixture.invalid",displayName:"Guide owner",password:randomBytes(32).toString("base64url"),organizationName:"Guide fixture"
  }});
  assert.ok(result.ok(),"Fictional owner created");
  await page.reload();await page.locator(".server-rail-help").waitFor();
  await page.getByRole("button",{name:"Settings and tools",exact:true}).first().click();
  const entry=page.locator(".workspace-settings").getByRole("link",{name:/User guide/});
  assert.equal(await entry.getAttribute("href"),"/help/manual.html#/en/getting-started");
  const popup=context.waitForEvent("page");await entry.click();const guide=await popup;
  const errors=[];guide.on("pageerror",error=>errors.push(error.message));
  await guide.getByRole("heading",{name:"Getting started",level:1,exact:true}).waitFor();
  assert.ok(await guide.locator(".side-nav a[data-page]").count()>100);
  await guide.locator('[data-cydoc-id="compact-preview"]').scrollIntoViewIfNeeded();
  await guide.waitForFunction(()=>document.querySelector('[data-cydoc-id="compact-preview"] img')?.naturalWidth>0);
  await guide.locator(".locale-control select").selectOption("fr");
  await guide.evaluate(()=>{window.location.hash="/fr/projects-rooms";});
  await guide.locator(".diagram").waitFor();
  await guide.screenshot({path:path.join(output,"guide-server-fr.png")});
  assert.deepEqual(errors,[]);
  console.log("PASS: Actual server CSP/static delivery, public guide without account, authenticated settings entry, translated images/diagrams.");
}finally{
  await browser?.close();
  if(server.exitCode===null){server.kill();await new Promise(resolve=>server.once("exit",resolve));}
}
