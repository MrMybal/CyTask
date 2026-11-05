"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs/promises"),path=require("node:path"),vm=require("node:vm");
const {pathToFileURL,fileURLToPath}=require("node:url");
const links=require("../build/help-links.cjs");
test("CyDoc file URLs encode paths and preserve page, anchor and media state",()=>{
 const file=path.resolve("fixture/Guide é & space/index.html");
 const url=links.createLocalHelpUrl(file,{locale:"fr",pageId:"tasks",anchor:"update-attributes",state:{media:"compact-preview",zoom:"2"}});
 assert.equal(new URL(url).protocol,"file:");assert.equal(fileURLToPath(new URL(url)),file);
 assert.match(url,/#\/fr\/tasks\/update-attributes\?media=compact-preview&zoom=2$/);
 assert.deepEqual(links.readHelpRoute(url),{locale:"fr",pageId:"tasks",anchor:"update-attributes",state:{media:"compact-preview",zoom:"2"}});
 assert.throws(()=>links.createLocalHelpUrl("relative/index.html"),/absolute/);
});
test("Only trusted help links are converted; previous French anchors still work",()=>{
 assert.deepEqual(links.webHelpTarget("https://fixture.invalid/help/manual.html#/fr/mfa","https://fixture.invalid"),{locale:"fr",pageId:"mfa"});
 assert.deepEqual(links.webHelpTarget("https://fixture.invalid/help/index.html?lang=fr#/guide/tasks?section=modifier-les-attributs","https://fixture.invalid"),{locale:"fr",pageId:"tasks",anchor:"update-attributes"});
 for(const value of ["https://other.invalid/help/manual.html","https://fixture.invalid/api/v1/me","javascript:alert(1)","file:///tmp/help/index.html"])
  assert.equal(links.webHelpTarget(value,"https://fixture.invalid"),null);
});
test("File navigation cannot escape the bundled manual",()=>{
 const root=path.resolve("fixture/help");
 assert.equal(links.isHelpFileUrl(pathToFileURL(path.join(root,"index.html")).href,root),true);
 for(const file of [path.join(root,"../private.txt"),path.resolve("other/index.html")])assert.equal(links.isHelpFileUrl(pathToFileURL(file).href,root),false);
 for(const value of ["https://fixture.invalid/help/index.html","cytask-client://app/help/index.html","file://host/private","file:///help/%00","file:///help/%2fprivate"])
  assert.equal(links.isHelpFileUrl(value,root),false);
});
test("Native reader is sandboxed, has no bridge and blocks network/permissions",async()=>{
 const source=await fs.readFile(path.join(__dirname,"../main.cjs"),"utf8");
 const body=source.slice(source.indexOf("function openDocumentation("),source.indexOf("function iconPath("));
 let options,loaded,permission,check,request,loads=0;
 const root=path.resolve("fixture/help");
 class Window {
  constructor(config){options=config;this.webContents={getURL:()=>loaded,setWindowOpenHandler:()=>{},on:()=>{}};}
  loadURL(url){loaded=url;loads++;return Promise.resolve();}
  once(){}on(){}show(){}focus(){}isDestroyed(){return false;}
 }
 const helpSession={setPermissionRequestHandler:fn=>{permission=fn;},setPermissionCheckHandler:fn=>{check=fn;},webRequest:{onBeforeRequest:fn=>{request=fn;}}};
 const context={BrowserWindow:Window,documentationWindow:null,interfaceLocale:"en",path,URL,__dirname,
  fsSync:{existsSync:()=>true},documentationRoot:()=>root,documentationLinks:()=>links,iconPath:()=>"",
  nativeText:en=>en,session:{fromPartition:name=>{assert.equal(name,"persist:cytask-documentation");return helpSession;}},
  installDocumentationShortcut:()=>{},safeExternalUrl:()=>null,shell:{openExternal:()=>{}},
  isDocumentationUrl:url=>links.isHelpFileUrl(url,root),dialog:{showErrorBox:()=>assert.fail("Unexpected error")}};
 const open=vm.runInNewContext(body+"\nopenDocumentation",context);open("fr");
 assert.equal(new URL(loaded).protocol,"file:");
 assert.equal(options.webPreferences.partition,"persist:cytask-documentation");
 for(const key of ["nodeIntegration","webviewTag","allowRunningInsecureContent"])assert.equal(options.webPreferences[key],false);
 for(const key of ["sandbox","contextIsolation","webSecurity"])assert.equal(options.webPreferences[key],true);
 assert.equal(options.webPreferences.preload,undefined);
 let allowed;permission(null,"media",value=>{allowed=value;});assert.equal(allowed,false);assert.equal(check(),false);
 request({url:"https://fixture.invalid/api/v1/me"},result=>assert.equal(result.cancel,true));
 request({url:pathToFileURL(path.join(root,"viewer.js")).href},result=>assert.equal(result.cancel,false));
 open();assert.equal(loads,1,"F1 retains the existing route and reading position");
 open({locale:"en",pageId:"mfa",anchor:"enroll-an-authenticator"});assert.match(loaded,/#\/en\/mfa\/enroll-an-authenticator$/);
});
test("F1 follows the application's contextual help without giving Web content IPC",async()=>{
 const source=await fs.readFile(path.join(__dirname,"../main.cjs"),"utf8");
 const body=source.slice(source.indexOf("function installDocumentationShortcut("),source.indexOf("function openDocumentation("));
 let handler,opened,prevented=false;
 const win={webContents:{on:(_name,fn)=>{handler=fn;},getURL:()=>"https://fixture.invalid/",executeJavaScript:()=>Promise.resolve("https://fixture.invalid/help/manual.html#/fr/calls")}};
 const install=vm.runInNewContext(body+"\ninstallDocumentationShortcut",{workspaceWindow:win,URL,documentationLinks:()=>links,openDocumentation:target=>{opened=target;}});
 install(win);handler({preventDefault:()=>{prevented=true;}},{type:"keyDown",key:"F1"});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(prevented,true);assert.deepEqual(opened,{locale:"fr",pageId:"calls"});
 assert.match(source,/accelerator: "F1"/);
 assert.match(source,/ipcMain.handle\("cytask:open-help", event => {\s*assertSelectorSender\(event\)/);
});
