import { useEffect, useMemo, useRef, useState } from "react";
import { CallSession, emptyCall } from "../calls/CallSession";
import { useI18n } from "../i18n";

export function useVoiceRoom(channelId:string|undefined,onError:(message:string)=>void){
  const {t}=useI18n();const callbacks=useRef({onError,t});callbacks.current={onError,t};
  const [value,setValue]=useState(emptyCall);
  const session=useMemo(()=>channelId?new CallSession(channelId,setValue,message=>callbacks.current.onError(callbacks.current.t(message))):undefined,[channelId]);
  useEffect(()=>{setValue(emptyCall());return()=>session?.leave();},[session]);
  return {...value,active:value.status==="connected",join:session?.join??(async()=>undefined),leave:session?.leave??(()=>undefined),
    toggleMuted:session?.toggleMuted??(()=>undefined),toggleDeafened:session?.toggleDeafened??(()=>undefined),
    toggleCamera:session?.toggleCamera??(async()=>undefined),toggleScreen:session?.toggleScreen??(async()=>undefined),
    selectCamera:session?.selectCamera??(async()=>undefined),selectMicrophone:session?.selectMicrophone??(async()=>undefined),reconnect:session?.reconnect??(()=>undefined)};
}
