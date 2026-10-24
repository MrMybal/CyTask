import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import assert from 'node:assert/strict';
const repo=resolve(fileURLToPath(new URL('../../../../',import.meta.url)));
const temp=mkdtempSync(join(tmpdir(),'CyTask-pg-regression-'));
const localDotnet=join(repo,'.tools/dotnet',process.platform==='win32'?'dotnet.exe':'dotnet');
const configuration=process.env.CYTASK_TEST_CONFIGURATION ?? 'Debug';
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
const pgPort=await freePort();const httpPort=await freePort();
const db=await PGlite.create();
const socket=new PGLiteSocketServer({db,host:'127.0.0.1',port:pgPort,maxConnections:4});
await socket.start();
const url=`http://127.0.0.1:${httpPort}`;
const proc=spawn(existsSync(localDotnet)?localDotnet:'dotnet',[join(repo,`apps/server/src/CyTask.Api/bin/${configuration}/net10.0/CyTask.Api.dll`)],{
  cwd:join(repo,'apps/server/src/CyTask.Api'),windowsHide:true,
  env:{...process.env,ASPNETCORE_ENVIRONMENT:'Production',ASPNETCORE_URLS:url,
    CyTask__UseInMemoryStore:'false',CyTask__LocalMode:'false',CyTask__ApplyMigrations:'true',
    CyTask__DatabaseConnection:`Host=127.0.0.1;Port=${pgPort};Database=postgres;Username=postgres;SSL Mode=Disable;Maximum Pool Size=1;Timeout=5;Command Timeout=10`,
    CyTask__PluginSecretKey:randomBytes(32).toString('base64'),CyTask__MediaStoragePath:temp,
    CyTask__OutboxPollMilliseconds:'60000',CyTask__MediaReviewSeconds:'3600'},
  stdio:['ignore','pipe','pipe']
});
let logs=''; proc.stdout.on('data',b=>logs=(logs+b).slice(-20000));proc.stderr.on('data',b=>logs=(logs+b).slice(-20000));
let cookie='',csrf='';
async function request(path,method='GET',body,expected=200){
  const response=await fetch(url+'/api/v1'+path,{method,headers:{Cookie:cookie,'X-CSRF-Token':csrf,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  if(path==='/bootstrap')cookie=response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
  const text=await response.text();let value;try{value=JSON.parse(text)}catch{value=text}
  assert.equal(response.status,expected,method+' '+path+' '+JSON.stringify(value)+'\n'+logs.split('\n').filter(line=>/fail:|Exception|ERROR/.test(line)).map(line=>line.split(' at ')[0]).slice(-4).join('\n'));return value;
}
try{
  for(let i=0;i<200;i++){
    if(proc.exitCode!==null)throw Error('server exited '+logs.slice(-2500));
    try{if((await fetch(url+'/health/ready')).ok)break;}catch{}
    await new Promise(r=>setTimeout(r,50));
  }
  const owner=await request('/bootstrap','POST',{email:'owner@fixture.invalid',displayName:'Fixture owner',password:randomBytes(24).toString('base64url'),organizationName:'Fixture team'});
  csrf=owner.csrfToken;
  const member=randomUUID();
  await db.query('INSERT INTO users(id,normalized_email,display_name,password_hash,created_at) VALUES($1,$2,$3,$4,now())',[member,'member@fixture.invalid','Fixture member','not-an-interactive-account']);
  await db.query("INSERT INTO organization_members(organization_id,user_id,role,created_at) VALUES($1,$2,'member',now())",[owner.organizationId,member]);
  const project=await request('/projects','POST',{name:'Postgres fixture',key:'PG'},201);
  const task=await request(`/projects/${project.id}/tasks`,'POST',{title:'Two assignees',description:'Fixture',assigneeIds:[owner.userId,member]},201);
  const page=await request(`/projects/${project.id}/task-page`);
  assert.equal(page.items[0].assignees.length,2);
  const list=await request(`/projects/${project.id}/tasks`);assert.equal(list[0].assignees.length,2);
  await request(`/tasks/${task.id}`,'PATCH',{title:task.title,status:task.status,priority:'urgent',expectedRevision:task.revision});
  assert.equal((await request(`/projects/${project.id}/task-page`)).items[0].assignees.length,2);
  const s1=await request(`/projects/${project.id}/statuses/todo`,'PATCH',{name:'First',color:'#123456'});
  const s2=await request(`/projects/${project.id}/statuses/todo`,'PATCH',{name:'Second',color:'#ABCDEF'});assert.ok(s2.revision>s1.revision);
  const resource=await request(`/projects/${project.id}/resources`,'POST',{name:'Fixture document',resourceType:'document',body:'Shared fixture'},201);
  const channel=await request(`/projects/${project.id}/chat/channels`,'POST',{name:'Fixture channel',channelType:'channel'},201);
  for(let i=0;i<3;i++)await request(`/chat/channels/${channel.id}/messages`,'POST',{body:`Fixture message ${i}`,resourceIds:[resource.id],mentionedUserIds:[member]},201);
  const messages=await request(`/chat/channels/${channel.id}/messages`);assert.equal(messages.length,3);
  for(const message of messages){assert.equal(message.resources[0].id,resource.id);assert.equal(message.mentionedUserIds[0],member);}
  console.log(JSON.stringify({postgresRegression:{migrations:(await db.query('SELECT max(version) AS v FROM schema_migrations')).rows[0].v,assignees:2,statusRevision:s2.revision,messages:messages.length,attachmentsAndMentions:true}}));
}finally{
  if(proc.exitCode===null){proc.kill();await new Promise(r=>proc.once('exit',r));}
  await socket.stop();await db.close();
  if(temp.startsWith(join(tmpdir(),'CyTask-pg-regression-'))) rmSync(temp,{recursive:true,force:true});
}
