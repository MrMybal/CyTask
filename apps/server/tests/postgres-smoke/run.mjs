import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import assert from 'node:assert/strict';
const repo=resolve(fileURLToPath(new URL('../../../../',import.meta.url)));
const temp=mkdtempSync(join(tmpdir(),'CyTask-pg-regression-'));
const localDotnet=join(repo,'.tools/dotnet',process.platform==='win32'?'dotnet.exe':'dotnet');
const configuration=process.env.CYTASK_TEST_CONFIGURATION ?? 'Debug';
const encryptionEnabled=process.env.CYTASK_TEST_ENCRYPTION==='1';
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
    CyTask__DataEncryptionEnabled:String(encryptionEnabled),CyTask__DataEncryptionKey:encryptionEnabled?randomBytes(32).toString('base64'):'',
    CyTask__MfaPolicy:'optional',CyTask__MfaEmailEnabled:'false',CyTask__MfaEncryptionKey:randomBytes(32).toString('base64'),
    CyTask__OutboxPollMilliseconds:'60000',CyTask__MediaReviewSeconds:'3600'},
  stdio:['ignore','pipe','pipe']
});
let logs=''; proc.stdout.on('data',b=>logs=(logs+b).slice(-20000));proc.stderr.on('data',b=>logs=(logs+b).slice(-20000));
let cookie='',csrf='';
async function request(path,method='GET',body,expected=200){
  const response=await fetch(url+'/api/v1'+path,{method,headers:{Cookie:cookie,'X-CSRF-Token':csrf,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  const cookies=new Map(cookie.split('; ').filter(Boolean).map(value=>{const index=value.indexOf('=');return [value.slice(0,index),value.slice(index+1)];}));
  for(const value of response.headers.getSetCookie()){const pair=value.split(';')[0];const index=pair.indexOf('=');const name=pair.slice(0,index);const contents=pair.slice(index+1);if(contents)cookies.set(name,contents);else cookies.delete(name);}
  cookie=[...cookies].map(([name,value])=>`${name}=${value}`).join('; ');
  const text=await response.text();let value;try{value=JSON.parse(text)}catch{value=text}
  assert.equal(response.status,expected,method+' '+path+' '+JSON.stringify(value)+'\n'+logs.split('\n').filter(line=>/fail:|Exception|ERROR/.test(line)).map(line=>line.split(' at ')[0]).slice(-4).join('\n'));return value;
}
try{
  for(let i=0;i<200;i++){
    if(proc.exitCode!==null)throw Error('server exited '+logs.slice(-2500));
    try{if((await fetch(url+'/health/ready')).ok)break;}catch{}
    await new Promise(r=>setTimeout(r,50));
  }
  const accountPassword=randomBytes(24).toString('base64url');
  const owner=await request('/bootstrap','POST',{email:'owner@fixture.invalid',displayName:'Fixture owner',password:accountPassword,organizationName:'Fixture team'});
  csrf=owner.csrfToken;
  const member=randomUUID();
  await db.query('INSERT INTO users(id,normalized_email,display_name,password_hash,created_at) VALUES($1,$2,$3,$4,now())',[member,'member@fixture.invalid','Fixture member','not-an-interactive-account']);
  await db.query("INSERT INTO organization_members(organization_id,user_id,role,created_at) VALUES($1,$2,'member',now())",[owner.organizationId,member]);
  const project=await request('/projects','POST',{name:'Postgres fixture',key:'PG'},201);
  const task=await request(`/projects/${project.id}/tasks`,'POST',{title:'Two assignees',description:encryptionEnabled?'Fixture'+'x'.repeat(19993):'Fixture',assigneeIds:[owner.userId,member]},201);
  const page=await request(`/projects/${project.id}/task-page`);
  assert.equal(page.items[0].assignees.length,2);
  const list=await request(`/projects/${project.id}/tasks`);assert.equal(list[0].assignees.length,2);
  if(encryptionEnabled){
    const raw=(await db.query('SELECT title,description FROM tasks WHERE id=$1',[task.id])).rows[0];
    assert.ok(raw.title.startsWith('cytask:enc:v1:'));assert.ok(raw.description.startsWith('cytask:enc:v1:'));
    await assert.rejects(db.query('UPDATE tasks SET title=$1 WHERE id=$2',['Unencrypted fixture',task.id]),error=>error.code==='23514');
    assert.equal((await request(`/projects/${project.id}/task-page?query=Two&sort=title`)).items[0].title,'Two assignees');
    assert.equal((await request('/search?q=Two')).some(hit=>hit.title==='Two assignees'),true);
  }
  await request(`/tasks/${task.id}`,'PATCH',{title:task.title,status:task.status,priority:'urgent',expectedRevision:task.revision});
  assert.equal((await request(`/projects/${project.id}/task-page`)).items[0].assignees.length,2);
  if(encryptionEnabled){
    const dependency=await request(`/projects/${project.id}/tasks`,'POST',{title:'R'.repeat(240),description:'Fixture'},201);
    await request(`/tasks/${task.id}/dependencies`,'POST',{dependsOnTaskId:dependency.id},201);
    assert.equal((await request(`/tasks/${task.id}/dependencies`)).dependsOn[0].title,dependency.title);
  }
  const s1=await request(`/projects/${project.id}/statuses/todo`,'PATCH',{name:'First',color:'#123456'});
  const s2=await request(`/projects/${project.id}/statuses/todo`,'PATCH',{name:'Second',color:'#ABCDEF'});assert.ok(s2.revision>s1.revision);
  const resource=await request(`/projects/${project.id}/resources`,'POST',{name:'Fixture document',resourceType:'document',body:'Shared fixture'},201);
  const channel=await request(`/projects/${project.id}/chat/channels`,'POST',{name:'Fixture channel',channelType:'channel'},201);
  for(let i=0;i<3;i++)await request(`/chat/channels/${channel.id}/messages`,'POST',{body:`Fixture message ${i}`,resourceIds:[resource.id],mentionedUserIds:[member]},201);
  const messages=await request(`/chat/channels/${channel.id}/messages`);assert.equal(messages.length,3);
  if(encryptionEnabled){
    assert.ok((await db.query('SELECT body FROM chat_messages LIMIT 1')).rows[0].body.startsWith('cytask:enc:v1:'));
    const raw=(await db.query('SELECT name,body FROM project_resources WHERE id=$1',[resource.id])).rows[0];
    assert.ok(raw.name.startsWith('cytask:enc:v1:'));assert.ok(raw.body.startsWith('cytask:enc:v1:'));
    assert.equal(messages[0].body,'Fixture message 0');
    assert.equal((await request(`/projects/${project.id}/resources`))[0].name,'Fixture document');
  }
  for(const message of messages){assert.equal(message.resources[0].id,resource.id);assert.equal(message.mentionedUserIds[0],member);}
  let space=(await request(`/projects/${project.id}/space`)).space;
  space=await request(`/projects/${project.id}/rooms`,'POST',{name:'Release news',kind:'news',expectedRevision:space.revision},201);
  assert.equal(space.revision,1);const news=space.rooms.at(-1);assert.ok(news.targetId);
  await request(`/projects/${project.id}/space`,'PUT',{...space,expectedRevision:0},409);
  space=await request(`/projects/${project.id}/space`,'PUT',{...space,visibility:'private',expectedRevision:space.revision});
  assert.equal(space.revision,2);
  await request(`/projects/${project.id}/plugins/dev.cytask.unreal`,'PUT');
  const target=`/projects/${project.id}/content/message/${messages[0].id}/plugins/dev.cytask.unreal/context`;
  for(let revision=0;revision<2;revision++){
    const saved=await request(target,'PUT',{data:{mapPath:'/Game/Maps/Fixture',notes:`**Revision ${revision+1}**`},expectedRevision:revision});assert.equal(saved.revision,revision+1);
  }
  await request(target,'PUT',{data:{notes:'Stale'},expectedRevision:0},409);
  assert.equal((await request(target)).data.notes,'**Revision 2**');
  const activity=await request(`/projects/${project.id}/rooms/activity`);assert.equal(activity.find(item=>item.channelId===channel.id).messageCount,3);
  const group=await request(`/projects/${project.id}/chat/channels`,'POST',{name:'Private fixture',channelType:'group',memberIds:[]},201);
  const privateMessage=await request(`/chat/channels/${group.id}/messages`,'POST',{body:'Private fixture message'},201);
  await request(`/projects/${project.id}/content/message/${privateMessage.id}/plugins/dev.cytask.unreal/context`);
  const sharedImage=randomUUID();
  const fixtureImageName=encryptionEnabled?(await db.query('SELECT name FROM project_resources WHERE id=$1',[resource.id])).rows[0].name:'fixture.png';
  await db.query("INSERT INTO project_resources(id,organization_id,project_id,resource_type,name,declared_content_type,detected_content_type,status,created_by,created_at,updated_at) VALUES($1,$2,$3,'file',$5,'image/png','image/png','available',$4,now(),now())",[sharedImage,owner.organizationId,project.id,owner.userId,fixtureImageName]);
  await request(`/projects/${project.id}/plugins/dev.cytask.cyannota`,'PUT');
  const annotationTarget=`/projects/${project.id}/content/resource/${sharedImage}/plugins/dev.cytask.cyannota/annotate`;
  for(let revision=0;revision<2;revision++)assert.equal((await request(annotationTarget,'PUT',{data:{version:1,annotations:[],title:`Shared ${revision+1}`},expectedRevision:revision})).revision,revision+1);
  assert.equal((await request(annotationTarget)).data.title,'Shared 2');
  assert.equal((await db.query("SELECT count(*)::int AS n FROM outbox_events WHERE event_type='project.space_updated'")).rows[0].n,2);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM outbox_events WHERE event_type='project.content_plugin_updated'")).rows[0].n,4);
  const oldCookie=cookie;let flow=await request('/account/mfa','POST',{password:accountPassword,action:'enable-totp'});
  flow=(await request('/auth/mfa/advance','POST',{token:flow.token,operation:'method',method:'totp'})).challenge;
  const secret=flow.secret;let bits=0,base32=0;const key=[];
  for(const character of secret){base32=(base32<<5)|'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(character);bits+=5;if(bits>=8){bits-=8;key.push((base32>>bits)&255);}}
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30_000)));const digest=createHmac('sha1',Buffer.from(key)).update(counter).digest();const offset=digest.at(-1)&15;
  const code=((digest.readUInt32BE(offset)&0x7fffffff)%1_000_000).toString().padStart(6,'0');
  const enrolled=await request('/auth/mfa/advance','POST',{token:flow.token,operation:'verify',method:'totp',code});csrf=enrolled.session.csrfToken;
  assert.equal(enrolled.recoveryCodes.length,10);assert.equal((await request('/account/mfa')).authenticatorConfigured,true);
  const stored=(await db.query('SELECT data FROM account_mfa WHERE user_id=$1',[owner.userId])).rows[0].data;
  assert.ok(stored.TotpSecret!==secret&&stored.TotpSecret.startsWith('v1.'));assert.equal(stored.RecoveryHashes.length,10);assert.ok(!JSON.stringify(stored).includes(secret));
  const denied=await fetch(url+'/api/v1/me',{headers:{Cookie:oldCookie}});assert.equal(denied.status,401);
  flow=(await request('/sessions','POST',{email:'owner@fixture.invalid',password:accountPassword})).challenge;
  const recovered=await request('/auth/mfa/advance','POST',{token:flow.token,operation:'verify',method:'recovery',code:enrolled.recoveryCodes[0]});csrf=recovered.session.csrfToken;
  assert.equal((await request('/account/mfa')).recoveryCodesRemaining,9);
  console.log(JSON.stringify({postgresRegression:{migrations:(await db.query('SELECT max(version) AS v FROM schema_migrations')).rows[0].v,assignees:2,statusRevision:s2.revision,messages:messages.length,attachmentsAndMentions:true,mfaPersistence:true,sessionRevocation:true,recoveryConsumed:true}}));
}finally{
  if(proc.exitCode===null){proc.kill();await new Promise(r=>proc.once('exit',r));}
  await socket.stop();await db.close();
  if(temp.startsWith(join(tmpdir(),'CyTask-pg-regression-'))) rmSync(temp,{recursive:true,force:true});
}
