import {cpSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {zipSync} from 'fflate';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const destination=path.resolve(root,'../../../apps/web/public/plugins/cymd');
mkdirSync(destination,{recursive:true});cpSync(path.join(root,'dist'),destination,{recursive:true});
cpSync(path.resolve(root,'../LICENSE'),path.join(destination,'LICENSE.txt'));
const source={};
function collect(relative){const full=path.join(root,relative);for(const entry of readdirSync(full,{withFileTypes:true})){
  const name=relative+'/'+entry.name;if(entry.isDirectory())collect(name);else source[name]=readFileSync(path.join(root,name));}}
for(const folder of ['src','public','locales','scripts'])collect(folder);
for(const name of ['index.html','package.json','package-lock.json','tsconfig.json','vite.config.ts'])source[name]=readFileSync(path.join(root,name));
source['LICENSE']=readFileSync(path.resolve(root,'../LICENSE'));
source['INTEGRATION.md']=readFileSync(path.resolve(root,'../README.md'));
writeFileSync(path.join(destination,'source.zip'),zipSync(source));
writeFileSync(path.join(destination,'plugin.json'),JSON.stringify({id:'cymd',name:'CyMD',version:'0.1.4',license:'AGPL-3.0-only',entry:'index.html',protocol:'cymd.integration',protocolVersion:1}));
console.log('CyMD editor and corresponding source bundle prepared.');
