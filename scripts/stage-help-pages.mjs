import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const readerFiles=new Set(['index.html','manual.html','viewer.js','viewer.css','cytask.css','data.js','compatibility.js',
 'manifest.json','translation-report.json','migration-report.json','cytask-help.zip','sw.js','README.txt',
 'LICENSE-CyTask.txt','LICENSE-CyDoc.txt','THIRD-PARTY-NOTICES.txt','media-image.js','media-gallery.js']);

export async function inspectHelpExport(directory){
 assert.ok(!(await fs.lstat(directory)).isSymbolicLink(),'Export root must be a directory, not a link');
 const files=[];
 async function walk(relative=''){
  for(const entry of await fs.readdir(path.join(directory,relative),{withFileTypes:true})){
   const name=path.posix.join(relative,entry.name);
   assert.ok(!entry.isSymbolicLink(),'Documentation must not contain links: '+name);
   if(entry.isDirectory()){
    assert.ok(name==='assets'||name.startsWith('assets/'),'Unexpected export directory: '+name);
    await walk(name);
   }else{
    assert.ok(entry.isFile(),'Expected a regular documentation resource: '+name);
    assert.ok(readerFiles.has(name)||/^assets\/(?!.*(?:^|\/)\.)[a-zA-Z0-9_./-]+\.(?:png|jpe?g|webp|svg|ico|json)$/.test(name),'Unexpected export file: '+name);
    files.push(name);
   }
  }
 }
 await walk();
 for(const file of readerFiles)assert.ok(files.includes(file),'Missing reader resource: '+file);
 const manifest=JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8'));
 assert.equal(manifest.name,'CyTask');assert.equal(manifest.defaultLocale,'en');
 assert.deepEqual(manifest.locales.map(item=>item.code).sort(),['en','fr']);
 assert.ok(manifest.pages.length>=48,'User guides must be included');
 for(const file of ['index.html','manual.html']){
  const html=await fs.readFile(path.join(directory,file),'utf8');
  assert.ok(html.includes("connect-src 'none'"),'Local reader policy must remain intact');
  assert.ok(!html.includes('type="module"'),'Keep the file-compatible classic reader');
  for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g))assert.ok(files.includes(match[1]),'Bundled relative HTML resource: '+match[1]);
 }
 const report=JSON.parse(await fs.readFile(path.join(directory,'migration-report.json'),'utf8'));
 assert.equal(report.unresolvedLinks.length,0,'Resolve source links before publishing');
 // The downloadable archive must be the same export, not an earlier build.
 const archived=[];
 for(const file of files.filter(name=>name!=='cytask-help.zip').sort((a,b)=>a.localeCompare(b)))archived.push([file,await fs.readFile(path.join(directory,file))]);
 // ZIP entry ordering is defined by build-help; compare entries rather than bytes.
 const archive=await fs.readFile(path.join(directory,'cytask-help.zip'));
 let offset=0;const packed=new Map();
 const {inflateRawSync}=await import('node:zlib');
 while(archive.readUInt32LE(offset)===0x04034b50){
  const method=archive.readUInt16LE(offset+8),size=archive.readUInt32LE(offset+18),length=archive.readUInt16LE(offset+26),extra=archive.readUInt16LE(offset+28);
  const name=archive.subarray(offset+30,offset+30+length).toString('utf8');
  assert.ok(name.startsWith('CyTask-help/')&&!name.includes('..')&&!name.includes('\\'),'Expected offline archive entry');
  const start=offset+30+length+extra,bytes=archive.subarray(start,start+size);
  assert.ok(!packed.has(name),'Duplicate archive entry');
  assert.ok(method===0||method===8,'Supported offline compression');
  packed.set(name,method===8?inflateRawSync(bytes):bytes);offset=start+size;
 }
 assert.equal(packed.size,archived.length,'Complete offline archive');
 for(const [name,bytes]of archived)assert.ok(bytes.equals(packed.get('CyTask-help/'+name)??Buffer.alloc(0)),'Current offline archive resource: '+name);
 return files.sort();
}

export async function stageHelpPages(source,destination){
 const build=path.join(root,'.build'),target=path.resolve(destination),relative=path.relative(build,target);
 assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Site output must stay below .build');
 const files=await inspectHelpExport(source);
 const old=await fs.lstat(target).catch(()=>null);assert.ok(!old?.isSymbolicLink(),'Site output must not be a link');
 await fs.rm(target,{recursive:true,force:true});await fs.mkdir(target,{recursive:true});
 for(const name of files){await fs.mkdir(path.dirname(path.join(target,name)),{recursive:true});await fs.copyFile(path.join(source,name),path.join(target,name));}
 await fs.writeFile(path.join(target,'.nojekyll'),'');
 return files;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const files=await stageHelpPages(path.join(root,'apps/web/public/help'),path.join(root,'.build/pages'));
 console.log('CyDoc site ready: '+files.length+' reader resources, both languages and the offline archive.');
}
