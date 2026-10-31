import {useEffect,useState,type FormEvent} from "react";
import {api,ApiError,type MfaChallenge,type Session} from "../api";
import {useI18n} from "../i18n";
import "../mfa.css";

export function MfaFlow({initial,onComplete,onCancel}:{initial:MfaChallenge;onComplete:(session:Session)=>void;onCancel:()=>void}){
  const {t}=useI18n();const [view,setView]=useState(initial);const [method,setMethod]=useState(initial.methods[0]??"totp");
  const [code,setCode]=useState("");const [pending,setPending]=useState(false);const [error,setError]=useState("");
  const [qr,setQr]=useState("");const [now,setNow]=useState(Date.now());const [finished,setFinished]=useState<{session:Session;codes:string[]}>();const [saved,setSaved]=useState(false);
  useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),1000);return()=>window.clearInterval(timer);},[]);
  useEffect(()=>{let active=true;setQr("");if(view.provisioningUri)void import("qrcode").then(module=>module.toDataURL(view.provisioningUri!,{width:240,margin:2,errorCorrectionLevel:"M"})).then(value=>{if(active)setQr(value);}).catch(()=>undefined);
    return()=>{active=false;};},[view.provisioningUri]);
  const expired=now>=Date.parse(view.expiresAt);const wait=Math.max(0,Math.ceil(((view.resendAt?Date.parse(view.resendAt):0)-now)/1000));
  const label=(value:string)=>t(value==="totp"?"Authenticator app":value==="email"?"Email code":"Recovery code");
  async function advance(operation:string,selected=method){
    setPending(true);setError("");try{
      const result=await api.mfaAdvance({token:view.token,operation,method:selected,...(operation==="verify"?{code:code.trim()}:{})});setCode("");
      if(result.kind==="challenge"){setView(result.challenge);setMethod(result.challenge.methods.includes(selected)?selected:result.challenge.methods[0]??"totp");}
      else if(result.recoveryCodes.length)setFinished({session:result.session,codes:result.recoveryCodes});else onComplete(result.session);
    }catch(reason){setError(t(reason instanceof ApiError?reason.message:"Unable to verify the code."));}finally{setPending(false);}
  }
  async function cancel(){setPending(true);try{await api.mfaCancel(view.token);}catch{/* Expired challenges are already unusable. */}finally{setPending(false);onCancel();}}
  function submit(event:FormEvent){event.preventDefault();void advance("verify");}
  async function copy(value:string){try{await navigator.clipboard.writeText(value);}catch{setError(t("Copy failed. Select and copy the text manually."));}}
  function download(){if(!finished)return;const url=URL.createObjectURL(new Blob([`CyTask recovery codes\nStore these privately. Each code can only be used once.\n\n${finished.codes.join("\n")}\n`],{type:"text/plain;charset=utf-8"}));
    const anchor=document.createElement("a");anchor.href=url;anchor.download="CyTask-recovery-codes.txt";anchor.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);}
  if(finished)return <section className="mfa-flow" aria-label={t("Recovery codes")}>
    <h3>{t("Save your recovery codes")}</h3><p>{t("These codes are shown only once. Store them privately; each code can only be used once.")}</p>
    <div className="mfa-recovery-codes">{finished.codes.map(value=><code key={value}>{value}</code>)}</div>
    <div className="mfa-actions"><button type="button" onClick={()=>void copy(finished.codes.join("\n"))}>{t("Copy codes")}</button><button type="button" onClick={download}>{t("Download codes")}</button></div>
    <label className="mfa-saved"><input type="checkbox" checked={saved} onChange={event=>setSaved(event.target.checked)}/>{t("I have saved my recovery codes.")}</label>
    {error&&<p className="form-error" role="alert">{error}</p>}
    <button className="primary-button" type="button" disabled={!saved} onClick={()=>onComplete(finished.session)}>{t("Continue")}</button>
  </section>;
  return <section className="mfa-flow" aria-label={t("Two-factor authentication")}>
    <h3>{t(view.stage==="choose"?"Set up two-factor authentication":"Two-factor authentication")}</h3>
    {view.stage==="choose"?<><p>{t("Choose a second factor allowed by this server.")}</p><div className="mfa-methods">{view.methods.map(value=><button type="button" key={value} disabled={pending||expired} onClick={()=>void advance("method",value)}>{label(value)}</button>)}</div></>:<>
      {view.stage==="verify"&&<><p>{t("Verify your identity to continue.")}</p><div className="mfa-methods" role="group" aria-label={t("Verification method")}>
        {view.methods.map(value=><button key={value} type="button" aria-pressed={method===value} disabled={pending||expired} onClick={()=>{setMethod(value);setCode("");setError("");}}>{label(value)}</button>)}</div></>}
      {view.stage==="totp"&&<><p>{t("Scan this QR code with Google Authenticator or another compatible TOTP app.")}</p>
        {qr&&<img className="mfa-qr" src={qr} width={240} height={240} alt={t("Authenticator setup QR code")}/>}
        <small>{t("Or enter this setup key manually:")}</small><code className="mfa-secret">{view.secret}</code>
        <button type="button" onClick={()=>void copy(view.secret??"")}>{t("Copy setup key")}</button></>}
      {method==="email"&&<div className="mfa-email"><p>{t("Send a verification code to {email}.",{email:view.destination??""})}</p>
        <button type="button" disabled={pending||expired||wait>0} onClick={()=>void advance("email","email")}>{wait>0?t("Resend in {seconds}s",{seconds:wait}):t("Send email code")}</button></div>}
      {method==="recovery"&&<p>{t("Enter one of your unused recovery codes.")}</p>}
      {method==="totp"&&<small>{t("Codes change every 30 seconds. A code that was already accepted cannot be reused.")}</small>}
      <form onSubmit={submit} className="mfa-code-form"><label>{label(method)}<input name="code" aria-label={label(method)} type="text" inputMode={method==="recovery"?"text":"numeric"}
        autoComplete="one-time-code" value={code} onChange={event=>setCode(method==="recovery"?event.target.value:event.target.value.replace(/\D/g,"").slice(0,6))}
        minLength={6} maxLength={method==="recovery"?80:6} pattern={method==="recovery"?undefined:"[0-9]{6}"} required autoFocus disabled={pending||expired}/></label>
        <button className="primary-button" type="submit" disabled={pending||expired}>{t(pending?"Verifying…":"Verify")}</button></form>
    </>}
    {expired&&<p className="form-error" role="alert">{t("Verification expired. Sign in again.")}</p>}
    {error&&<p className="form-error" role="alert">{error}</p>}
    <button className="text-button" type="button" disabled={pending} onClick={()=>void cancel()}>{t("Cancel")}</button>
  </section>;
}
