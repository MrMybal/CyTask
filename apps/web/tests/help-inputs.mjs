import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL("../../../",import.meta.url));
const docker=await fs.readFile(path.join(root,"infra/docker/Dockerfile"),"utf8");
const copies=[];let stage=0;
for(const line of docker.split(/\r?\n/)){
 if(line.startsWith("FROM ")&&++stage>1)break;
 const copy=/^COPY (.+) \S+$/.exec(line);if(!copy)continue;
 for(const source of copy[1].split(/\s+/)){
  const name=source.replace(/\/$/,"");
  copies.push({name,directory:(await fs.stat(path.join(root,name))).isDirectory()});
 }
}
const required=[".CyDocBuild","packages/sdk-js/src/index.mjs","LICENSE","scripts/build-help.mjs",
 "apps/server/src/CyTask.Api/Contracts/openapi.json"];
for(const file of required)assert.ok(copies.some(entry=>file===entry.name||entry.directory&&file.startsWith(entry.name+"/")),"Documentation input copied to Docker Web stage: "+file);
for(const file of [".CyDocBuild/package-lock.json","apps/web/package-lock.json"]){
 const lock=JSON.parse(await fs.readFile(path.join(root,file),"utf8")),dependency=lock.packages["node_modules/cydoc"];
 const archive=path.resolve(root,path.dirname(file),dependency.resolved.slice(5));
 assert.equal(dependency.integrity,"sha512-"+createHash("sha512").update(await fs.readFile(archive)).digest("base64"),"Pinned local CyDoc archive: "+file);
 assert.equal(lock.packages["node_modules/three"],undefined,"No unselected mesh runtime");
}
console.log("PASS: Docker documentation input inventory and both pinned CyDoc archives (not a Docker image build).");
