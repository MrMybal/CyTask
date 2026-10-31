import {PGlite} from '@electric-sql/pglite';
import {PGLiteSocketServer} from '@electric-sql/pglite-socket';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
import assert from 'node:assert/strict';
const repo=resolve(fileURLToPath(new URL('../../../../',import.meta.url)));
const localDotnet=join(repo,'.tools/dotnet',process.platform==='win32'?'dotnet.exe':'dotnet');
const fixture=await mkdtemp(join(tmpdir(),'CyTask-encryption-migration-'));
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
const pgPort=await port(),httpPort=await port(),db=await PGlite.create();
const socket=new PGLiteSocketServer({db,host:'127.0.0.1',port:pgPort,maxConnections:4});await socket.start();
const key=randomBytes(32).toString('base64'),url=`http://127.0.0.1:${httpPort}`;
const env={...process.env,ASPNETCORE_ENVIRONMENT:'Production',ASPNETCORE_URLS:url,
  CyTask__LocalMode:'false',CyTask__UseInMemoryStore:'false',CyTask__ApplyMigrations:'true',
  CyTask__DatabaseConnection:`Host=127.0.0.1;Port=${pgPort};Database=postgres;Username=postgres;SSL Mode=Disable;Maximum Pool Size=1`,
  CyTask__PluginSecretKey:randomBytes(32).toString('base64'),CyTask__MfaPolicy:'disabled',
  CyTask__MfaEncryptionKey:randomBytes(32).toString('base64'),CyTask__MediaStoragePath:fixture,
  CyTask__DataEncryptionKey:key,CyTask__OutboxPollMilliseconds:'60000'};
let child,logs='',exited;
function launch(enabled,offline=false,storageKey=key){
  logs='';child=spawn(existsSync(localDotnet)?localDotnet:'dotnet',[join(repo,'apps/server/src/CyTask.Api/bin/Release/net10.0/CyTask.Api.dll'),...(offline?['--encrypt-storage','--confirm-backup']:[])],
    {cwd:join(repo,'apps/server/src/CyTask.Api'),env:{...env,CyTask__DataEncryptionEnabled:String(enabled),CyTask__DataEncryptionKey:storageKey},windowsHide:true,stdio:['ignore','pipe','pipe']});
  exited=new Promise(r=>child.once('exit',r));child.stdout.on('data',b=>logs=(logs+b).slice(-10000));child.stderr.on('data',b=>logs=(logs+b).slice(-10000));
}
async function ready(){for(let i=0;i<200;i++){if(child.exitCode!==null)throw Error('Fixture server exited: '+logs.slice(-1800));try{if((await fetch(url+'/health/ready')).ok)return;}catch{}await new Promise(r=>setTimeout(r,30));}throw Error('Fixture timeout');}
async function stop(){if(child?.exitCode===null){child.kill();await exited;}}
async function mustExit(){const code=await Promise.race([exited,new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('Fixture exit timeout')),15000);t.unref();})]);return code;}
try{
  launch(false);await ready();const password=randomBytes(24).toString('base64url');
  const boot=await fetch(url+'/api/v1/bootstrap',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'migration@fixture.invalid',displayName:'Migration fixture',password,organizationName:'Fixture'})});assert.equal(boot.status,200);
  const session=await boot.json(),cookie=boot.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  const headers={'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':session.csrfToken};
  let response=await fetch(url+'/api/v1/projects',{method:'POST',headers,body:JSON.stringify({name:'Migration fixture',key:'MIG'})});assert.equal(response.status,201);const project=await response.json();
  response=await fetch(url+`/api/v1/projects/${project.id}/tasks`,{method:'POST',headers,body:JSON.stringify({title:'Migration fixture task',description:'Private fixture text'})});assert.equal(response.status,201);const task=await response.json();await stop();
  for(let index=0;index<12;index++)await db.query("INSERT INTO tasks(id,organization_id,project_id,task_number,title,description,status,created_by,created_at,updated_at) SELECT $1,organization_id,project_id,$2,'Batch fixture title','Batch fixture content',status,created_by,created_at,updated_at FROM tasks WHERE id=$3",[randomUUID(),1000+index,task.id]);
  launch(true);assert.notEqual(await mustExit(),0);assert.equal((await db.query('SELECT title FROM tasks WHERE id=$1',[task.id])).rows[0].title,task.title);
  launch(true,true);assert.equal(await mustExit(),0,logs.slice(-1800));
  assert.ok((await db.query('SELECT title FROM tasks WHERE id=$1',[task.id])).rows[0].title.startsWith('cytask:enc:v1:'));
  assert.equal((await db.query("SELECT count(*)::int AS n FROM tasks WHERE title NOT LIKE 'cytask:enc:v1:%' OR description NOT LIKE 'cytask:enc:v1:%'")).rows[0].n,0);
  launch(true);await ready();response=await fetch(url+`/api/v1/tasks/${task.id}`,{headers});assert.equal(response.status,200);const restored=await response.json();assert.ok(JSON.stringify(restored).includes('Private fixture text'));await stop();
  launch(true,false,randomBytes(32).toString('base64'));assert.notEqual(await mustExit(),0);
  launch(false);assert.notEqual(await mustExit(),0);
  launch(true,true);assert.equal(await mustExit(),0);
  console.log(JSON.stringify({offlineEncryptionMigration:true,plaintextPreservedBeforeConfirmation:true,restart:true,wrongKeyRejected:true,downgradeRejected:true,idempotent:true}));
}finally{await stop();await socket.stop();await db.close();if(fixture.startsWith(join(tmpdir(),'CyTask-encryption-migration-')))await rm(fixture,{recursive:true,force:true});}
