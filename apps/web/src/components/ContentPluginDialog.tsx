import { useEffect, useRef, useState } from "react";
import { api, type ContentPluginView, type CyAnnotaDocument, type PluginContentAction, type PluginContentTarget, type ProjectPlugin } from "../api";
import { EmbeddedCyAnnotaEditor } from "./TaskCyAnnotaPanel";
import { PluginField, normalizeValue } from "./TaskPluginPanel";
import { useI18n } from "../i18n";

interface Props {
  projectId:string;target:PluginContentTarget;contribution:{plugin:ProjectPlugin;action:PluginContentAction};
  canEdit:boolean;onClose:()=>void;onError:(message:string)=>void;onNotice:(message:string)=>void;
}
export default function ContentPluginDialog({projectId,target,contribution,canEdit,onClose,onError,onNotice}:Props){
  const {t}=useI18n();const [view,setView]=useState<ContentPluginView>();const [values,setValues]=useState<Record<string,unknown>>({});
  const [saving,setSaving]=useState(false);const [error,setError]=useState("");const [dirty,setDirty]=useState(false);
  const pending=useRef(false);const state=useRef({dirty,saving});state.current={dirty,saving};
  const {plugin,action}=contribution;
  const close=()=>{if(!state.current.saving&&(!state.current.dirty||window.confirm(t("Discard unsaved changes?"))))onClose();};
  useEffect(()=>{
    let stopped=false;
    void api.contentPlugin(projectId,target,plugin.manifest.id,action.id).then(next=>{if(!stopped){setView(next);setValues(next.data??{});}})
      .catch(reason=>{if(!stopped)setError(reason instanceof Error?reason.message:t("Unable to load plugin data."));});
    const prevent=(event:BeforeUnloadEvent)=>{if(state.current.dirty||state.current.saving)event.preventDefault();};
    window.addEventListener("beforeunload",prevent);
    return()=>{stopped=true;window.removeEventListener("beforeunload",prevent);};
  },[projectId,target.id,target.kind,plugin.manifest.id,action.id,t]);
  async function save(data:Record<string,unknown>,revision:number){
    if(!canEdit||pending.current)throw Error(t("A save is already in progress or this content is read only."));
    pending.current=true;setSaving(true);
    try {const updated=await api.saveContentPlugin(projectId,target,plugin.manifest.id,action.id,data,revision);
      setView(current=>current?{...current,...updated}:current);setDirty(false);return updated;
    } finally {pending.current=false;setSaving(false);}
  }
  function document(next:ContentPluginView):CyAnnotaDocument {return {attachmentId:target.id,document:next.data,mediaKind:next.mediaKind??"image",annotationCount:Array.isArray(next.data?.annotations)?next.data.annotations.length:0,revision:next.revision,updatedAt:next.updatedAt};}
  return <div className="content-plugin-backdrop"><section className={`content-plugin-dialog ${action.renderer==="cyannota"?"annotation-dialog":""}`} role="dialog" aria-modal="true" aria-label={plugin.manifest.name}>
    <header><strong>{plugin.manifest.name} <small>{t(action.title)}</small></strong><button type="button" onClick={close} disabled={saving}>{t("Close")}</button></header>
    {error&&<p role="alert" className="form-error">{error}</p>}
    {!view&&!error&&<p role="status">{t("Loading plugin…")}</p>}
    {view&&action.renderer==="cyannota"&&target.resource&&view.applicationUrl&&<EmbeddedCyAnnotaEditor
      attachment={{id:target.id,fileName:target.resource.name,detectedContentType:target.resource.detectedContentType??undefined,declaredContentType:target.resource.declaredContentType??"application/octet-stream",reviewedAt:target.resource.updatedAt,createdAt:target.resource.createdAt}}
      workspace={{applicationUrl:view.applicationUrl,maximumDocumentBytes:view.maximumDocumentBytes,documents:[]}}
      initialRevision={view.revision} canEdit={canEdit} onClose={close} contentUrl={api.resourceContentUrl(target.id)}
      loadDocument={async()=>document(await api.contentPlugin(projectId,target,plugin.manifest.id,action.id))}
      saveDocument={async(data,revision)=>{const updated=await save(data,revision);return document({...view,...updated});}}
      onSaved={()=>undefined} onError={onError} onNotice={onNotice}/>}
    {view&&action.renderer==="fields"&&<form onSubmit={event=>{event.preventDefault();const clean=Object.fromEntries(action.fields.map(field=>[field.key,normalizeValue(field,values[field.key])]));void save(clean,view.revision).then(()=>onNotice(t("Plugin data saved."))).catch(reason=>setError(reason instanceof Error?reason.message:t("Unable to save plugin data.")));}}>
      {action.fields.map(field=><PluginField key={field.key} field={field} value={values[field.key]} disabled={!canEdit||saving}
        onChange={value=>{setValues(current=>({...current,[field.key]:value}));setDirty(true);}}/>)}
      {canEdit&&<button type="submit" className="primary-button small" disabled={saving}>{t(saving?"Saving…":"Save")}</button>}
    </form>}
  </section></div>;
}
