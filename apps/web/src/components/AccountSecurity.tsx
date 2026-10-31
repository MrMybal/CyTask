import {useEffect,useState,type FormEvent} from "react";
import {api,ApiError,type MfaStatus,type MfaChallenge} from "../api";
import {useI18n} from "../i18n";
import {MfaFlow} from "./MfaFlow";

export function AccountSecurity(){
  const {t}=useI18n();const [status,setStatus]=useState<MfaStatus>();const [flow,setFlow]=useState<MfaChallenge>();
  const [action,setAction]=useState<string>();const [error,setError]=useState("");const [pending,setPending]=useState(false);
  const load=()=>api.mfaStatus().then(setStatus).catch(()=>setError(t("Unable to load account security.")));
  useEffect(()=>{void load();},[]);
  async function begin(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget;const password=String(new FormData(form).get("password"));form.reset();setPending(true);setError("");
    try{setFlow(await api.mfaManage({password,action:action!}));setAction(undefined);}catch(reason){setError(t(reason instanceof ApiError?reason.message:"Unable to update account security."));}finally{setPending(false);}}
  return <details className="account-security workspace-settings-section"><summary>{t("Account security · Two-factor authentication")}</summary>
    {flow?<MfaFlow initial={flow} onCancel={()=>setFlow(undefined)} onComplete={()=>{setFlow(undefined);void load();}}/>:<>
      {!status?<p>{t("Loading…")}</p>:!status.available?<p>{t(status.policy==="local"?"Two-factor authentication is not used in local solo mode.":"Two-factor authentication is disabled on this server.")}</p>:<>
        <p>{t(status.policy==="required"?"Two-factor authentication is required by this server.":"Two-factor authentication is optional on this server.")}</p>
        <dl className="mfa-status"><div><dt>{t("Authenticator app")}</dt><dd>{t(status.authenticatorConfigured?"Enabled":"Not configured")}</dd></div>
          <div><dt>{t("Email code")}</dt><dd>{t(status.emailConfigured?"Enabled":"Not configured")}</dd></div>
          <div><dt>{t("Recovery codes")}</dt><dd>{status.recoveryCodesRemaining}</dd></div></dl>
        <div className="mfa-actions">
          {status.authenticatorAllowed&&<button type="button" onClick={()=>{setAction("enable-totp");setError("");}}>{t(status.authenticatorConfigured?"Replace authenticator":"Enable authenticator")}</button>}
          {status.emailAllowed&&!status.emailConfigured&&<button type="button" onClick={()=>{setAction("enable-email");setError("");}}>{t("Enable email codes")}</button>}
          {status.authenticatorConfigured&&<button type="button" disabled={status.policy==="required"&&!(status.emailAllowed&&status.emailConfigured)} onClick={()=>setAction("disable-totp")}>{t("Disable authenticator")}</button>}
          {status.emailConfigured&&<button type="button" disabled={status.policy==="required"&&!(status.authenticatorAllowed&&status.authenticatorConfigured)} onClick={()=>setAction("disable-email")}>{t("Disable email codes")}</button>}
          {(status.authenticatorConfigured||status.emailConfigured)&&<button type="button" onClick={()=>setAction("recovery")}>{t("Regenerate recovery codes")}</button>}
        </div>
        {action&&<form className="mfa-manage-form" onSubmit={begin}><p>{t("Confirm your password. An existing second factor will also be requested when configured.")}</p>
          <label>{t("Current password")}<input name="password" type="password" autoComplete="current-password" required maxLength={200}/></label>
          <div className="mfa-actions"><button className="primary-button" type="submit" disabled={pending}>{t("Continue")}</button><button type="button" disabled={pending} onClick={()=>setAction(undefined)}>{t("Cancel")}</button></div></form>}
      </>}
    </>}{error&&<p className="form-error" role="alert">{error}</p>}
  </details>;
}

export function StorageSecurity(){
  const {t}=useI18n();
  const [status,setStatus]=useState<Awaited<ReturnType<typeof api.storageSecurity>>>();
  const [failed,setFailed]=useState(false);
  useEffect(()=>{let active=true;void api.storageSecurity().then(value=>{if(active)setStatus(value);}).catch(()=>{if(active)setFailed(true);});return()=>{active=false;};},[]);
  return <details className="workspace-settings-section"><summary>{t("Data encryption")}</summary>
    <p>{t(failed?"Unable to load storage security.":!status?"Loading…":status.encryptionAtRest?"Content encryption at rest is enabled (AES-256-GCM).":"Content encryption at rest is disabled.")}</p>
    <p>{t("Managed in the server configuration or the desktop local workspace settings. Existing data requires an offline migration and a separate key backup.")}</p>
    <p>{t("This is not end-to-end encryption. CyTask can read unlocked data; server routing metadata remains visible.")}</p>
  </details>;
}
