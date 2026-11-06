import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtemp,mkdir,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import net from "node:net";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright";
const root=fileURLToPath(new URL("../../../",import.meta.url));
const fixture=await mkdtemp(path.join(tmpdir(),"CyTask-help-desktop-"));
const output=path.join(root,".CyDocBuild/internal/tests");await mkdir(output,{recursive:true});
for(const name of ["profile","roaming","local","temp"])await mkdir(path.join(fixture,name));
const listener=net.createServer();await new Promise(resolve=>listener.listen(0,"127.0.0.1",resolve));
const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
const clean=Object.fromEntries(Object.entries(process.env).filter(([name])=>!name.toLowerCase().startsWith("cytask_")));
const env={...clean,APPDATA:path.join(fixture,"roaming"),LOCALAPPDATA:path.join(fixture,"local"),TEMP:path.join(fixture,"temp"),TMP:path.join(fixture,"temp")};
delete env.ELECTRON_RUN_AS_NODE;
const executable=process.env.CYTASK_TEST_DESKTOP_EXE??path.join(root,"apps/client/node_modules/electron/dist",process.platform==="win32"?"electron.exe":"electron");
const args=[...(process.env.CYTASK_TEST_DESKTOP_EXE?[]:[path.join(root,"apps/client")]),"--remote-debugging-port="+port,"--user-data-dir="+path.join(fixture,"profile"),"--disable-gpu"];
let logs="";
function launch(){
 const process=spawn(executable,args,{windowsHide:true,env,stdio:["ignore","pipe","pipe"]});
 process.stdout.on("data",data=>{logs+=data;});process.stderr.on("data",data=>{logs+=data;});return process;
}
let child=launch();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function wait(action,label){
  const deadline=Date.now()+20000;let last;
  while(Date.now()<deadline){try{const value=await action();if(value)return value;}catch(error){last=error;}await sleep(100);}
  throw Error(label+": "+(last?.message??"timeout"));
}
let browser;
try{
  await wait(async()=>{const response=await fetch("http://127.0.0.1:"+port+"/json/version");return response.ok;},"Desktop debug endpoint");
  browser=await chromium.connectOverCDP("http://127.0.0.1:"+port);
  const pages=()=>browser.contexts().flatMap(context=>context.pages());
  const isGuide=page=>page.url().startsWith("file:")&&new URL(page.url()).pathname.endsWith("/Documentation/Documentation.html");
  const selector=await wait(()=>pages().find(page=>page.url()==="cytask-client://app/index.html"),"Workspace selector");
  await selector.waitForFunction(()=>typeof window.cytaskDesktop==="object");
  assert.equal(await selector.locator("#open-help").innerText(),"User guide");
  await selector.locator("#open-help").click();
  const guide=await wait(()=>pages().find(isGuide),"Bundled file guide");
  await guide.getByRole("heading",{name:"Getting started",level:1,exact:true}).waitFor();
  assert.ok(await guide.locator(".side-nav a[data-page]").count()>100);
  assert.equal(await guide.evaluate(()=>typeof window.cytaskDesktop),"undefined");
  assert.equal(await guide.evaluate(()=>typeof require),"undefined");
  assert.equal(await guide.evaluate(()=>typeof process),"undefined");
  assert.equal(new URL(guide.url()).protocol,"file:");
  await guide.locator(".locale-control select").selectOption("fr");
  await guide.getByRole("heading",{name:"Prise en main",level:1,exact:true}).waitFor();
  await guide.evaluate(()=>{window.location.hash="/fr/hierarchy";});
  await guide.locator(".diagram").waitFor();
  await guide.screenshot({path:path.join(output,"guide-desktop-fr.png")});
  await guide.evaluate(()=>{window.location.hash="/fr/getting-started";});
  const picture=guide.locator('[data-cydoc-id="compact-preview"]');
  await picture.scrollIntoViewIfNeeded();
  await guide.waitForFunction(()=>document.querySelector('[data-cydoc-id="compact-preview"] img')?.naturalWidth>0);
  await picture.hover();await picture.locator('[data-action="expand"]').click();
  assert.equal(await guide.locator(".media-expanded").count(),1);
  await guide.keyboard.press("Escape");
  assert.equal(await guide.locator(".media-expanded").count(),0);
  const traversal=await selector.evaluate(async()=>{
    const values=["cytask-client://app/help/%2e%2e%2fmain.cjs","cytask-client://app/help/%00","cytask-client://app/help/%zz","cytask-client://app/help/%5c..%5cmain.cjs"];
    return Promise.all(values.map(async value=>{try{const response=await fetch(value);return response.status;}catch{return 400;}}));
  });
  assert.ok(traversal.every(status=>status>=400),"Encoded paths do not escape bundled files");
  await selector.locator("[data-locale='fr']").click();
  assert.equal(await selector.locator("#open-help").innerText(),"Guide utilisateur");
  await selector.locator("#open-help").click();
  await guide.getByRole("heading",{name:"Prise en main",level:1,exact:true}).waitFor();
  assert.equal(pages().filter(isGuide).length,1);
  // Use the native window close, rather than CDP Target.closeTarget. Native F1
  // dispatch is covered by the unit test: CDP key events do not test OS menus.
  await guide.evaluate(()=>window.close()).catch(()=>{});
  await wait(()=>!pages().some(isGuide),"Guide closed");
  await selector.locator("#open-help").click();
  const reopened=await wait(()=>pages().find(isGuide),"Reopened guide");
  await reopened.getByRole("heading",{name:"Prise en main",level:1,exact:true}).waitFor();
  if(process.env.CYTASK_TEST_HELP_LOCAL==="1"){
    const folder=path.join(fixture,"workspace");await mkdir(folder);
    const opened=await selector.evaluate(profile=>window.cytaskDesktop.openLocal(profile),{name:"Documentation fixture",folderPath:folder});
    assert.equal(opened.ok,true);
    const workspace=await wait(()=>pages().find(page=>/^http:\/\/127\.0\.0\.1:\d+/.test(page.url())),"Local workspace");
    await workspace.locator(".server-rail-help").waitFor();
    const origin=new URL(workspace.url()).origin;
    await workspace.getByRole("button",{name:"Settings and tools",exact:true}).first().click();
    await workspace.locator(".account-security summary").click();
    await workspace.locator(".account-security").getByRole("link",{name:"User guide",exact:true}).click();
    await reopened.getByRole("heading",{name:"Two-factor authentication",level:1,exact:true}).waitFor();
    assert.equal(new URL(reopened.url()).protocol,"file:");
    assert.ok(reopened.url().endsWith("#/en/mfa"));
    assert.equal(await reopened.evaluate(()=>typeof window.cytaskDesktop),"undefined");
    await workspace.evaluate(()=>window.close()).catch(()=>{});
    await wait(async()=>{try{return !(await fetch(origin+"/health/ready")).ok;}catch{return true;}},"Local engine stopped");
  }
  await reopened.evaluate(()=>{location.hash="/en/tasks";});
  await reopened.getByRole("heading",{name:"Create and edit tasks",level:1,exact:true}).waitFor();
  await reopened.locator('[data-bookmark]').click();
  await reopened.mouse.move(1000,650);await reopened.mouse.wheel(0,650);
  await reopened.waitForFunction(()=>JSON.parse(localStorage.getItem("cydoc:reading:cytask-help")).positions["en:tasks"]>100);
  const position=await reopened.evaluate(()=>JSON.parse(localStorage.getItem("cydoc:reading:cytask-help")).positions["en:tasks"]);
  await reopened.evaluate(()=>window.close()).catch(()=>{});
  await selector.evaluate(()=>window.close()).catch(()=>{});
  await wait(()=>child.exitCode!==null,"Graceful application exit");
  await browser.close().catch(()=>{});browser=undefined;
  child=launch();
  await wait(async()=>{try{return(await fetch("http://127.0.0.1:"+port+"/json/version")).ok;}catch{return false;}},"Restarted application");
  browser=await chromium.connectOverCDP("http://127.0.0.1:"+port);
  const nextSelector=await wait(()=>pages().find(page=>page.url()==="cytask-client://app/index.html"),"Restarted selector");
  await nextSelector.locator("#open-help").click();
  const nextGuide=await wait(()=>pages().find(isGuide),"Restarted guide");
  await nextGuide.locator("#main-content h1").waitFor();
  await nextGuide.evaluate(()=>{location.hash="/en/tasks";});
  await nextGuide.locator('[data-bookmark][aria-pressed="true"]').waitFor();
  // CyDoc offers an explicit resume control for a new reader session.
  await nextGuide.locator(".resume-reading").click();
  await nextGuide.waitForFunction(position=>Math.abs(scrollY-position)<10,position);
  assert.ok(!/UnhandledPromiseRejection|Uncaught Exception/.test(logs));
  console.log("PASS: Desktop selector EN/FR, genuine file:// guide, media, reopening, isolated renderer, path checks, reading position and bookmarks across application restart"+(process.env.CYTASK_TEST_HELP_LOCAL==="1"?", local workspace contextual link.":"."));
}finally{
  if(browser)for(const page of browser.contexts().flatMap(context=>context.pages()))await page.evaluate(()=>window.close()).catch(()=>{});
  if(child.exitCode===null)await Promise.race([new Promise(resolve=>child.once("exit",resolve)),sleep(3000)]);
  if(browser)await browser.close().catch(()=>{});
  if(child.exitCode===null){child.kill();await Promise.race([new Promise(resolve=>child.once("exit",resolve)),sleep(3000)]);}
  await writeFile(path.join(output,"desktop-smoke.log"),logs);
}
