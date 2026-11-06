import assert from "node:assert/strict";
import {readFile,mkdir,writeFile,readdir} from "node:fs/promises";
import {inflateRawSync} from "node:zlib";
import {fileURLToPath,pathToFileURL} from "node:url";
import path from "node:path";
import {chromium} from "playwright";
const root=fileURLToPath(new URL("../../../",import.meta.url)),output=path.join(root,".CyDocBuild/internal/tests");
const help=path.join(root,"Documentation"),data=path.join(help,"DocData");
await mkdir(output,{recursive:true});
const manifest=JSON.parse(await readFile(path.join(data,"manifest.json"),"utf8"));
const legacy=JSON.parse(await readFile(path.join(root,".CyDocBuild/legacy-anchors.json"),"utf8"));
const ids=Object.keys(legacy.en);
assert.equal(ids.length,24);
for(const id of ids){
 const en=manifest.pages.find(page=>page.id===id&&page.locale==="en"),fr=manifest.pages.find(page=>page.id===id&&page.locale==="fr");
 assert.ok(en&&fr,id+" is bilingual");assert.deepEqual(en.headings.map(h=>h.id),fr.headings.map(h=>h.id),"Shared anchors: "+id);
 assert.ok(en.text.length>700&&fr.text.length>700);
}
assert.equal(manifest.defaultLocale,"en");
for(const en of manifest.pages.filter(page=>page.locale==="en")){
 const fr=manifest.pages.find(page=>page.id===en.id&&page.locale==="fr");
 assert.ok(fr,"French coverage: "+en.id);assert.deepEqual(en.headings.map(h=>h.id),fr.headings.map(h=>h.id),en.id);
 assert.ok(en.description&&fr.description);assert.notEqual(en.text,fr.text,"Actual translation: "+en.id);
 assert.ok(en.kind!=="source"&&!en.source&&!en.sourcePageId);
}
const files=await readdir(data);
assert.deepEqual(files.filter(name=>/^media-.*\.js$/.test(name)).sort(),["media-gallery.js","media-image.js"]);
assert.ok(!files.some(name=>/three|mesh|video|gif|graph/i.test(name)),"No unused readers");
const report=JSON.parse(await readFile(path.join(data,"translation-report.json"),"utf8"));
assert.deepEqual([report.missing,report.outdated,report.untracked],[[],[],[]]);
assert.equal(manifest.pages.filter(page=>page.locale==="en"&&page.id.startsWith("rest-")).length,125);
for(const page of manifest.pages)assert.ok(!/SourceFile|^source-|documentation-status|translation-report|migration-report/.test(page.id));
const html=await readFile(path.join(help,"Documentation.html"),"utf8");
assert.ok(!/<iframe|http-equiv="refresh"|location\.replace/.test(html),"Canonical entry mounts the reader directly");
assert.ok(!html.includes('type="module"'),"Classic local bootstrap");
assert.ok(html.includes("connect-src 'none'"));
const archive=await readFile(path.join(data,"cytask-help.zip"));
const extracted=path.join(output,"extracted guide é");await mkdir(extracted,{recursive:true});
let cursor=0,entries=0;
while(archive.readUInt32LE(cursor)===0x04034b50){
 const compression=archive.readUInt16LE(cursor+8),size=archive.readUInt32LE(cursor+18),nameSize=archive.readUInt16LE(cursor+26),extraSize=archive.readUInt16LE(cursor+28);
 const name=archive.subarray(cursor+30,cursor+30+nameSize).toString("utf8");
 assert.ok(name.startsWith("Documentation/")&&!name.includes("..")&&!name.includes("\\"));
 const start=cursor+30+nameSize+extraSize,packed=archive.subarray(start,start+size);
 const bytes=compression===8?inflateRawSync(packed):packed;
 const file=path.resolve(extracted,name);assert.ok(file.startsWith(extracted+path.sep));
 await mkdir(path.dirname(file),{recursive:true});await writeFile(file,bytes);
 cursor=start+size;entries++;
}
assert.ok(entries>=19,"Complete reader plus selected modules and local media");
const base=pathToFileURL(path.join(extracted,"Documentation/Documentation.html")).href;
const browser=await chromium.launch({headless:true,chromiumSandbox:true,...(process.env.CYTASK_TEST_BROWSER?{channel:process.env.CYTASK_TEST_BROWSER}:{})});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.setOffline(true);
const network=[],errors=[];
context.on("request",request=>{if(/^https?:/.test(request.url()))network.push(request.url());});
const page=await context.newPage();
page.on("pageerror",error=>errors.push(error.message));
page.on("console",message=>{if(message.type()==="error"&&/Content Security Policy|Refused to/.test(message.text()))errors.push(message.text());});
async function open(id,locale="en",anchor){
 await page.evaluate(({id,locale,anchor})=>{location.hash="/"+locale+"/"+id+(anchor?"/"+anchor:"");},{id,locale,anchor});
 const title=manifest.pages.find(item=>item.id===id&&item.locale===locale)?.title;
 await page.locator("#main-content h1").filter({hasText:title}).waitFor();
}
async function revealNavigation(id){
 const link=page.locator('.side-nav a[data-page="'+id+'"]');
 const closed=await link.evaluate(node=>{
  const groups=[];for(let parent=node.closest('details');parent;parent=parent.parentElement?.closest('details'))if(!parent.open)groups.unshift(parent.dataset.navKey);
  return groups;
 });
 for(const key of closed)await page.locator('details[data-nav-key='+JSON.stringify(key)+'] > summary > .nav-chevron').click();
 await link.scrollIntoViewIfNeeded();await page.waitForTimeout(180);return link;
}
try{
 await page.goto(base);
 await page.locator("#main-content h1").filter({hasText:"Getting started"}).waitFor();
 assert.equal(new URL(page.url()).protocol,"file:");
 assert.equal(await page.locator("html").getAttribute("lang"),"en");
 assert.ok(await page.locator(".nav-tree .nav-children .nav-children").count()>0,"Nested page hierarchy");
 assert.equal(await page.locator(".sidebar").evaluate(node=>Math.round(node.getBoundingClientRect().width)),330);
 assert.equal(await page.locator('.side-nav a[data-page="documentation-status"]').count(),0);
 assert.equal(await page.locator('.side-nav a[data-page="sdk-client"]').getAttribute("data-tooltip-description"),manifest.pages.find(p=>p.id==="sdk-client"&&p.locale==="en").description);
 await page.locator("[data-header-search]").fill("claimTask");
 await page.locator(".search-dialog[open] .search-result").first().waitFor();
 await page.keyboard.press("Escape");
 await page.goto(base+"#/unsupported/getting-started");
 await page.getByRole("heading",{name:"Getting started",level:1,exact:true}).waitFor();
 assert.equal(await page.locator("html").getAttribute("lang"),"en","Unknown locale falls back to English");
 for(const locale of ["en","fr"])for(const id of ids){await open(id,locale);assert.ok((await page.locator("#main-content").innerText()).length>700);}
 await page.goto(base+"?lang=fr#/guide/tasks?section=modifier-les-attributs");
 await page.locator("#update-attributes").waitFor();
 assert.ok(page.url().endsWith("#/fr/tasks/update-attributes"),"Old French anchor becomes shared stable ID");
 await page.locator(".locale-control select").selectOption("en");
 await page.waitForFunction(()=>location.hash==="#/en/tasks/update-attributes");
 assert.equal(await page.locator("html").getAttribute("lang"),"en");
 await open("hierarchy","fr");assert.ok(await page.locator(".diagram svg[role=img]").count());
 await page.screenshot({path:path.join(output,"cydoc-diagram-fr.png")});
 await open("getting-started","fr");
 const picture=page.locator('[data-cydoc-id="compact-preview"]');await picture.scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>document.querySelector('[data-cydoc-id="compact-preview"] img')?.naturalWidth>0);
 await picture.hover();
 await picture.locator('[data-action="expand"]').click();
 await page.locator(".media-expanded").waitFor();assert.equal(await page.evaluate(()=>document.fullscreenElement),null);
 await page.keyboard.press("Escape");assert.equal(await page.locator(".media-expanded").count(),0);
 await open("screenshots","fr");
 await page.evaluate(()=>{location.hash="/fr/screenshots?media=application-gallery&item=2";});
 const gallery=page.locator('[data-cydoc-id="application-gallery"]');await gallery.scrollIntoViewIfNeeded();
 await gallery.locator('[data-index="2"][aria-selected="true"]').waitFor();
 await gallery.locator('[data-gallery="next"]').click();
 await gallery.locator('[data-index="3"][aria-selected="true"]').waitFor();
 await gallery.locator('[data-index="3"]').focus();await page.keyboard.press("ArrowLeft");
 await gallery.locator('[data-index="2"][aria-selected="true"]').waitFor();
 await page.keyboard.press("Control+k");await page.locator(".search-dialog[open]").waitFor();
 await page.locator(".search-form input").fill("echeance");
 await page.locator(".search-result").first().waitFor();assert.ok(await page.locator(".search-result").count()>0);
 await page.keyboard.press("Escape");
 await open("sdk-client","en","public-api");
 assert.match(await page.locator("#main-content").innerText(),/claimTask\(taskId, options/);
 const sdkLink=await revealNavigation("sdk-client");await page.keyboard.press("Tab");await sdkLink.focus();
 await page.locator('[role="tooltip"]').waitFor();assert.match(await page.locator('[role="tooltip"]').innerText(),/public methods/);
 await page.keyboard.press("Tab");
 await open("source-source-sdk-index-mjs","en");
 await page.getByRole("heading",{name:"JavaScript SDK",level:1,exact:true}).waitFor();
 await open("tasks","fr");await page.mouse.move(1000,650);await page.mouse.wheel(0,650);await page.waitForTimeout(250);
 const y=await page.evaluate(()=>scrollY);assert.ok(y>100);
 await open("chat","fr");await open("tasks","fr");await page.waitForTimeout(180);
 assert.ok(Math.abs(await page.evaluate(()=>scrollY)-y)<10,"Reading position restored");
 await open("tasks","fr","configure-workflow-states");
 await page.waitForFunction(()=>document.activeElement?.id==="configure-workflow-states");
 for(const tone of ["dark","light","midnight","nord","paper","contrast"]){
  await page.locator(".theme-picker").evaluate(node=>{node.open=true;});await page.locator('[data-set-theme="'+tone+'"]').click();
  assert.equal(await page.locator("#app").getAttribute("data-theme"),tone);
  await page.screenshot({path:path.join(output,"cydoc-"+tone+"-fr.png")});
 }
 await page.setViewportSize({width:390,height:844});await open("getting-started","fr");
 await page.locator("[data-menu]").click();
 assert.equal(await page.locator("[data-menu]").getAttribute("aria-expanded"),"true");
 await (await revealNavigation("projects-rooms")).click();
 await page.locator("[data-menu]").click();
 await (await revealNavigation("files-media")).click();await page.waitForTimeout(100);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,"No mobile page overflow");
 await page.screenshot({path:path.join(output,"cydoc-mobile-fr.png")});
 const longNames=await context.newPage();
 await longNames.setViewportSize({width:1440,height:1000});
 await longNames.addInitScript(()=>{
  Object.defineProperty(window,"CYDOC_DATA",{configurable:true,set(data){
   Object.defineProperty(window,"CYDOC_DATA",{configurable:true,writable:true,value:{...data,name:"CyTask — Digital production workspace and project management documentation"}});
  }});
 });
 const longest=manifest.pages.filter(item=>item.locale==="en"&&item.id.startsWith("rest-")).sort((a,b)=>b.title.length-a.title.length)[0];
 await longNames.goto(base+"#/en/"+longest.id);
 await longNames.getByRole("heading",{name:longest.title,level:1,exact:true}).waitFor();
 await longNames.locator('.brand-name').waitFor();
 assert.equal(await longNames.locator('.brand-name').evaluate(node=>getComputedStyle(node).textOverflow),"ellipsis");
 const boxes=await longNames.locator('.topbar-start,.header-search,.topbar-actions').evaluateAll(nodes=>nodes.map(node=>{const box=node.getBoundingClientRect();return {left:box.left,right:box.right};}));
 assert.ok(boxes[0].right<=boxes[1].left&&boxes[1].right<=boxes[2].left,"Header groups never overlap");
 await longNames.locator('.brand').focus();
 await longNames.locator('[role="tooltip"]').waitFor();assert.match(await longNames.locator('[role="tooltip"]').innerText(),/Digital production workspace/);
 await longNames.keyboard.press("Escape");
 const routeLink=longNames.locator('.side-nav a[data-page="'+longest.id+'"]');
 await routeLink.scrollIntoViewIfNeeded();await longNames.keyboard.press("Tab");await routeLink.focus();
 await longNames.locator('[role="tooltip"]').waitFor();assert.ok((await longNames.locator('[role="tooltip"]').innerText()).includes(longest.title));
 assert.equal(await longNames.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,"Long API titles stay inside the page");
 await longNames.keyboard.press("Escape");await longNames.mouse.move(800,600);await longNames.locator('.brand').hover();
 await longNames.locator('[role="tooltip"]').waitFor();assert.match(await longNames.locator('[role="tooltip"]').innerText(),/Digital production workspace/);
 await longNames.screenshot({path:path.join(output,"cydoc-long-brand.png")});await longNames.close();
 assert.deepEqual(network,[],"No HTTP, API or CDN needed for reading");
 assert.deepEqual(errors,[]);
 console.log("PASS: CyDoc file:// from extracted ZIP; complete EN/FR, tree, header search, API signatures, aliases, images/gallery, positions, themes and narrow layout.");
}catch(error){await page.screenshot({path:path.join(output,"cydoc-failure.png")}).catch(()=>{});console.error(JSON.stringify({errors,network}));throw error;}finally{await context.close();await browser.close();}
