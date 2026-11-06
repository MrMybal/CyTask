import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {inflateRawSync} from "node:zlib";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const dataFiles=new Set(["data.js","manifest.json","translation-report.json","viewer.js","viewer.css","cytask.css","compatibility.js","redirect.js","LICENSE-CyTask.txt","LICENSE-CyDoc.txt","THIRD-PARTY-NOTICES.txt","cytask-help.zip","media-image.js","media-gallery.js"]);
export async function inspectHelpExport(directory){
 const files=[];assert.ok(!(await fs.lstat(directory)).isSymbolicLink(),"Export must not be linked");
 async function walk(relative=""){
  for(const entry of await fs.readdir(path.join(directory,relative),{withFileTypes:true})){
   const name=path.posix.join(relative,entry.name);
   assert.ok(!entry.isSymbolicLink(),"Documentation must not contain links: "+name);
   if(entry.isDirectory()){assert.ok(name==="DocData"||name==="DocData/assets"||name.startsWith("DocData/assets/"),"Unexpected export directory: "+name);await walk(name);}
   else{assert.ok(entry.isFile(),"Expected a regular resource");assert.ok(["Documentation.html","DocAI.md"].includes(name)||name.startsWith("DocData/")&&dataFiles.has(name.slice(8))||/^DocData\/assets\/[a-zA-Z0-9_./-]+\.(?:png|jpe?g|svg|webp|ico)$/.test(name),"Unexpected export file: "+name);files.push(name);}
  }
 }
 await walk();for(const name of ["Documentation.html","DocAI.md",...Array.from(dataFiles,name=>"DocData/"+name)])assert.ok(files.includes(name),"Missing reader resource: "+name);
 const manifest=JSON.parse(await fs.readFile(path.join(directory,"DocData/manifest.json"),"utf8"));
 assert.equal(manifest.name,"CyTask");assert.equal(manifest.defaultLocale,"en");assert.deepEqual(manifest.locales.map(locale=>locale.code),["en","fr"]);
 assert.ok(manifest.pages.every(page=>page.kind!=="source"&&!page.source&&!page.sourcePageId),"Publish API contracts, not source files");
 assert.ok(!manifest.pages.some(page=>["documentation-status","translation-report"].includes(page.id)),"Work records do not belong in human navigation");
 const html=await fs.readFile(path.join(directory,"Documentation.html"),"utf8");assert.ok(html.includes("connect-src 'none'"));assert.ok(!html.includes('type="module"'));
 for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g))assert.ok(files.includes(match[1]),"Bundled relative HTML resource: "+match[1]);
 const report=JSON.parse(await fs.readFile(path.join(directory,"DocData/translation-report.json"),"utf8"));
 assert.equal(report.missing.length+report.outdated.length+report.untracked.length,0,"Complete tracked translations");
 const archive=await fs.readFile(path.join(directory,"DocData/cytask-help.zip"));let offset=0;const packed=new Map();
 while(archive.readUInt32LE(offset)===0x04034b50){
  const method=archive.readUInt16LE(offset+8),size=archive.readUInt32LE(offset+18),length=archive.readUInt16LE(offset+26),extra=archive.readUInt16LE(offset+28);
  const name=archive.subarray(offset+30,offset+30+length).toString("utf8");assert.ok(name.startsWith("Documentation/")&&!name.includes("..")&&!name.includes("\\"));
  const start=offset+30+length+extra,bytes=archive.subarray(start,start+size);assert.ok(!packed.has(name));packed.set(name,method===8?inflateRawSync(bytes):bytes);offset=start+size;
 }
 const archived=files.filter(name=>name!=="DocData/cytask-help.zip");assert.equal(packed.size,archived.length,"Complete offline archive");
 for(const name of archived)assert.ok((await fs.readFile(path.join(directory,name))).equals(packed.get("Documentation/"+name)??Buffer.alloc(0)),"Current offline archive resource: "+name);
 return files.sort();
}
export async function stageHelpPages(source,destination){
 const target=path.resolve(destination),relative=path.relative(path.join(root,".build"),target);assert.ok(relative&&!relative.startsWith("..")&&!path.isAbsolute(relative),"Site output must stay below .build");
 const files=await inspectHelpExport(source),old=await fs.lstat(target).catch(()=>null);assert.ok(!old?.isSymbolicLink(),"Site output must not be linked");
 await fs.rm(target,{recursive:true,force:true});await fs.mkdir(target,{recursive:true});
 for(const name of files){await fs.mkdir(path.dirname(path.join(target,name)),{recursive:true});await fs.copyFile(path.join(source,name),path.join(target,name));}
 await fs.writeFile(path.join(target,".nojekyll"),"");
 await fs.writeFile(path.join(target,"index.html"),'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>CyTask — Documentation</title><script src="DocData/redirect.js" data-target="Documentation.html" defer></script></head><body><a href="Documentation.html">Documentation</a></body></html>\n');
 return files;
}
export async function main(){const files=await stageHelpPages(path.join(root,"Documentation"),path.join(root,".build/pages"));console.log("CyDoc site ready: "+files.length+" resources, English and French.");}
