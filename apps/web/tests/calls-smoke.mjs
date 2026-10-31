import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,mkdirSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
import {chromium} from 'playwright';

// Synthetic devices only: never request the tester's real microphone, camera or display.
const root=fileURLToPath(new URL('../../../',import.meta.url));
const temporary=mkdtempSync(path.join(tmpdir(),'CyTask-call-test-'));
const output=path.join(root,'.build','call-tests');mkdirSync(output,{recursive:true});
const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));const origin=`http://127.0.0.1:${port}`;
const localDotnet=path.join(root,'.tools','dotnet',process.platform==='win32'?'dotnet.exe':'dotnet');
const fixtureEnvironment=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.toLowerCase().startsWith('cytask__')));
const server=spawn(existsSync(localDotnet)?localDotnet:'dotnet',[path.join(root,'apps/server/src/CyTask.Api/bin/Release/net10.0/CyTask.Api.dll')],{
  cwd:path.join(root,'apps/server/src/CyTask.Api'),windowsHide:true,
  env:{...fixtureEnvironment,ASPNETCORE_ENVIRONMENT:'Development',ASPNETCORE_URLS:origin,ASPNETCORE_WEBROOT:path.join(root,'apps/web/dist'),
    CyTask__UseInMemoryStore:'true',CyTask__LocalMode:'false',CyTask__MediaStoragePath:temporary,
    CyTask__WebRtcStunUrls:'',CyTask__WebRtcTurnUrls:'',CyTask__WebRtcTurnSharedSecret:'',CyTask__WebRtcRelayOnly:'false',CyTask__CallAccessCheckSeconds:'1'},
  stdio:['ignore','pipe','pipe']});
let logs='';server.stdout.on('data',value=>logs=(logs+value).slice(-6000));server.stderr.on('data',value=>logs=(logs+value).slice(-6000));
let browser;const errors=[];const pages=[];
async function api(context,route,method='GET',body,csrf){
  const response=await context.request.fetch(origin+'/api/v1'+route,{method,data:body,headers:csrf?{'X-CSRF-Token':csrf}:{}});
  assert.ok(response.ok(),`${method} ${route}: ${response.status()}`);return response.status()===204?null:response.json();
}
async function instrument(context){
  await context.addInitScript(()=>{
    window.__callPeers=[];window.__callCaptures=[];window.__callSignals=[];
    const NativeSocket=window.WebSocket;
    window.WebSocket=class extends NativeSocket{constructor(...args){super(...args);this.addEventListener('message',event=>{
      const {type,peerId,sender,state,peers}=JSON.parse(event.data);window.__callSignals.push({type,peerId,sender,state,peers});
    });}};
    const Native=window.RTCPeerConnection;
    window.RTCPeerConnection=class extends Native{constructor(...args){super(...args);window.__callPeers.push(this);}};
    const capture=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const replace=RTCRtpSender.prototype.replaceTrack;
    RTCRtpSender.prototype.replaceTrack=function(track){
      if(window.__failAudioReplacement&&track?.kind==='audio'){window.__failAudioReplacement=false;return Promise.reject(new DOMException('Synthetic input replacement failure','InvalidModificationError'));}
      return replace.call(this,track);
    };
    navigator.mediaDevices.getUserMedia=async constraints=>{
      if(window.__denyMicrophone&&constraints.audio)throw new DOMException('Synthetic permission refusal','NotAllowedError');
      const stream=await capture(constraints);window.__callCaptures.push(stream);
      if(window.__deferVideo&&constraints.video){window.__deferVideo=false;await new Promise(resolve=>{window.__releaseVideo=resolve;});}
      return stream;
    };
    navigator.mediaDevices.getDisplayMedia=async()=>{
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const drawing=canvas.getContext('2d');let tick=0;
      const draw=()=>{drawing.fillStyle=`hsl(${tick++%360} 45% 30%)`;drawing.fillRect(0,0,640,360);drawing.fillStyle='white';drawing.font='24px sans-serif';drawing.fillText('CyTask simulated shared screen',30,80);};
      draw();const timer=setInterval(draw,66);const stream=canvas.captureStream(15);
      for(const track of stream.getTracks()){const stop=track.stop.bind(track);track.stop=()=>{clearInterval(timer);stop();};}
      window.__callCaptures.push(stream);window.__sharedScreen=stream;return stream;
    };
  });
}
async function open(context,url){
  const page=await context.newPage();pages.push(page);page.setDefaultTimeout(20_000);
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto(url);await page.getByRole('button',{name:'Join video',exact:true}).waitFor();return page;
}
async function join(page){await page.getByRole('button',{name:'Join video',exact:true}).click();await page.getByRole('button',{name:'Leave',exact:true}).waitFor();}
async function connected(page,count){
  await page.waitForFunction(expected=>document.querySelectorAll('.call-participant.remote[data-connection="connected"]').length===expected,count);
}
async function videoFrames(page,count){await page.waitForFunction(expected=>[...document.querySelectorAll('.call-participant.remote > video')].filter(video=>video.videoWidth>0).length===expected,count);}
async function noCaptures(page){await page.waitForFunction(()=>window.__callCaptures.every(stream=>stream.getTracks().every(track=>track.readyState==='ended')));}
try{
  let ready=false;
  for(let attempt=0;attempt<200;attempt++){
    if(server.exitCode!==null)throw Error('Fixture server failed to start.');
    try{if((await fetch(origin+'/health/ready')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.ok(ready,'The isolated fixture server must become ready.');
  browser=await chromium.launch({headless:true,...(process.env.CYTASK_TEST_BROWSER?{channel:process.env.CYTASK_TEST_BROWSER}:{}),
    args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  const owner=await browser.newContext({viewport:{width:1480,height:950}});await instrument(owner);
  const password=randomBytes(24).toString('base64url');
  const identity=await api(owner,'/bootstrap','POST',{email:'call-owner@fixture.invalid',displayName:'Studio Demo',password,organizationName:'Call Fixture Studio'});
  const project=await api(owner,'/projects','POST',{name:'Nebula Station · Live',key:'LIVE'},identity.csrfToken);
  const space=await api(owner,`/projects/${project.id}/rooms`,'POST',{name:'team-meeting',kind:'video',topic:'A simulated audio, camera and screen-sharing call',expectedRevision:0},identity.csrfToken);
  const room=space.rooms.at(-1);const channelId=room.targetId;const url=`${origin}/#/servers/${project.id}/rooms/${room.id}`;
  const other=await api(owner,`/projects/${project.id}/rooms`,'POST',{name:'other-meeting',kind:'voice',expectedRevision:space.revision},identity.csrfToken);
  const members=[];
  for(const [index,name] of ['Alice Demo','Noah Demo','Read Only Demo'].entries()){
    const context=await browser.newContext({viewport:{width:1480,height:950}});await instrument(context);
    const invitation=await api(owner,'/invitations','POST',{email:`call-member-${index}@fixture.invalid`,role:index===2?'viewer':'member'},identity.csrfToken);
    const user=await api(context,'/invitations/accept','POST',{token:invitation.token,displayName:name,password});members.push({context,user});
  }
  const configuration=await api(owner,`/chat/channels/${channelId}/call`);assert.equal(configuration.relayConfigured,false);assert.deepEqual(configuration.iceServers,[]);
  const p1=await open(owner,url);const p2=await open(members[0].context,url);const p3=await open(members[1].context,url);
  console.log(`Call fixture ready at ${origin}`);
  await Promise.all([join(p1),join(p2),join(p3)]);
  await Promise.all([connected(p1,2),connected(p2,2),connected(p3,2)]);
  await Promise.all([videoFrames(p1,2),videoFrames(p2,2),videoFrames(p3,2)]);
  const audio=await p1.evaluate(async()=>{const reports=await Promise.all(window.__callPeers.map(peer=>peer.getStats()));return reports.flatMap(report=>[...report.values()]).filter(item=>item.type==='inbound-rtp'&&item.kind==='audio').some(item=>item.bytesReceived>0);});
  assert.ok(audio,'Real RTP audio packets were received from synthetic microphones.');
  await p1.getByRole('button',{name:'Mute microphone',exact:true}).click();
  assert.ok(await p1.evaluate(()=>window.__callPeers.every(peer=>peer.getSenders().filter(sender=>sender.track?.kind==='audio').every(sender=>!sender.track.enabled))));
  await p2.waitForFunction(()=>[...document.querySelectorAll('.call-participant.remote footer')].some(footer=>footer.textContent.includes('Studio Demo')&&footer.textContent.includes('Microphone muted')));
  await p1.getByRole('button',{name:'Unmute microphone',exact:true}).click();
  await p1.getByRole('button',{name:'Deafen',exact:true}).click();assert.ok(await p1.locator('.call-participant.remote audio').evaluateAll(elements=>elements.every(element=>element.muted)));
  await p1.getByRole('button',{name:'Enable sound',exact:true}).click();
  await p1.getByRole('button',{name:'Turn camera off',exact:true}).click();await videoFrames(p2,1);
  await p1.getByRole('button',{name:'Turn camera on',exact:true}).click();await videoFrames(p2,2);
  await p1.getByRole('button',{name:'Share screen',exact:true}).click();
  await p2.waitForFunction(()=>[...document.querySelectorAll('[data-screen="remote"] video')].some(video=>video.videoWidth>0));await videoFrames(p2,2);
  await p1.screenshot({path:path.join(output,'live-call.png')});
  await p1.evaluate(()=>{const track=window.__sharedScreen.getVideoTracks()[0];track.stop();track.dispatchEvent(new Event('ended'));});
  await p2.locator('[data-screen="remote"]').waitFor({state:'hidden'});await videoFrames(p2,2);
  await Promise.all([p1,p2,p3].map(page=>page.getByRole('button',{name:'Retry connection',exact:true}).click()));
  await Promise.all([p1,p2,p3].map(page=>page.waitForFunction(()=>window.__callPeers.every(peer=>peer.connectionState==='connected'&&peer.signalingState==='stable'&&peer.getTransceivers().length===3))));
  await p1.getByRole('button',{name:'Devices',exact:true}).click();
  const microphone=p1.getByRole('combobox',{name:'Microphone',exact:true});
  const inputs=await microphone.locator('option').evaluateAll(options=>options.map(option=>option.value).filter(Boolean));assert.ok(inputs.length);
  await p1.evaluate(()=>{window.__previousMicrophone=window.__callPeers[0].getSenders().find(sender=>sender.track?.kind==='audio').track;});
  await microphone.selectOption(inputs[0]);
  await p1.waitForFunction(()=>window.__previousMicrophone.readyState==='ended'&&window.__callPeers.every(peer=>peer.getSenders().some(sender=>sender.track?.kind==='audio'&&sender.track.readyState==='live')));
  await p1.getByRole('button',{name:'Mute microphone',exact:true}).click();
  await p1.evaluate(()=>{window.__previousMicrophone=window.__callPeers[0].getSenders().find(sender=>sender.track?.kind==='audio').track;});
  await microphone.selectOption('');await p1.waitForFunction(()=>window.__previousMicrophone.readyState==='ended');
  assert.ok(await p1.evaluate(()=>window.__callPeers.every(peer=>peer.getSenders().filter(sender=>sender.track?.kind==='audio').every(sender=>!sender.track.enabled))));
  await p1.getByRole('button',{name:'Unmute microphone',exact:true}).click();
  await p1.evaluate(()=>{window.__previousMicrophone=window.__callPeers[0].getSenders().find(sender=>sender.track?.kind==='audio').track;window.__failAudioReplacement=true;});
  await microphone.selectOption(inputs[0]);await p1.getByText('The microphone could not be changed.',{exact:true}).waitFor();
  assert.ok(await p1.evaluate(()=>window.__previousMicrophone.readyState==='live'&&window.__callPeers.every(peer=>peer.getSenders().some(sender=>sender.track===window.__previousMicrophone))));
  await p1.evaluate(()=>{const track=window.__previousMicrophone;track.stop();track.dispatchEvent(new Event('ended'));});
  await p1.getByRole('button',{name:'Unmute microphone',exact:true}).click();await p1.getByRole('button',{name:'Mute microphone',exact:true}).waitFor();
  assert.ok(await p1.evaluate(()=>window.__callPeers.every(peer=>peer.getSenders().some(sender=>sender.track?.kind==='audio'&&sender.track.enabled&&sender.track.readyState==='live'))));
  const camera=p1.getByRole('combobox',{name:'Camera',exact:true});
  const cameras=await camera.locator('option').evaluateAll(options=>options.map(option=>option.value).filter(Boolean));assert.ok(cameras.length);
  await p1.evaluate(()=>{window.__previousCamera=window.__callPeers[0].getSenders().find(sender=>sender.track?.kind==='video').track;});
  await camera.selectOption(cameras[0]);await p1.waitForFunction(()=>window.__previousCamera.readyState==='ended');await videoFrames(p2,2);
  await p1.getByRole('button',{name:'Devices',exact:true}).click();
  const twin=await open(owner,url);await join(twin);await connected(p2,3);await videoFrames(p2,3);
  assert.equal(new Set(await p2.locator('.call-participant.remote').evaluateAll(elements=>elements.map(element=>element.dataset.peerId))).size,3);
  await twin.getByRole('button',{name:'Leave',exact:true}).click();await noCaptures(twin);await connected(p2,2);
  await p3.getByRole('button',{name:'Leave',exact:true}).click();await noCaptures(p3);await connected(p1,1);
  await p3.evaluate(()=>{window.__denyMicrophone=true;});await p3.getByRole('button',{name:'Join video',exact:true}).click();
  await p3.getByText('Microphone access was denied or the device is unavailable.',{exact:true}).waitFor();await p3.getByRole('button',{name:'Join video',exact:true}).waitFor();
  await p3.evaluate(()=>{window.__denyMicrophone=false;window.__deferVideo=true;});await p3.getByRole('button',{name:'Join video',exact:true}).click();
  await p3.waitForFunction(()=>Boolean(window.__releaseVideo));await p3.getByRole('button',{name:'Cancel connection',exact:true}).click();await p3.evaluate(()=>window.__releaseVideo());await noCaptures(p3);
  const viewer=await open(members[2].context,url);assert.ok(await viewer.getByRole('button',{name:'Join video',exact:true}).isDisabled());
  assert.equal((await members[2].context.request.get(`${origin}/api/v1/chat/channels/${channelId}/call`)).status(),403);
  await viewer.close();
  const settings=(await api(owner,`/projects/${project.id}/space`)).space;
  await api(owner,`/projects/${project.id}/space`,'PUT',{...settings,members:[{userId:members[0].user.userId,role:'viewer'}],expectedRevision:settings.revision},identity.csrfToken);
  await p2.getByRole('button',{name:'Join video',exact:true}).waitFor();await noCaptures(p2);await connected(p1,0);
  await p1.locator('.room-link').filter({hasText:'other-meeting'}).click();await noCaptures(p1);
  assert.ok(await p1.evaluate(()=>window.__callPeers.every(peer=>peer.connectionState==='closed')));
  await p3.locator('.room-link').filter({hasText:'other-meeting'}).click();
  await Promise.all([p1,p3].map(page=>page.getByRole('button',{name:'Join voice',exact:true}).click()));
  await Promise.all([connected(p1,1),connected(p3,1)]);await videoFrames(p3,0);
  await p3.waitForFunction(async()=>{const reports=await Promise.all(window.__callPeers.filter(peer=>peer.connectionState==='connected').map(peer=>peer.getStats()));return reports.some(report=>[...report.values()].some(item=>item.type==='inbound-rtp'&&item.kind==='audio'&&item.bytesReceived>0));});
  await p1.getByRole('button',{name:'Turn camera on',exact:true}).click();await videoFrames(p3,1);
  await Promise.all([p1,p3].map(page=>page.getByRole('button',{name:'Leave',exact:true}).click()));await Promise.all([noCaptures(p1),noCaptures(p3)]);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({calls:{participants:3,rtpAudio:true,liveCamera:true,concurrentScreen:true,mute:true,deafen:true,sameAccountTabs:true,iceRestart:true,deviceSwitch:true,mutedDeviceSwitch:true,inputRollback:true,microphoneRecovery:true,cancelledCapture:true,revokedAccess:true,devicesReleased:true}}));
}catch(error){
  for(const page of pages)if(!page.isClosed())console.error(JSON.stringify(await page.evaluate(()=>({
    signals:window.__callSignals,connections:window.__callPeers.map(peer=>({state:peer.connectionState,
      tracks:peer.getTransceivers().map(slot=>({mid:slot.mid,direction:slot.currentDirection,sent:slot.sender.track?.kind,received:slot.receiver.track.kind,muted:slot.receiver.track.muted}))})),
    tiles:[...document.querySelectorAll('.call-participant')].map(tile=>({text:tile.textContent,videos:tile.querySelectorAll('video').length}))
  }))));
  for(let index=0;index<pages.length;index++)if(!pages[index].isClosed())await pages[index].screenshot({path:path.join(output,`failure-${index}.png`)}).catch(()=>undefined);
  console.error(JSON.stringify({browserErrors:errors}));throw error;
}finally{
  await browser?.close();if(server.exitCode===null){server.kill();await new Promise(resolve=>server.once('exit',resolve));}
  const parent=path.resolve(tmpdir());if(path.dirname(temporary)===parent&&path.basename(temporary).startsWith('CyTask-call-test-'))rmSync(temporary,{recursive:true,force:true});
}
