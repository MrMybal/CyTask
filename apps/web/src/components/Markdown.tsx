import { createContext, forwardRef, lazy, Suspense, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import type { OrganizationMember, TaskOption, PluginContentTarget, ProjectRoom } from "../api";
import { ContentPluginActions } from "./ContentPlugins";

interface Environment { projectId?:string; members?:OrganizationMember[]; tasks?:TaskOption[]; rooms?:ProjectRoom[]; onError?:(message:string)=>void }
const MarkdownContext=createContext<Environment>({});
export const useMarkdownEnvironment=()=>useContext(MarkdownContext);
export function MarkdownProvider({children,...value}:Environment&{children:ReactNode}) {return <MarkdownContext.Provider value={value}>{children}</MarkdownContext.Provider>;}
let hljs:typeof import("highlight.js/lib/common").default|undefined;
let highlighter:Promise<unknown>|undefined;
const renderer=new MarkdownIt({html:false,breaks:true,linkify:true,maxNesting:24,
  highlight(code,language){try{return language&&hljs?.getLanguage(language)?hljs.highlight(code,{language,ignoreIllegals:true}).value:"";}catch{return "";}}});
renderer.linkify.set({fuzzyLink:false});
const esc=(value:string)=>renderer.utils.escapeHtml(value);
renderer.inline.ruler.before("text","spoiler-boundary",(state,silent)=>{
  const at=state.src.indexOf("||",state.pos);
  if(at<=state.pos||at>=state.posMax||/[\n\\`*_[\]<>!~]/.test(state.src.slice(state.pos,at)))return false;
  if(!silent)state.pending+=state.src.slice(state.pos,at);state.pos=at;return true;
});
renderer.inline.ruler.before("emphasis","spoiler",(state,silent)=>{
  if(!state.src.startsWith("||",state.pos))return false;
  const end=state.src.indexOf("||",state.pos+2);if(end<0||end>state.posMax-2)return false;
  if(!silent){const token=state.push("html_inline","",0);token.content=`<span class="markdown-spoiler" role="button" tabindex="0" aria-label="Spoiler">${esc(state.src.slice(state.pos+2,end))}</span>`;}
  state.pos=end+2;return true;
});
renderer.renderer.rules.strong_open=(tokens,index)=>tokens[index]?.markup==="__"?"<u>":"<strong>";
renderer.renderer.rules.strong_close=(tokens,index)=>tokens[index]?.markup==="__"?"</u>":"</strong>";
renderer.renderer.rules.link_open=(tokens,index,options,_env,self)=>{
  const token=tokens[index]!;const href=String(token.attrGet("href")??"");
  if(/^https?:/i.test(href)){token.attrSet("target","_blank");token.attrSet("rel","noopener noreferrer");}
  return self.renderToken(tokens,index,options);
};
renderer.core.ruler.after("inline","task-checkboxes",state=>{
  for(let index=2;index<state.tokens.length;index++){
    const token=state.tokens[index]!;if(token.type!=="inline"||state.tokens[index-2]?.type!=="list_item_open")continue;
    const first=token.children?.[0];const match=/^\[([ xX])\]\s+/.exec(first?.content??"");
    if(!first||first.type!=="text"||!match)continue;first.content=first.content.slice(match[0].length);
    const checkbox=new state.Token("html_inline","",0);checkbox.content=`<input type="checkbox" disabled${match[1]!==" "?" checked":""}>`;
    token.children!.unshift(checkbox);
  }
});
renderer.renderer.rules.image=(tokens,index,options,env,self)=>{
  const token=tokens[index]!;const src=String(token.attrGet("src")??"");
  const label=self.renderInlineAsText(token.children??[],options,env);
  const match=/^(.*?)\|(\d{1,4})$/.exec(label);const alt=match?.[1]??label;
  // Shared media use authenticated CyTask endpoints, never filesystem paths or tracking pixels.
  if(!/^\/api\/v1\/(?:resources|attachments)\/[\da-f-]{36}\/content(?:\?|$)/i.test(src))
    return `<a href="${esc(src)}" target="_blank" rel="noopener noreferrer">${esc(alt||src)}</a>`;
  const size=match?` width="${Math.min(Number(match[2]),1024)}"`:"";
  if(/[?&]media=video\b/.test(src))return `<video controls preload="metadata" src="${esc(src)}" title="${esc(alt)}"></video>`;
  return `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy"${size}>`;
};

export function MarkdownView({text,className="",onOpenTask,target}:{text:string;className?:string;onOpenTask?:(taskId:string)=>void;target?:PluginContentTarget}) {
  const {members,tasks}=useContext(MarkdownContext);
  const [highlightReady,setHighlightReady]=useState(Boolean(hljs));
  useEffect(()=>{if(hljs||!/(?:^|\n)(?:```|~~~)/.test(text))return;let stopped=false;
    highlighter??=import("highlight.js/lib/common").then(module=>{hljs=module.default;}).catch(()=>{highlighter=undefined;});
    void highlighter.then(()=>{if(!stopped)setHighlightReady(Boolean(hljs));});return()=>{stopped=true;};
  },[text]);
  const html=useMemo(()=>{
    const environment={};const tokens=renderer.parse(text.slice(0,500_000),environment);
    const mentions=new Set((members??[]).map(member=>"@"+member.displayName));
    const tasksByKey=new Map((tasks??[]).map(task=>[task.key,task]));
    const needles=[...mentions,...tasksByKey.keys()].sort((a,b)=>b.length-a.length);
    const pattern=needles.length?new RegExp(`(?<![\\w@-])(?:${needles.map(value=>value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|")})(?![\\w-])`,"g"):undefined;
    for(const token of tokens){if(token.type!=="inline")continue;
      let linked=false;
      for(const child of token.children??[]){
        if(child.type==="link_open"){linked=true;continue;}if(child.type==="link_close"){linked=false;continue;}
        if(child.type!=="text"||linked||!pattern)continue;
        let value="",at=0;for(const match of child.content.matchAll(pattern)){
          value+=esc(child.content.slice(at,match.index));const label=match[0];const task=tasksByKey.get(label);
          value+=task?`<a class="markdown-task-link" data-task-id="${esc(task.id)}" href="#/tasks/${esc(task.id)}">${esc(label)}</a>`:`<mark class="markdown-mention">${esc(label)}</mark>`;
          at=match.index+label.length;
        }
        if(at>0){child.type="html_inline";child.content=value+esc(child.content.slice(at));}
      }
    }
    return DOMPurify.sanitize(renderer.renderer.render(tokens,renderer.options,environment),{
      ADD_TAGS:["video"],ADD_ATTR:["controls","preload","loading","data-task-id","target","role","tabindex"],
      FORBID_TAGS:["style","form","iframe","object","svg","math"],FORBID_ATTR:["style"],
      ALLOW_DATA_ATTR:false
    });
  },[text,members,tasks,highlightReady]);
  return <><div className={`markdown-view ${className}`} dangerouslySetInnerHTML={{__html:html}}
    onClick={event=>{const target=event.target as HTMLElement;const spoiler=target.closest<HTMLElement>(".markdown-spoiler");
      if(spoiler){spoiler.classList.toggle("revealed");return;}
      const task=target.closest<HTMLElement>("[data-task-id]")?.dataset.taskId;if(task&&onOpenTask){event.preventDefault();onOpenTask(task);}}}
    onKeyDown={event=>{if((event.key==="Enter"||event.key===" ")&&(event.target as HTMLElement).matches(".markdown-spoiler")){event.preventDefault();(event.target as HTMLElement).click();}}}/>
    {target&&<ContentPluginActions surface="text" target={target}/>}</>;
}
export type { MarkdownComposerHandle, ComposerProps } from "./MarkdownComposer";
const LazyComposer=lazy(()=>import("./MarkdownComposer"));
export const MarkdownComposer=forwardRef<import("./MarkdownComposer").MarkdownComposerHandle,import("./MarkdownComposer").ComposerProps>(function MarkdownComposer(props,ref){
  return <Suspense fallback={<div className="markdown-composer editor-loading" role="status">…</div>}><LazyComposer {...props} ref={ref}/></Suspense>;
});
