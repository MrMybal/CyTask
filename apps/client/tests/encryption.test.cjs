"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs/promises");
const path=require("node:path");
const os=require("node:os");
const vm=require("node:vm");
const {randomBytes}=require("node:crypto");

test("Local encryption keys stay outside synchronized folders and never enter the renderer profile",async()=>{
  const source=await fs.readFile(path.join(__dirname,"../main.cjs"),"utf8");
  const normalize=source.slice(source.indexOf("function normalizeLocalPath("),source.indexOf("function normalizeStoredProfile("));
  const helpers=source.slice(source.indexOf("async function externalKeyPath("),source.indexOf("function assertSelectorSender("));
  const api=vm.runInNewContext(normalize+helpers+"\n({externalKeyPath,readLocalEncryptionKey})",{fs,path,fsSync:require("node:fs"),Buffer,nativeText:english=>english});
  const fixture=await fs.mkdtemp(path.join(os.tmpdir(),"CyTask-key-fixture-"));
  const workspace=path.join(fixture,"workspace");await fs.mkdir(workspace);
  const keyFile=path.join(fixture,"fixture.cytask-key"),key=randomBytes(32).toString("base64");
  try{
    await fs.writeFile(keyFile,JSON.stringify({format:"cytask-key-v1",key}));
    const profile={encrypted:true,encryptionKeyFile:keyFile};
    assert.equal(await api.readLocalEncryptionKey(profile,workspace),key);
    assert.equal(await api.readLocalEncryptionKey({encrypted:false},workspace),"");
    await assert.rejects(api.externalKeyPath(workspace,path.join(workspace,"fixture.cytask-key"),false),/outside/);
    await fs.mkdir(path.join(workspace,".cytask"));await fs.writeFile(path.join(workspace,".cytask/encryption.state"),"fixture marker");
    await assert.rejects(api.readLocalEncryptionKey({encrypted:false},workspace),/encrypted/);
    await assert.rejects(api.readLocalEncryptionKey({encrypted:true},workspace),/key file/);
    await fs.writeFile(keyFile,JSON.stringify({format:"cytask-key-v1",key:"invalid"}));
    await assert.rejects(api.readLocalEncryptionKey(profile,workspace),/Invalid encryption key/);
    const html=await fs.readFile(path.join(__dirname,"../renderer/index.html"),"utf8");
    for(const id of ["local-encrypted","encryption-options","encryption-key-file","choose-encryption-key","create-encryption-key"])
      assert.ok(html.includes(`id="${id}"`));
    assert.ok(!html.includes(key));
  }finally{if(fixture.startsWith(path.join(os.tmpdir(),"CyTask-key-fixture-")))await fs.rm(fixture,{recursive:true,force:true});}
});
