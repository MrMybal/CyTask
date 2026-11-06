// Package a built, pinned upstream checkout without changing it.
import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const source=path.resolve(process.argv[2]??path.join(root,".build/cydoc-upstream"));
const revision="6ddf9a582defb2f11fbb3f992afef6f98dcadc93";
const git=spawnSync("git",["rev-parse","HEAD"],{cwd:source,encoding:"utf8"});
if(git.status!==0||git.stdout.trim()!==revision)throw Error("Use the documented CyDoc revision");
await fs.mkdir(path.join(root,".build"),{recursive:true});
const stage=await fs.mkdtemp(path.join(root,".build/cydoc-vendor-"));
for(const file of ["package.json","LICENSE","README.md","dist","web","src/viewer.css"]){
 await fs.mkdir(path.dirname(path.join(stage,file)),{recursive:true});
 await fs.cp(path.join(source,file),path.join(stage,file),{recursive:true,errorOnExist:true});
}
await fs.mkdir(path.join(stage,"tools"));
for(const file of await fs.readdir(path.join(source,"tools"))){
 if(!file.endsWith(".mjs")||file.startsWith("create-")||file==="dev.mjs")continue;
 await fs.copyFile(path.join(source,"tools",file),path.join(stage,"tools",file));
}
const destination=path.join(root,".CyDocBuild/vendor");
const packed=spawnSync(process.platform==="win32"?"npm.cmd":"npm",["pack","--ignore-scripts","--pack-destination",stage],{cwd:stage,shell:process.platform==="win32",stdio:"inherit"});
if(packed.status!==0)process.exit(packed.status??1);
await fs.copyFile(path.join(stage,"cydoc-0.1.0.tgz"),path.join(destination,"cydoc-0.1.0-6ddf9a5.tgz"));
console.log("CyDoc runtime/compiler archive prepared; upstream files remain unchanged.");
