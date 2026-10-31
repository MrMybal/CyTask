import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const output=path.join(root,'.build/encryption-tests');await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CYTASK_TEST_BROWSER?{channel:process.env.CYTASK_TEST_BROWSER}:{})});
try{
  const page=await browser.newPage({viewport:{width:1200,height:940}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route(/^https?:\/\//,route=>route.abort());
  await page.addInitScript(()=>{window.cytaskDesktop={setLocale:async()=>{},listServers:async()=>({servers:[],version:'fixture'}),onConnectionError:()=>()=>{},
    chooseLocalFolder:async()=>({canceled:false,folderPath:'Fixture workspace',suggestedName:'Fixture'}),
    chooseEncryptionKey:async()=>({canceled:false,keyFile:'Separate key backup.cytask-key'}),openLocal:async profile=>{window.lastProfile=profile;}};});
  await page.goto(pathToFileURL(path.join(root,'apps/client/renderer/index.html')).href);
  await page.locator('#choose-folder').click();await page.locator('#local-encrypted').check();
  await page.locator('#encryption-options').waitFor({state:'visible'});await page.locator('#create-encryption-key').click();
  assert.equal(await page.locator('#encryption-key-file').inputValue(),'Separate key backup.cytask-key');
  await page.screenshot({path:path.join(output,'desktop-encryption-en.png'),fullPage:true});
  await page.locator('[data-locale="fr"]').click();assert.match(await page.locator('#encryption-options').textContent(),/Clé de chiffrement/);
  await page.screenshot({path:path.join(output,'desktop-encryption-fr.png'),fullPage:true});
  await page.locator('#open-local-button').click();const profile=await page.evaluate(()=>window.lastProfile);assert.equal(profile.encrypted,true);assert.equal(profile.encryptionKeyFile,'Separate key backup.cytask-key');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({desktopSelector:true,optionalEncryption:true,englishFrench:true,keyPathOnly:true}));
}finally{await browser.close();}
