import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
export function CyMDDialog({text,onSaved,onClose}:{text:string;onSaved:(value:string)=>void;onClose:()=>void}){
  const {locale,t}=useI18n();const frame=useRef<HTMLIFrameElement>(null);
  const [session]=useState(()=>crypto.randomUUID());const [dirty,setDirty]=useState(false);const [saving,setSaving]=useState(false);const [error,setError]=useState("");
  const callbacks=useRef({onSaved,onClose,text});callbacks.current={onSaved,onClose,text};
  const state=useRef({dirty,saving});state.current={dirty,saving};
  const close=()=>{if(!saving&&(!dirty||window.confirm(t("Discard unsaved changes?"))))onClose();};
  useEffect(()=>{
    let opened=false;
    const message=async(event:MessageEvent)=>{
      const data=event.data as Record<string,unknown>;
      if(event.origin!==window.location.origin||event.source!==frame.current?.contentWindow||!data||data.protocol!=="cymd.integration"||data.version!==1||data.session!==session||data.source!=="cymd")return;
      const post=(payload:Record<string,unknown>)=>frame.current?.contentWindow?.postMessage({protocol:"cymd.integration",version:1,session,source:"host",...payload},window.location.origin);
      if(data.type==="ready"&&!opened){opened=true;post({type:"open",name:"CyTask.md",locale,file:new Blob([callbacks.current.text],{type:"text/markdown"})});}
      if(data.type==="state")setDirty(Boolean(data.dirty));
      if(data.type==="close-request"&&!state.current.saving&&(!state.current.dirty||window.confirm(t("Discard unsaved changes?"))))callbacks.current.onClose();
      if(data.type==="error")setError(String(data.message||t("Unable to open the editor.")));
      if(data.type==="save"){
        setSaving(true);
        try{
          if(!(data.file instanceof Blob)||data.file.size>2_000_000||!String(data.name).match(/\.(md|markdown)$/i))throw Error(t("Save as Markdown (.md) to update this text field."));
          const value=await data.file.text();
          post({type:"save-result",requestId:data.requestId,ok:true});setDirty(false);callbacks.current.onSaved(value);
        }catch(reason){const message=reason instanceof Error?reason.message:t("Unable to save this content.");post({type:"save-result",requestId:data.requestId,ok:false,error:message});setError(message);}
        finally{setSaving(false);}
      }
    };
    window.addEventListener("message",message);const prevent=(event:BeforeUnloadEvent)=>{if(state.current.dirty||state.current.saving)event.preventDefault();};
    window.addEventListener("beforeunload",prevent);
    return()=>{window.removeEventListener("message",message);window.removeEventListener("beforeunload",prevent);};
  },[locale,session,t]);
  return <div className="cymd-dialog-backdrop"><section className="cymd-dialog" role="dialog" aria-modal="true" aria-label={t("CyMD editor")}>
    <header><strong>CyMD <small>{t("Markdown editor")}</small></strong><span>{dirty?t("Unsaved changes"):t("Markdown")}</span><button className="text-button" type="button" disabled={saving} onClick={close}>{t("Close")}</button></header>
    {error&&<p className="form-error" role="alert">{error}</p>}
    <iframe ref={frame} title={t("CyMD editor")} src={`/plugins/cymd/index.html?integration=1&parentOrigin=${encodeURIComponent(window.location.origin)}&session=${session}`}
      sandbox="allow-scripts allow-same-origin allow-downloads"/>
  </section></div>;
}
