import { createContext, lazy, Suspense, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, type PluginContentAction, type PluginContentTarget, type ProjectPlugin } from "../api";
import { createWorkspaceEventStream } from "../workspaceEvents";
import { useI18n } from "../i18n";

const ContentPluginDialog = lazy(() => import("./ContentPluginDialog"));
type Contribution = {plugin: ProjectPlugin; action: PluginContentAction};
interface Environment {
  projectId?: string;
  canEdit: boolean;
  contributions: Contribution[];
  open: (contribution: Contribution, target: PluginContentTarget) => void;
}
const Context = createContext<Environment>({canEdit:false, contributions:[], open:()=>undefined});
export function ContentPluginProvider({projectId,canEdit,children,onError,onNotice}:{projectId?:string;canEdit:boolean;children:ReactNode;onError:(message:string)=>void;onNotice:(message:string)=>void}) {
  const {t}=useI18n();
  const [plugins,setPlugins]=useState<ProjectPlugin[]>([]);
  const [active,setActive]=useState<{projectId:string;contribution:Contribution;target:PluginContentTarget}>();
  const callbacks=useRef({onError,onNotice});callbacks.current={onError,onNotice};
  useEffect(()=>{
    setPlugins([]);setActive(undefined);if(!projectId)return;
    let stopped=false,request=0;
    async function load(){const sequence=++request;try {const next=await api.projectPlugins(projectId!);if(!stopped&&sequence===request){setPlugins(next);setActive(current=>current&&next.some(x=>x.enabled&&x.manifest.id===current.contribution.plugin.manifest.id)?current:undefined);}}
      catch {if(!stopped){setPlugins([]);setActive(undefined);}}}
    void load();const stream=createWorkspaceEventStream();let timer:number|undefined;
    const refresh=()=>{window.clearTimeout(timer);timer=window.setTimeout(()=>void load(),150);};
    for(const name of ["project.plugin_enabled","project.plugin_disabled","workspace.synchronized","reset"])stream.addEventListener(name,refresh);
    return()=>{stopped=true;window.clearTimeout(timer);stream.close();};
  },[projectId]);
  const contributions=plugins.filter(x=>x.enabled).flatMap(plugin=>(plugin.manifest.contributes.contentActions??[]).map(action=>({plugin,action})));
  return <Context.Provider value={{projectId,canEdit,contributions,open:(contribution,target)=>{if(projectId)setActive({projectId,contribution,target});}}}>
    {children}
    {active&&active.projectId===projectId&&<Suspense fallback={<div role="status" className="content-plugin-loading">{t("Loading plugin…")}</div>}>
      <ContentPluginDialog key={`${active.target.kind}:${active.target.id}:${active.contribution.action.id}`}
        {...active} canEdit={canEdit} onClose={()=>setActive(undefined)} onError={message=>callbacks.current.onError(message)} onNotice={message=>callbacks.current.onNotice(message)}/>
    </Suspense>}
  </Context.Provider>;
}
export function ContentPluginActions({surface,target,onEditorAction}:{surface:PluginContentAction["surfaces"][number];target?:PluginContentTarget;onEditorAction?:()=>void}) {
  const {t}=useI18n();const environment=useContext(Context);
  const contributions=environment.contributions.filter(x=>x.action.surfaces.includes(surface)
    && (x.action.renderer==="cymd" ? Boolean(onEditorAction)&&environment.canEdit : Boolean(target)));
  if(!contributions.length)return null;
  return <span className="content-plugin-actions">{contributions.map(contribution=><button type="button"
    key={`${contribution.plugin.manifest.id}:${contribution.action.id}`} title={contribution.plugin.manifest.name}
    onClick={()=>contribution.action.renderer==="cymd"?onEditorAction?.():target&&environment.open(contribution,target)}>
    {t(contribution.action.title)}
  </button>)}</span>;
}
