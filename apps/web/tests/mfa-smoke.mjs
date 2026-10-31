import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes,createHmac} from 'node:crypto';
import {mkdtempSync,mkdirSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
import {chromium} from 'playwright';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const temporary=mkdtempSync(path.join(tmpdir(),'CyTask-mfa-test-'));
const output=path.join(root,'.build','mfa-tests');mkdirSync(output,{recursive:true});
const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));const origin=`http://127.0.0.1:${port}`;
const runtime=path.join(root,'.tools','dotnet',process.platform==='win32'?'dotnet.exe':'dotnet');
const environment=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.toLowerCase().startsWith('cytask__')));
const server=spawn(existsSync(runtime)?runtime:'dotnet',[path.join(root,'apps/server/src/CyTask.Api/bin/Release/net10.0/CyTask.Api.dll')],{
  cwd:path.join(root,'apps/server/src/CyTask.Api'),windowsHide:true,
  env:{...environment,ASPNETCORE_ENVIRONMENT:'Development',ASPNETCORE_URLS:origin,ASPNETCORE_WEBROOT:path.join(root,'apps/web/dist'),
    CyTask__UseInMemoryStore:'true',CyTask__LocalMode:'false',CyTask__MediaStoragePath:temporary,CyTask__MfaPolicy:'required',CyTask__MfaEmailEnabled:'false'},stdio:'ignore'});
let browser,page;const errors=[];
function totp(secret,offset=0){
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits=0,value=0;const bytes=[];
  for(const char of secret){value=(value<<5)|alphabet.indexOf(char);bits+=5;if(bits>=8){bits-=8;bytes.push((value>>bits)&255);}}
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30_000)+offset));
  const digest=createHmac('sha1',Buffer.from(bytes)).update(counter).digest();const index=digest.at(-1)&15;
  return ((digest.readUInt32BE(index)&0x7fffffff)%1_000_000).toString().padStart(6,'0');
}
async function finishSetup(){
  const codes=await page.locator('.mfa-recovery-codes code').allTextContents();assert.equal(codes.length,10);
  await page.getByRole('checkbox',{name:'I have saved my recovery codes.',exact:true}).check();
  await page.locator('.mfa-flow').getByRole('button',{name:'Continue',exact:true}).click();return codes;
}
async function enroll(){
  await page.getByRole('button',{name:'Authenticator app',exact:true}).click();
  await page.getByRole('img',{name:'Authenticator setup QR code',exact:true}).waitFor();
  assert.ok((await page.getByRole('img',{name:'Authenticator setup QR code',exact:true}).getAttribute('src')).startsWith('data:image/png;base64,'));
  const secret=(await page.locator('.mfa-secret').textContent()).trim();assert.equal(secret.length,32);
  await page.getByRole('textbox',{name:'Authenticator app',exact:true}).fill(totp(secret));await page.getByRole('button',{name:'Verify',exact:true}).click();
  await page.getByText('Save your recovery codes',{exact:true}).waitFor();return {secret,codes:await finishSetup()};
}
try{
  let ready=false;for(let attempt=0;attempt<200;attempt++){
    if(server.exitCode!==null)throw Error('MFA fixture exited before becoming ready.');
    try{if((await fetch(origin+'/health/ready')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,50));
  }assert.ok(ready,'MFA fixture is ready.');console.log(`MFA fixture ready at ${origin}`);
  browser=await chromium.launch({headless:true,...(process.env.CYTASK_TEST_BROWSER?{channel:process.env.CYTASK_TEST_BROWSER}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:960},serviceWorkers:'block'});
  // Keep the fixture offline except for its own server, including any scripts
  // injected by the host browser environment rather than the application.
  await context.route('**/*',route=>/^https?:/.test(route.request().url())&&!route.request().url().startsWith(origin+'/')?route.abort('blockedbyclient'):route.continue());
  page=await context.newPage();page.setDefaultTimeout(20_000);page.on('pageerror',error=>errors.push(error.message));
  const password=randomBytes(24).toString('base64url');
  await page.goto(origin);await page.getByLabel('Display name',{exact:true}).fill('MFA Demo');await page.getByLabel('Organization',{exact:true}).fill('Fixture Studio');
  await page.getByLabel('Email address',{exact:true}).fill('mfa-owner@fixture.invalid');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByLabel('Confirm password',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Initialize CyTask',exact:true}).click();await page.getByText('Set up two-factor authentication',{exact:true}).waitFor();
  assert.equal((await context.request.get(origin+'/api/v1/projects')).status(),401);
  const first=await enroll();await page.getByRole('button',{name:'Settings and tools',exact:true}).click();
  await page.getByText('Account security · Two-factor authentication',{exact:true}).click();
  await page.getByRole('button',{name:'Replace authenticator',exact:true}).waitFor();
  assert.ok(await page.getByRole('button',{name:'Disable authenticator',exact:true}).isDisabled());
  await page.screenshot({path:path.join(output,'account-security.png')});
  await page.getByRole('button',{name:'Replace authenticator',exact:true}).click();
  await page.getByLabel('Current password',{exact:true}).fill(password);await page.locator('.mfa-manage-form').getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('button',{name:'Recovery code',exact:true}).click();await page.getByRole('textbox',{name:'Recovery code',exact:true}).fill(first.codes[0]);await page.getByRole('button',{name:'Verify',exact:true}).click();
  const second=await enroll();
  await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'Log out',exact:true}).click();
  await page.getByLabel('Email address',{exact:true}).fill('mfa-owner@fixture.invalid');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByText('Verify your identity to continue.',{exact:true}).waitFor();assert.equal((await context.request.get(origin+'/api/v1/me')).status(),401);
  await page.reload();await page.getByText('Verify your identity to continue.',{exact:true}).waitFor();
  let invalid='000000';while([-1,0,1].map(offset=>totp(second.secret,offset)).includes(invalid))invalid=(Number(invalid)+1).toString().padStart(6,'0');
  await page.getByRole('textbox',{name:'Authenticator app',exact:true}).fill(invalid);await page.getByRole('button',{name:'Verify',exact:true}).click();
  await page.getByText('The verification code is invalid, expired or already used.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Recovery code',exact:true}).click();
  await page.getByRole('button',{name:'FR',exact:true}).click();await page.getByRole('textbox',{name:'Code de secours',exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'mfa-mobile.png')});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));assert.equal(await page.locator('form form').count(),0);
  await page.getByRole('textbox',{name:'Code de secours',exact:true}).fill(second.codes[0]);await page.getByRole('button',{name:'Vérifier',exact:true}).click();
  await page.getByRole('button',{name:/Paramètres et outils|Settings and tools/}).first().waitFor();
  assert.equal((await context.request.get(origin+'/api/v1/me')).status(),200);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({mfa:{requiredBootstrap:true,localQr:true,accountSettings:true,replacement:true,recovery:true,reloadPending:true,invalidCode:true,french:true,mobile:true,noExternalQrProvider:true}}));
}catch(error){await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>undefined);console.error(JSON.stringify({browserErrors:errors}));throw error;}
finally{await browser?.close();if(server.exitCode===null){server.kill();await new Promise(resolve=>server.once('exit',resolve));}
  if(path.dirname(temporary)===path.resolve(tmpdir())&&path.basename(temporary).startsWith('CyTask-mfa-test-'))rmSync(temporary,{recursive:true,force:true});}
