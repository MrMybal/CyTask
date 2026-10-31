import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, type ChatChannel, type OrganizationMember, type Project, type ProjectLabel,
  type ProjectRoom, type ProjectRoomKind, type ProjectSpace, type ProjectSpaceView,
  type RoomActivity, type ProjectResource, type TaskOption } from "../api";
import { createWorkspaceEventStream } from "../workspaceEvents";
import { useI18n } from "../i18n";
import { ResourceEditor } from "./ResourceEditor";
import { MarkdownComposer } from "./Markdown";

export const roomKinds: {kind: ProjectRoomKind; label: string; description: string}[] = [
  {kind:"tasks",label:"Tasks",description:"Lists, boards and project work"},
  {kind:"chat",label:"Text room",description:"Messages, mentions and attachments"},
  {kind:"voice",label:"Voice room",description:"Talk and share your screen"},
  {kind:"video",label:"Video room",description:"A meeting space with shared media"},
  {kind:"document",label:"Document",description:"A shared Markdown page"},
  {kind:"canvas",label:"Canvas",description:"Images, notes and free drawing"},
  {kind:"files",label:"Files",description:"The project's shared library"},
  {kind:"news",label:"Announcements",description:"Updates published by project administrators"},
  {kind:"graph",label:"Graph",description:"Explore tasks and dependencies"}
];
export function RoomIcon({kind}:{kind:ProjectRoomKind | "settings" | "home"}) {
  const paths: Record<string,string> = {
    tasks:"M4 5h3v3H4zM10 6h10M4 11h3v3H4zM10 12h10M4 17h3v3H4zM10 18h10",
    chat:"M9 3 6 21M18 3l-3 18M3 9h18M2 15h18",
    voice:"m4 9 5-4v14l-5-4H2V9zm10-2c4 3 4 7 0 10m3-13c6 4 6 12 0 16",
    video:"M3 6h12v12H3zm12 4 6-3v10l-6-3",
    document:"M5 3h10l4 4v14H5zm10 0v5h4M8 12h8M8 16h6",
    canvas:"m12 3 9 9-9 9-9-9zM9 9l6 6M9 15l6-6",
    files:"M3 6h7l2 2h9v12H3zM3 6V4h7l2 2",
    news:"M3 10h4l13-5v14L7 14H3zm4 4 2 6h3l-2-5",
    graph:"M5 5h4v4H5zM15 15h4v4h-4zM15 4h4v4h-4zM9 7h6M7 9v8h8",
    settings:"M4 7h16M4 17h16M9 4v6M15 14v6",
    home:"m3 11 9-8 9 8M5 9v12h14V9M10 21v-8h4v8"
  };
  return <svg className="room-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]}/></svg>;
}
export function projectRoomHash(projectId:string,roomId:string) { return `#/servers/${projectId}/rooms/${roomId}`; }
export function roomLocation(hash=window.location.hash) {
  const match=/^#\/servers\/([\da-f-]{36})\/rooms\/([\da-f-]{36})(?:\/tasks\/[\da-f-]{36})?$/i.exec(hash);
  return match ? {projectId:match[1]!,roomId:match[2]!} : undefined;
}
interface Props {
  project:Project; currentUserId:string; members:OrganizationMember[]; labels:ProjectLabel[];
  activeRoomId?:string; settingsOpen:boolean; onCloseSettings:()=>void;
  onSelect:(room:ProjectRoom)=>void; onSpace:(view:ProjectSpaceView)=>void; onError:(message:string)=>void;
}
export function ProjectRooms({project,currentUserId,members,labels,activeRoomId,settingsOpen,onCloseSettings,onSelect,onSpace,onError}:Props) {
  const {t}=useI18n();
  const [view,setView]=useState<ProjectSpaceView>();
  const [channels,setChannels]=useState<ChatChannel[]>([]);
  const [activity,setActivity]=useState<RoomActivity[]>([]);
  const [creating,setCreating]=useState(false);
  const [busy,setBusy]=useState(false);
  const [kind,setKind]=useState<ProjectRoomKind>("chat");
  const [categoryName,setCategoryName]=useState<string>();
  const [settings,setSettings]=useState<ProjectSpace>();
  const [collapsed,setCollapsed]=useState<Set<string>>(new Set());
  const readKey=`cytask.room-reads:${currentUserId}:${project.id}`;
  const [readTimes,setReadTimes]=useState<Record<string,string>>({});
  const callbacks=useRef({onSpace,onError}); callbacks.current={onSpace,onError};
  const bootTime=useRef(new Date().toISOString());
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const load=useCallback(async()=>{
    try {
      const [next,nextChannels,nextActivity]=await Promise.all([api.projectSpace(project.id),api.chatChannels(project.id),api.roomActivity(project.id)]);
      if(!mounted.current)return;
      setView(next);setChannels(nextChannels);setActivity(nextActivity);callbacks.current.onSpace(next);
    } catch { callbacks.current.onError(t("Unable to load project rooms.")); }
  },[project.id,t]);
  useEffect(()=>{
    setView(undefined);setChannels([]);setActivity([]);setCreating(false);setSettings(undefined);
    try {setReadTimes(JSON.parse(localStorage.getItem(readKey)||"{}") as Record<string,string>);
      setCollapsed(new Set(JSON.parse(localStorage.getItem(`cytask.room-categories:${project.id}`)||"[]") as string[]));
    } catch {setReadTimes({});setCollapsed(new Set());}
    let active=true;
    void Promise.all([api.projectSpace(project.id),api.chatChannels(project.id),api.roomActivity(project.id)]).then(([next,c,a])=>{
      if(!active)return;setView(next);setChannels(c);setActivity(a);callbacks.current.onSpace(next);
    }).catch(()=>{if(active)callbacks.current.onError(t("Unable to load project rooms."));});
    const stream=createWorkspaceEventStream(); let timer:number|undefined;
    const refresh=()=>{if(timer===undefined)timer=window.setTimeout(()=>{timer=undefined;if(active)void load();},200);};
    for(const name of ["project.space_updated","chat.channel_created","chat.message_created","workspace.synchronized","reset"])stream.addEventListener(name,refresh);
    return()=>{active=false;window.clearTimeout(timer);stream.close();};
  },[project.id,readKey,load,t]);
  const space=view?.space;
  const canManage=view?.accessRole==="owner"||view?.accessRole==="admin";
  const rooms=[...(space?.rooms??[])].filter(room=>!(room.kind==="chat"&&!room.targetId&&space?.rooms.some(other=>other.kind==="chat"&&other.targetId)));
  for(const channel of channels) if(!rooms.some(room=>room.targetId===channel.id)) {
    // An unbound default conversation opens the first legacy channel without duplicating it.
    if(rooms.some(room=>room.kind==="chat"&&!room.targetId)&&channel.id===channels[0]?.id)continue;
    rooms.push({id:channel.id,name:channel.name,kind:"chat",categoryId:space?.categories.find(x=>x.name==="TEAM")?.id??null,
      targetId:channel.id,folderLabelId:null,topic:channel.topic,position:1000+rooms.length});
  }
  useEffect(()=>{
    if(!activeRoomId||!view)return;
    const room=view.space.rooms.find(x=>x.id===activeRoomId);
    const channelId=room?.targetId??(room?.kind==="chat"?channels[0]?.id:activeRoomId);
    const latest=activity.find(x=>x.channelId===channelId)?.latestMessageAt;
    if(!latest)return;
    setReadTimes(current=>{if(current[channelId!]===latest)return current;
      const next={...current,[channelId!]:latest};try{localStorage.setItem(readKey,JSON.stringify(next));}catch{/* optional device preference */}return next;});
  },[activeRoomId,activity,channels,readKey,view]);
  useEffect(()=>{if(settingsOpen&&space)setSettings(structuredClone(space));},[settingsOpen]);
  const save=async(next:ProjectSpace)=>{const saved=await api.saveProjectSpace(next);const updated={space:saved,accessRole:view!.accessRole};
    setView(updated);callbacks.current.onSpace(updated);return saved;};
  async function create(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!space||busy)return;const data=new FormData(event.currentTarget);setBusy(true);
    try {const next=await api.createProjectRoom(project.id,{name:String(data.get("name")),kind,topic:String(data.get("topic")||""),
      categoryId:String(data.get("categoryId")??"")||null,folderLabelId:String(data.get("folderLabelId")??"")||null,expectedRevision:space.revision});
      const updated={space:next,accessRole:view!.accessRole};setView(updated);callbacks.current.onSpace(updated);setCreating(false);onSelect(next.rooms[next.rooms.length-1]!);
    }catch{onError(t("Unable to save rooms. Reload if someone edited this project."));void load();}finally{setBusy(false);}
  }
  async function saveSettings(event:FormEvent){event.preventDefault();if(!settings||busy)return;setBusy(true);
    try{await save(settings);onCloseSettings();}catch{onError(t("Unable to save project permissions. Reload before retrying."));}finally{setBusy(false);}}
  const renderRoom=(room:ProjectRoom)=>{
    const channelId=room.targetId??(room.kind==="chat"?channels[0]?.id:undefined);
    const latest=activity.find(x=>x.channelId===channelId)?.latestMessageAt;
    const unread=room.id!==activeRoomId&&latest&&latest>(readTimes[channelId!]??bootTime.current);
    return <button type="button" key={room.id} className={`room-link${activeRoomId===room.id?" active":""}${unread?" unread":""}`}
      title={room.topic||room.name} onClick={()=>onSelect(room)} aria-current={activeRoomId===room.id?"page":undefined}>
      <RoomIcon kind={room.kind}/><span>{room.name}</span>{unread&&<b className="room-unread-dot" aria-label={t("New messages")}/>}
      {room.kind==="news"&&<small>{t("NEWS")}</small>}</button>;
  };
  return <>
    <div className="rooms-tools"><span>{t("ROOMS")}</span>{canManage&&<button type="button" className="room-add" aria-label={t("Create room")} title={t("Create room")} onClick={()=>setCreating(true)}>+</button>}</div>
    {!view&&<p className="empty-note">{t("Loading rooms…")}</p>}
    {rooms.filter(x=>!x.categoryId).map(renderRoom)}
    {space?.categories.slice().sort((a,b)=>a.position-b.position).map(category=><section className="room-category" key={category.id}>
      <div className="room-category-heading"><button type="button" aria-expanded={!collapsed.has(category.id)} onClick={()=>setCollapsed(current=>{
        const next=new Set(current);if(next.has(category.id))next.delete(category.id);else next.add(category.id);
        try{localStorage.setItem(`cytask.room-categories:${project.id}`,JSON.stringify([...next]));}catch{/* optional preference */}return next;})}>
        <span>{collapsed.has(category.id)?"›":"⌄"}</span>{t(category.name)}</button>
        {canManage&&<button type="button" title={t("Create room")} onClick={()=>setCreating(true)}>+</button>}</div>
      {!collapsed.has(category.id)&&rooms.filter(x=>x.categoryId===category.id).sort((a,b)=>a.position-b.position).map(renderRoom)}
    </section>)}
    {canManage&&(categoryName===undefined?<button className="add-category" type="button" onClick={()=>setCategoryName("")}>+ {t("Add category")}</button>:
      <form className="room-category-create" onSubmit={event=>{event.preventDefault();if(space&&categoryName.trim())void save({...space,categories:[...space.categories,{id:crypto.randomUUID(),name:categoryName.trim(),position:space.categories.length}]}).then(()=>setCategoryName(undefined)).catch(()=>onError(t("Unable to save rooms. Reload if someone edited this project.")));}}>
        <input aria-label={t("Category name")} value={categoryName} maxLength={80} onChange={event=>setCategoryName(event.target.value)} autoFocus required/>
        <button type="submit">✓</button><button type="button" onClick={()=>setCategoryName(undefined)}>×</button></form>)}
    {creating&&space&&<div className="server-dialog-backdrop"><section className="server-dialog" role="dialog" aria-modal="true" aria-labelledby="room-create-title">
      <header><div><small>{project.name}</small><h2 id="room-create-title">{t("Create room")}</h2></div><button className="icon-button quiet" type="button" aria-label={t("Close")} onClick={()=>setCreating(false)}>×</button></header>
      <form onSubmit={create}><div className="room-kind-grid">{roomKinds.map(option=><button type="button" key={option.kind} className={kind===option.kind?"selected":""} onClick={()=>setKind(option.kind)} aria-pressed={kind===option.kind}>
        <RoomIcon kind={option.kind}/><span><strong>{t(option.label)}</strong><small>{t(option.description)}</small></span></button>)}</div>
        <label>{t("Room name")}<input name="name" placeholder="new-room" maxLength={80} required autoFocus/></label>
        <div className="room-form-row"><label>{t("Category")}<select name="categoryId"><option value="">{t("No category")}</option>{space.categories.map(category=><option key={category.id} value={category.id}>{t(category.name)}</option>)}</select></label>
        {(kind==="tasks"||kind==="graph")&&<label>{t("Task folder")}<select name="folderLabelId"><option value="">{t("All tasks")}</option>{labels.map(label=><option value={label.id} key={label.id}>{label.name}</option>)}</select></label>}</div>
        <label>{t("Room topic")}<MarkdownComposer name="topic" maxLength={2000} placeholder={t("What is this room for?")}/></label>
        <footer><button className="text-button" type="button" onClick={()=>setCreating(false)}>{t("Cancel")}</button><button className="primary-button small" disabled={busy} type="submit">{t(busy?"Creating…":"Create room")}</button></footer>
      </form></section></div>}
    {settingsOpen&&settings&&<div className="server-dialog-backdrop"><section className="server-dialog server-permissions" role="dialog" aria-modal="true" aria-labelledby="server-settings-title">
      <header><div><small>{project.name}</small><h2 id="server-settings-title">{t("Project settings")}</h2></div><button className="icon-button quiet" type="button" aria-label={t("Close")} onClick={onCloseSettings}>×</button></header>
      <form onSubmit={saveSettings}><p className="muted">{t("Rooms inherit this project's permissions. Organization administrators retain access.")}</p>
        <label>{t("Project access")}<select value={settings.visibility} disabled={!canManage} onChange={event=>setSettings({...settings,visibility:event.target.value as ProjectSpace["visibility"]})}>
          <option value="organization">{t("Organization · inherited roles")}</option><option value="private">{t("Private · explicit members only")}</option></select></label>
        <h3>{t("Members and roles")}</h3><div className="project-role-list">{members.map(member=><div key={member.userId}>
          <span className="profile-avatar small-avatar">{member.displayName.slice(0,2).toUpperCase()}</span><strong>{member.displayName}</strong>
          {member.userId===settings.ownerId?<small>{t("Project owner")}</small>:<select aria-label={`${t("Role")} · ${member.displayName}`} disabled={!canManage}
            value={settings.members.find(x=>x.userId===member.userId)?.role??""} onChange={event=>setSettings({...settings,members:[...settings.members.filter(x=>x.userId!==member.userId),...(event.target.value?[{userId:member.userId,role:event.target.value as "admin"|"member"|"viewer"}]:[])]})}>
            <option value="">{t(settings.visibility==="private"?"No project access":"Inherit organization role")}</option><option value="viewer">{t("Viewer")}</option><option value="member">{t("Member")}</option><option value="admin">{t("Administrator")}</option></select>}
        </div>)}</div><footer><button className="text-button" type="button" onClick={onCloseSettings}>{t("Close")}</button>{canManage&&<button className="primary-button small" type="submit" disabled={busy}>{t("Save permissions")}</button>}</footer>
      </form></section></div>}
  </>;
}

export function RoomResourcePage({room,labels,tasks,canContribute,onOpenTask,onError,onNotice}:{room:ProjectRoom;labels:ProjectLabel[];tasks:TaskOption[];
  canContribute:boolean;onOpenTask:(id:string)=>void;onError:(message:string)=>void;onNotice:(message:string)=>void}) {
  const {t}=useI18n();const [resource,setResource]=useState<ProjectResource>();
  useEffect(()=>{let active=true;setResource(undefined);if(room.targetId)void api.projectResource(room.targetId).then(value=>{if(active)setResource(value);}).catch(()=>{if(active)onError(t("Unable to open room content."));});return()=>{active=false;};},[room.targetId,onError,t]);
  return <div className="room-resource-page">{resource?<ResourceEditor resource={resource} labels={labels} tasks={tasks} canContribute={canContribute}
    onClose={()=>undefined} onSaved={setResource} onOpenTask={onOpenTask} onError={onError} onNotice={onNotice}/>:<p className="empty-note">{t("Loading contents…")}</p>}</div>;
}
