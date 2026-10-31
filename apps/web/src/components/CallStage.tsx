import { useEffect, useRef, useState } from "react";
import type { OrganizationMember } from "../api";
import { useI18n } from "../i18n";
import type { useVoiceRoom } from "./useVoiceRoom";

interface Props { call:ReturnType<typeof useVoiceRoom>;members:OrganizationMember[];currentUserId:string }
export function CallStage({call,members,currentUserId}:Props){
  const {t}=useI18n();const [settings,setSettings]=useState(false);
  const name=(id:string)=>members.find(member=>member.userId===id)?.displayName??t("Participant");
  return <section className="call-stage" aria-label={t("Live call")}>
    <header className="call-stage-heading"><strong>{t(call.status==="joining"?"Connecting…":"Live call")} · {call.participants.length+1}/{call.maxParticipants}</strong>
      <span>{t(call.relayConfigured?"TURN available":"Direct connections")}</span>
      <button type="button" onClick={()=>setSettings(!settings)} aria-expanded={settings}>{t("Devices")}</button>
      {call.active&&<button type="button" onClick={call.reconnect}>{t("Retry connection")}</button>}
    </header>
    {settings&&<div className="call-devices">
      <label>{t("Microphone")}<select aria-label={t("Microphone")} value={call.microphoneId} disabled={call.microphonePending||!call.active} onChange={event=>void call.selectMicrophone(event.target.value)}>
        <option value="">{t("System default")}</option>{call.devices.filter(device=>device.kind==="audioinput").map((device,index)=><option key={device.deviceId||index} value={device.deviceId}>{device.label||`${t("Microphone")} ${index+1}`}</option>)}
      </select></label>
      <label>{t("Camera")}<select aria-label={t("Camera")} value={call.cameraId} disabled={call.cameraPending||!call.active} onChange={event=>void call.selectCamera(event.target.value)}>
        <option value="">{t("System default")}</option>{call.devices.filter(device=>device.kind==="videoinput").map((device,index)=><option key={device.deviceId||index} value={device.deviceId}>{device.label||`${t("Camera")} ${index+1}`}</option>)}
      </select></label>
    </div>}
    <div className="call-participants">
      <article className="call-participant self" data-local="true">
        {call.camera?<CallVideo stream={call.camera} label={t("Your camera")}/>:<Avatar name={name(currentUserId)}/>}
        <footer><strong>{name(currentUserId)} · {t("You")}</strong><span>{t(call.muted?"Microphone muted":"Microphone on")}</span></footer>
      </article>
      {call.screen&&<ScreenTile stream={call.screen} label={t("Your screen")} local/>}
      {call.participants.map(participant=><article className="call-participant remote" key={participant.peerId} data-peer-id={participant.peerId} data-connection={participant.connectionState}>
        <CallAudio stream={participant.audio} muted={call.deafened} label={name(participant.userId)}/>
        {participant.state.camera&&participant.camera?<CallVideo stream={participant.camera} label={name(participant.userId)}/>:<Avatar name={name(participant.userId)}/>}
        <footer><strong>{name(participant.userId)}</strong><span>{t(participant.state.muted?"Microphone muted":"Microphone on")}</span>
          <small>{t(connectionLabel(participant.connectionState))}</small></footer>
      </article>)}
      {call.participants.filter(participant=>participant.state.screen&&participant.screen).map(participant=><ScreenTile key={`screen:${participant.peerId}`} stream={participant.screen!}
        label={t("{name}'s screen",{name:name(participant.userId)})}/>) }
    </div>
  </section>;
}
function connectionLabel(state:RTCPeerConnectionState){return state==="connected"?"Connected":state==="failed"?"Connection failed":state==="disconnected"?"Reconnecting…":"Connecting…";}
function Avatar({name}:{name:string}){return <div className="call-avatar"><span>{name.split(/\s+/).slice(0,2).map(word=>word[0]).join("").toUpperCase()}</span></div>;}
function usePlayback<T extends HTMLMediaElement>(stream:MediaStream|undefined){
  const ref=useRef<T>(null);const [blocked,setBlocked]=useState(false);
  useEffect(()=>{const element=ref.current;if(!element)return;let stopped=false;
    element.srcObject=stream??null;
    if(stream)void element.play().then(()=>{if(!stopped)setBlocked(false);}).catch(()=>{if(!stopped)setBlocked(true);});
    return()=>{stopped=true;element.srcObject=null;};
  },[stream]);
  return {ref,blocked,resume:()=>{void ref.current?.play().then(()=>setBlocked(false)).catch(()=>setBlocked(true));}};
}
function CallAudio({stream,muted,label}:{stream?:MediaStream;muted:boolean;label:string}){
  const {t}=useI18n();const player=usePlayback<HTMLAudioElement>(stream);
  return <><audio ref={player.ref} autoPlay muted={muted} aria-label={label}/>{player.blocked&&<button type="button" className="call-playback-retry" onClick={player.resume}>{t("Enable audio")}</button>}</>;
}
function CallVideo({stream,label}:{stream:MediaStream;label:string}){
  const {t}=useI18n();const player=usePlayback<HTMLVideoElement>(stream);
  return <><video ref={player.ref} autoPlay muted playsInline aria-label={label}/>{player.blocked&&<button type="button" className="call-playback-retry" onClick={player.resume}>{t("Play video")}</button>}</>;
}
function ScreenTile({stream,label,local=false}:{stream:MediaStream;label:string;local?:boolean}){
  const {t}=useI18n();const shell=useRef<HTMLElement>(null);
  return <article ref={shell} className="call-participant call-screen" data-screen={local?"local":"remote"}>
    <CallVideo stream={stream} label={label}/><footer><strong>{label}</strong><button type="button" onClick={()=>void shell.current?.requestFullscreen().catch(()=>undefined)}>{t("Full screen")}</button></footer>
  </article>;
}
