import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const editor=path.join(root,'plugins/cymd/web');const marker=path.join(root,'.build/cymd-dependencies.sha256');
const lock=path.join(editor,'package-lock.json');
const hash=existsSync(lock)?createHash('sha256').update(readFileSync(lock)).digest('hex'):'';
const npm=process.platform==='win32'?'npm.cmd':'npm';
function run(args){const result=spawnSync(npm,args,{cwd:editor,stdio:'inherit',shell:process.platform==='win32'});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status??1);}
if(!existsSync(path.join(editor,'node_modules/vite/package.json'))||!existsSync(marker)||readFileSync(marker,'utf8')!==hash){
  run([existsSync(lock)?'ci':'install','--ignore-scripts','--no-fund','--no-audit']);
  mkdirSync(path.dirname(marker),{recursive:true});writeFileSync(marker,createHash('sha256').update(readFileSync(lock)).digest('hex'));
}
run(['run','build:release']);
