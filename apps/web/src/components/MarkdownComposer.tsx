import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder as editorPlaceholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { autocompletion } from "@codemirror/autocomplete";
import { api } from "../api";
import { uploadProjectFile } from "../resourceUpload";
import { useI18n } from "../i18n";
import { MarkdownView, useMarkdownEnvironment } from "./Markdown";
import { CyMDDialog } from "./CyMDDialog";
import { ContentPluginActions } from "./ContentPlugins";
export interface MarkdownComposerHandle { focus:()=>void; insertText:(text:string)=>void; clear:()=>void }
export interface ComposerProps {
  name?:string;value?:string;defaultValue?:string;onChange?:(value:string)=>void;placeholder?:string;
  maxLength?:number;required?:boolean;readOnly?:boolean;disabled?:boolean;className?:string;
  submitOnEnter?:boolean;onFiles?:(files:File[])=>void;minHeight?:number;autoFocus?:boolean;
}
export const MarkdownComposer=forwardRef<MarkdownComposerHandle,ComposerProps>(function MarkdownComposer(props,ref){
  const {t}=useI18n();const environment=useMarkdownEnvironment();
  const host=useRef<HTMLDivElement>(null);const editor=useRef<EditorView|undefined>(undefined);
  const callbacks=useRef(props);callbacks.current=props;
  const env=useRef(environment);env.current=environment;
  const [text,setText]=useState(props.value??props.defaultValue??"");
  const draft=useRef(text);draft.current=text;
  const [preview,setPreview]=useState(false);const [fullEditor,setFullEditor]=useState(false);const [uploading,setUploading]=useState(false);
  const replace=(value:string)=>{const view=editor.current;if(view)view.dispatch({changes:{from:0,to:view.state.doc.length,insert:value}});};
  const insert=(value:string)=>{const view=editor.current;if(view){const selection=view.state.selection.main;view.dispatch({changes:{from:selection.from,to:selection.to,insert:value},selection:{anchor:selection.from+value.length}});view.focus();}};
  useImperativeHandle(ref,()=>({focus:()=>editor.current?.focus(),insertText:insert,clear:()=>replace("")}));
  async function upload(files:File[]){
    if(callbacks.current.readOnly||callbacks.current.disabled)return;
    if(callbacks.current.onFiles){callbacks.current.onFiles(files);return;}
    if(!env.current.projectId||uploading)return;setUploading(true);
    try{for(const file of files){const resource=await uploadProjectFile(env.current.projectId,null,file,()=>undefined);
      const url=api.resourceContentUrl(resource.id)+(file.type.startsWith("video/")?"?media=video":"");
      const name=file.name.replace(/[\[\]\r\n]/g,"");insert(`${editor.current?.state.doc.length?"\n":""}${file.type.startsWith("image/")||file.type.startsWith("video/")?"!":""}[${name}](${url})\n`);
    }}catch{env.current.onError?.(t("Unable to upload this file."));}finally{setUploading(false);}
  }
  const uploadRef=useRef(upload);uploadRef.current=upload;
  useEffect(()=>{
    if(!host.current)return;
    const view=new EditorView({parent:host.current,state:EditorState.create({doc:callbacks.current.value??draft.current,extensions:[
      markdown(),history(),EditorView.lineWrapping,
      syntaxHighlighting(HighlightStyle.define([
        {tag:tags.strong,fontWeight:"700"},{tag:tags.emphasis,fontStyle:"italic"},{tag:tags.strikethrough,textDecoration:"line-through"},
        {tag:tags.heading,fontWeight:"700",color:"var(--accent)"},{tag:[tags.link,tags.url],color:"var(--accent)"},
        {tag:tags.monospace,fontFamily:"ui-monospace,Consolas,monospace",color:"var(--muted)"}
      ])),
      autocompletion({activateOnTyping:true,override:[context=>{
        const match=context.matchBefore(/(?:^|\s)[@#][\w \p{L}-]{0,60}$/u);if(!match)return null;
        const prefix=match.text.trimStart();const from=context.pos-prefix.length;
        const query=prefix.slice(1).toLocaleLowerCase();
        const options=prefix.startsWith("@")?(env.current.members??[]).map(member=>({label:"@"+member.displayName,type:"variable",detail:t("Member"),apply:"@"+member.displayName+" "}))
          :[...(env.current.rooms??[]).filter(room=>room.name.toLocaleLowerCase().includes(query)).map(room=>({label:"#"+room.name,detail:t("Room"),type:"reference",apply:`[#${room.name.replace(/[\[\]\\]/g,"")}](#/servers/${env.current.projectId}/rooms/${room.id}) `})),
            ...(env.current.tasks??[]).filter(task=>(task.key+" "+task.title).toLocaleLowerCase().includes(query)).slice(0,30).map(task=>({label:task.key,displayLabel:"#"+task.key,detail:task.title,type:"reference",apply:task.key+" "}))];
        return {from,options,validFor:/^[@#]?[\w \p{L}-]*$/u,filter:prefix.startsWith("@")};
      }]}),
      EditorView.cspNonce.of(document.querySelector<HTMLMetaElement>('meta[name="cytask-style-nonce"]')?.content??""),
      editorPlaceholder(callbacks.current.placeholder??""),
      EditorState.transactionFilter.of(transaction=>transaction.docChanged&&transaction.newDoc.length>(callbacks.current.maxLength??200_000)?[]:transaction),
      EditorView.contentAttributes.of({"aria-label":callbacks.current.placeholder??"Markdown",role:"textbox","aria-multiline":"true","aria-required":String(Boolean(callbacks.current.required))}),
      EditorView.updateListener.of(update=>{if(update.docChanged){const value=update.state.doc.toString();setText(value);callbacks.current.onChange?.(value);}}),
      keymap.of([{key:"Mod-Enter",run:()=>{host.current?.closest("form")?.requestSubmit();return true;}},
        {key:"Enter",run:()=>{if(!callbacks.current.submitOnEnter)return false;host.current?.closest("form")?.requestSubmit();return true;}},
        {key:"Mod-b",run:()=>{format("**","**");return true;}},{key:"Mod-i",run:()=>{format("*","*");return true;}},
        ...defaultKeymap,...historyKeymap]),
      EditorView.domEventHandlers({paste:event=>{const files=Array.from(event.clipboardData?.files??[]);if(files.length){event.preventDefault();void uploadRef.current(files);return true;}return false;},
        drop:event=>{const files=Array.from(event.dataTransfer?.files??[]);if(files.length){event.preventDefault();event.stopPropagation();void uploadRef.current(files);return true;}return false;}}),
      EditorState.readOnly.of(Boolean(callbacks.current.readOnly||callbacks.current.disabled)),
      EditorView.theme({"&":{fontSize:"14px",backgroundColor:"transparent",color:"var(--text)"},".cm-content":{fontFamily:"inherit",padding:"10px 12px",minHeight:`${callbacks.current.minHeight??70}px`},
        ".cm-scroller":{fontFamily:"inherit",maxHeight:"420px",overflow:"auto"},".cm-cursor":{borderLeftColor:"var(--text)"},"&.cm-focused":{outline:"none"},".cm-selectionBackground":{backgroundColor:"var(--surface-hover) !important"},".cm-gutters":{display:"none"}})
    ]})});editor.current=view;
    const form=host.current.closest("form");const reset=()=>replace(callbacks.current.defaultValue??"");form?.addEventListener("reset",reset);
    if(callbacks.current.autoFocus)view.focus();
    return()=>{form?.removeEventListener("reset",reset);view.destroy();editor.current=undefined;};
  },[props.readOnly,props.disabled]);
  useEffect(()=>{if(props.value!==undefined&&editor.current&&props.value!==editor.current.state.doc.toString())replace(props.value);},[props.value]);
  function format(before:string,after:string){const view=editor.current;if(!view)return;const selection=view.state.selection.main;
    const selected=view.state.sliceDoc(selection.from,selection.to);view.dispatch({changes:{from:selection.from,to:selection.to,insert:before+selected+after},
      selection:{anchor:selection.from+before.length,head:selection.from+before.length+selected.length}});view.focus();}
  return <div className={`markdown-composer ${props.className??""}${props.readOnly?" readonly":""}`}>
    <div className="markdown-toolbar" role="toolbar" aria-label={t("Text formatting")}>
      {!props.readOnly&&[["B","Bold","**","**"],["I","Italic","*","*"],["U","Underline","__","__"],["S","Strikethrough","~~","~~"],["❞","Quote","> ",""],["‹›","Code","`","`"],["▥","Spoiler","||","||"],["☑","Checklist","- [ ] ",""]].map(([label,title,before,after])=>
        <button type="button" key={title} title={t(title!)} aria-label={t(title!)} disabled={props.disabled} onMouseDown={event=>event.preventDefault()} onClick={()=>format(before!,after!)}>{label}</button>)}
      <span className="markdown-toolbar-spacer"/>
      <button type="button" aria-pressed={preview} onClick={()=>setPreview(!preview)}>{t(preview?"Edit":"Preview")}</button>
      {!props.readOnly&&!props.disabled&&<ContentPluginActions surface="editor" onEditorAction={()=>setFullEditor(true)}/>}
    </div>
    <div ref={host} className={preview?"markdown-editor-host hidden":"markdown-editor-host"}/>
    {preview&&<MarkdownView text={text||t("Nothing to preview yet.")}/>}
    <textarea name={props.name} hidden value={text} readOnly aria-hidden="true"/>
    {uploading&&<small className="markdown-uploading">{t("Uploading…")}</small>}
    {fullEditor&&<CyMDDialog text={text} onSaved={value=>{replace(value);setFullEditor(false);}} onClose={()=>setFullEditor(false)}/>}
  </div>;
});

export default MarkdownComposer;
