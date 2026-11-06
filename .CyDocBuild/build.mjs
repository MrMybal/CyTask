import fs from "node:fs/promises";
import {existsSync} from "node:fs";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {spawnSync} from "node:child_process";
import {createRequire} from "node:module";
import {createHash} from "node:crypto";
import {zip} from "./archive.mjs";
const work=path.dirname(fileURLToPath(import.meta.url)),root=path.dirname(work),output=path.join(root,"Documentation");
const config=JSON.parse(await fs.readFile(path.join(work,"cydoc.config.json"),"utf8"));
const require=createRequire(path.join(work,"package.json")),stamp=path.join(work,"generated/installed-lock.sha256");
const lockHash=createHash("sha256").update(await fs.readFile(path.join(work,"package-lock.json"))).digest("hex");
if(!existsSync(path.join(work,"node_modules/cydoc/dist/viewer.js"))||(await fs.readFile(stamp,"utf8").catch(()=>""))!==lockHash){
 const installed=spawnSync(process.platform==="win32"?"npm.cmd":"npm",["ci","--no-audit","--no-fund"],{cwd:work,shell:process.platform==="win32",stdio:"inherit"});
 if(installed.status!==0)process.exit(installed.status??1);
 await fs.mkdir(path.dirname(stamp),{recursive:true});await fs.writeFile(stamp,lockHash);
}
// These modules import CyDoc: load them only after the pinned compiler is installed.
const {generateApi}=await import("./public-api.mjs");
const {extraPages}=await import("./extra-pages.mjs");
async function generatedReset(directory,expected,allowed){
 if(path.resolve(directory)!==path.resolve(expected)||!directory.startsWith(root+path.sep)||directory===root)throw Error("Unvalidated output path");
 const info=await fs.lstat(directory).catch(()=>null);if(info?.isSymbolicLink())throw Error("Generated output cannot be a link");
 if(info&&allowed)for(const file of await fs.readdir(directory))if(!allowed.has(file))throw Error("Unrelated file in generated output; preserve it before rebuilding: "+file);
 await fs.rm(directory,{recursive:true,force:true});await fs.mkdir(directory,{recursive:true});
}
for(const locale of ["en","fr"])await generatedReset(path.join(work,"manual",locale,"reference"),path.join(work,"manual",locale,"reference"));
const api=await generateApi(work,root);await extraPages(work);
await generatedReset(output,path.join(root,"Documentation"),new Set(["Documentation.html","DocData","DocAI.md"]));
const result=spawnSync(process.execPath,[path.join(work,"node_modules/cydoc/tools/cli.mjs"),process.argv.includes("--check")?"check":"build",path.join(work,"cydoc.config.json")],{cwd:work,stdio:"inherit"});
if(result.status!==0)process.exit(result.status??1);
const data=path.join(output,"DocData"),manifest=JSON.parse(await fs.readFile(path.join(data,"manifest.json"),"utf8"));
const translations=JSON.parse(await fs.readFile(path.join(data,"translation-report.json"),"utf8"));
if(translations.missing.length||translations.outdated.length||translations.untracked.length)throw Error("All published translations must be current and tracked");
for(const page of manifest.pages.filter(page=>page.locale==="en")){
 const fr=manifest.pages.find(item=>item.id===page.id&&item.locale==="fr");
 if(!fr||JSON.stringify(page.headings.map(item=>item.id))!==JSON.stringify(fr.headings.map(item=>item.id)))throw Error("Shared page/anchor coverage: "+page.id);
 if(!page.description||!fr.description)throw Error("Every page needs useful descriptions");
 if(page.kind==="source"||page.source||page.sourcePageId)throw Error("Raw source browsing is not part of this manual");
}
const {build}=await import(pathToFileURL(require.resolve("esbuild")).href);
await build({entryPoints:[path.join(work,"reader/bootstrap.mjs")],bundle:true,format:"iife",minify:true,target:"es2020",outfile:path.join(data,"viewer.js"),legalComments:"eof"});
await fs.copyFile(path.join(work,"reader/Documentation.html"),path.join(output,"Documentation.html"));
await fs.copyFile(path.join(work,"reader/cytask.css"),path.join(data,"cytask.css"));
await fs.copyFile(path.join(work,"reader/redirect.js"),path.join(data,"redirect.js"));
const legacy=JSON.parse(await fs.readFile(path.join(work,"legacy-anchors.json"),"utf8"));
await fs.writeFile(path.join(data,"compatibility.js"),"globalThis.CYTASK_LEGACY_ANCHORS="+JSON.stringify(legacy)+";\n");
await build({entryPoints:[path.join(work,"native/links.mjs")],bundle:true,format:"cjs",platform:"node",target:"node22",outfile:path.join(root,"apps/client/build/help-links.cjs"),legalComments:"eof"});
await fs.appendFile(path.join(output,"DocAI.md"),"\n"+await fs.readFile(path.join(work,"ai.md"),"utf8"));
await fs.copyFile(path.join(root,"LICENSE"),path.join(data,"LICENSE-CyTask.txt"));await fs.copyFile(path.join(work,"node_modules/cydoc/LICENSE"),path.join(data,"LICENSE-CyDoc.txt"));
let notices="CyTask: GPL-3.0-or-later. CyDoc: MIT.\n";
for(const name of ["marked","prismjs","esbuild"]){
 const directory=path.join(work,"node_modules",name),file=(await fs.readdir(directory)).find(file=>/^licen[cs]e(?:\.md|\.txt)?$/i.test(file));
 if(!file)throw Error("Missing dependency notice: "+name);notices+="\n--- "+name+" ---\n"+await fs.readFile(path.join(directory,file),"utf8");
}
await fs.writeFile(path.join(data,"THIRD-PARTY-NOTICES.txt"),notices);
async function files(directory,prefix=""){
 const list=[];for(const item of (await fs.readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  const name=prefix+item.name;if(item.isSymbolicLink())throw Error("Linked output resource");if(item.isDirectory())list.push(...await files(path.join(directory,item.name),name+"/"));else list.push([name,await fs.readFile(path.join(directory,item.name))]);
 }return list;
}
await fs.writeFile(path.join(data,"cytask-help.zip"),zip(await files(output)));
const web=path.join(root,"apps/web/public/Documentation");await generatedReset(web,path.join(root,"apps/web/public/Documentation"));await fs.cp(output,web,{recursive:true});
const old=path.join(root,"apps/web/public/help"),oldInfo=await fs.lstat(old).catch(()=>null);
if(oldInfo?.isSymbolicLink())throw Error("Legacy help directory cannot be a link");
if(oldInfo){
 const oldManifest=JSON.parse(await fs.readFile(path.join(old,"manifest.json"),"utf8").catch(()=>'{"name":"CyTask"}'));
 if(oldManifest.name!=="CyTask")throw Error("Unknown legacy help directory");
}
await generatedReset(old,path.join(root,"apps/web/public/help"));
await fs.copyFile(path.join(work,"reader/redirect.js"),path.join(old,"redirect.js"));
const redirect='<!doctype html><html lang="en"><head><meta charset="utf-8"><title>CyTask — Documentation</title><script src="redirect.js" data-target="../Documentation/Documentation.html" defer></script></head><body><a href="../Documentation/Documentation.html">Documentation</a></body></html>\n';
for(const name of ["index.html","manual.html"])await fs.writeFile(path.join(old,name),redirect);
await fs.copyFile(path.join(work,"reader/retire-worker.js"),path.join(old,"sw.js"));
await fs.mkdir(path.join(work,"internal"),{recursive:true});
await fs.writeFile(path.join(work,"internal/latest-build.json"),JSON.stringify({cydocRevision:"6ddf9a582defb2f11fbb3f992afef6f98dcadc93",localizedPages:manifest.pages.length,api,translations,modules:config.modules,deprecatedIds:Object.keys(config.aliases)},null,2));
console.log("CyTask: "+manifest.pages.length+" localized human pages; Documentation/Documentation.html ready.");
