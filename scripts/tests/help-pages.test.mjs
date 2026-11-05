import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectHelpExport,stageHelpPages} from '../stage-help-pages.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
await fs.mkdir(path.join(root,'.build'),{recursive:true});
const fixture=await fs.mkdtemp(path.join(root,'.build/help-pages-test-'));
const input=path.join(fixture,'input');await fs.cp(path.join(root,'apps/web/public/help'),input,{recursive:true});

test('The Pages site is the complete unchanged CyDoc export',async()=>{
 const files=await inspectHelpExport(input);
 const destination=path.join(fixture,'site');
 assert.deepEqual(await stageHelpPages(input,destination),files);
 assert.equal(await fs.readFile(path.join(destination,'.nojekyll'),'utf8'),'');
 for(const file of files)assert.ok((await fs.readFile(path.join(input,file))).equals(await fs.readFile(path.join(destination,file))),file);
 assert.deepEqual(files.filter(name=>name.startsWith('media-')),['media-gallery.js','media-image.js']);
});
test('Unknown files are rejected before an existing site is replaced',async()=>{
 const destination=path.join(fixture,'kept');await fs.mkdir(destination);await fs.writeFile(path.join(destination,'marker.txt'),'previous site');
 const extra=path.join(input,'application-state.json');await fs.writeFile(extra,'{}');
 try{await assert.rejects(stageHelpPages(input,destination),/Unexpected export file/);assert.equal(await fs.readFile(path.join(destination,'marker.txt'),'utf8'),'previous site');}
 finally{await fs.unlink(extra);}
});
test('The site must contain its relative reader dependencies',async()=>{
 const original=await fs.readFile(path.join(input,'index.html'),'utf8');
 await fs.writeFile(path.join(input,'index.html'),original.replace('src="viewer.js"','src="https://example.invalid/reader.js"'));
 try{await assert.rejects(inspectHelpExport(input),/Bundled relative HTML resource/);}
 finally{await fs.writeFile(path.join(input,'index.html'),original);}
});
test('The offline archive cannot lag behind the published reader',async()=>{
 const file=path.join(input,'cytask.css'),original=await fs.readFile(file);
 await fs.appendFile(file,'\n/* fixture change */');
 try{await assert.rejects(inspectHelpExport(input),/Current offline archive resource/);}
 finally{await fs.writeFile(file,original);}
});
test('Site staging cannot replace a directory outside build outputs',async()=>{
 await assert.rejects(stageHelpPages(input,root),/Site output must stay below/);
});
test('Linked resources cannot be included in the artifact',async context=>{
 const link=path.join(input,'assets','linked.png');
 try{await fs.symlink(path.join(input,'assets/favicon.png'),link);}catch(error){if(['EPERM','EACCES'].includes(error.code)){context.skip('Symlink creation not available on this host');return;}throw error;}
 try{await assert.rejects(inspectHelpExport(input),/must not contain links/);}finally{await fs.unlink(link);}
});
