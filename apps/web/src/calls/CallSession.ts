import { api, type CallConfiguration } from "../api";

export interface MediaState { muted:boolean; camera:boolean; screen:boolean }
export interface CallParticipant {
  peerId:string;userId:string;state:MediaState;connectionState:RTCPeerConnectionState;
  audio?:MediaStream;camera?:MediaStream;screen?:MediaStream;
}
export interface CallSnapshot {
  status:"idle"|"joining"|"connected";muted:boolean;deafened:boolean;
  camera?:MediaStream;screen?:MediaStream;participants:CallParticipant[];
  cameraPending:boolean;microphonePending:boolean;screenPending:boolean;
  devices:MediaDeviceInfo[];microphoneId:string;cameraId:string;
  relayConfigured:boolean;maxParticipants:number;
}
interface Peer {
  pc:RTCPeerConnection;view:CallParticipant;slots:RTCRtpTransceiver[];
  makingOffer:boolean;ignoreOffer:boolean;settingAnswer:boolean;candidates:RTCIceCandidateInit[];
  restartCount:number;disconnectTimer?:ReturnType<typeof setTimeout>;
}
export const emptyCall=():CallSnapshot=>({status:"idle",muted:true,deafened:false,participants:[],
  cameraPending:false,microphonePending:false,screenPending:false,devices:[],microphoneId:"",cameraId:"",relayConfigured:false,maxParticipants:8});

// Three fixed transceivers keep microphone, camera and display tracks independent.
// Negotiation follows the polite/impolite collision-handling pattern, not user IDs.
export class CallSession {
  private value=emptyCall();
  private epoch=0;
  private socket?:WebSocket;
  private localPeerId="";
  private peers=new Map<string,Peer>();
  private mediaStates=new Map<string,MediaState>();
  private microphone?:MediaStream;
  private camera?:MediaStream;
  private screen?:MediaStream;
  private configuration?:CallConfiguration;
  private signals=Promise.resolve();
  private connectTimer?:ReturnType<typeof setTimeout>;
  private refreshTimer?:ReturnType<typeof setTimeout>;
  constructor(private channelId:string,private changed:(value:CallSnapshot)=>void,private error:(message:string)=>void) {}
  private live(epoch:number){return epoch===this.epoch&&this.value.status!=="idle";}
  private emit(){this.value={...this.value,camera:this.camera,screen:this.screen,participants:[...this.peers.values()].map(peer=>({...peer.view}))};this.changed(this.value);}
  private stop(stream?:MediaStream){stream?.getTracks().forEach(track=>{track.onended=null;track.stop();});}
  private send(message:object){if(this.socket?.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify(message));}
  private mediaState():MediaState{return {muted:this.value.muted,camera:Boolean(this.camera),screen:Boolean(this.screen)};}
  private publish(){this.send({type:"media-state",state:this.mediaState()});this.emit();}
  private rtcConfiguration(configuration:CallConfiguration):RTCConfiguration{return {iceServers:configuration.iceServers.map(server=>({urls:server.urls,
    ...(server.username?{username:server.username}:{}),...(server.credential?{credential:server.credential}:{})})),iceTransportPolicy:configuration.iceTransportPolicy,bundlePolicy:"max-bundle"};}

  join=async(withCamera=false)=>{
    if(this.value.status!=="idle")return;
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){this.error("Calls require HTTPS or a local loopback address.");return;}
    const epoch=++this.epoch;this.value={...emptyCall(),status:"joining"};this.emit();
    try{
      const configuration=await api.callConfiguration(this.channelId);if(!this.live(epoch))return;
      this.configuration=configuration;this.value={...this.value,relayConfigured:configuration.relayConfigured,maxParticipants:configuration.maxParticipants};
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
      if(!this.live(epoch)){this.stop(stream);return;}
      this.microphone=stream;this.value.muted=false;
      this.watchMicrophone(stream);
      if(withCamera)await this.setCamera(true,epoch);
      if(!this.live(epoch))return;
      const url=new URL(`/api/v1/chat/channels/${this.channelId}/signal`,window.location.href);url.protocol=url.protocol==="https:"?"wss:":"ws:";
      const socket=new WebSocket(url);this.socket=socket;
      this.connectTimer=setTimeout(()=>{if(this.live(epoch)&&!this.localPeerId){this.error("The call could not connect. Try again.");this.leave();}},12_000);
      socket.onopen=()=>{if(this.live(epoch))this.publish();};
      socket.onmessage=event=>{if(!this.live(epoch))return;this.signals=this.signals.then(async()=>{
        if(this.live(epoch))await this.receive(JSON.parse(String(event.data)),epoch);
      }).catch(()=>{if(this.live(epoch))this.error("A participant could not connect. Try reconnecting.");});};
      socket.onclose=event=>{if(this.socket!==socket||!this.live(epoch))return;
        this.error(event.code===1008&&event.reason==="Room is full"?"This call is full.":"The call ended or access was revoked.");this.leave();};
      socket.onerror=()=>{if(this.socket===socket&&this.live(epoch)){this.error("The call could not connect. Try again.");this.leave();}};
      navigator.mediaDevices.addEventListener("devicechange",this.refreshDevices);void this.refreshDevices();
      this.scheduleRefresh(epoch);
    }catch(reason){if(!this.live(epoch))return;this.error(reason instanceof DOMException?"Microphone access was denied or the device is unavailable.":"Unable to join this call. Check your access and connection.");this.leave();}
  };

  leave=()=>{
    ++this.epoch;clearTimeout(this.connectTimer);clearTimeout(this.refreshTimer);
    const socket=this.socket;this.socket=undefined;
    if(socket){socket.onclose=null;socket.onmessage=null;socket.onerror=null;socket.close();}
    for(const peer of this.peers.values()){clearTimeout(peer.disconnectTimer);peer.pc.onconnectionstatechange=null;peer.pc.onnegotiationneeded=null;peer.pc.ontrack=null;peer.pc.close();}
    this.peers.clear();this.mediaStates.clear();this.stop(this.microphone);this.stop(this.camera);this.stop(this.screen);
    this.microphone=this.camera=this.screen=undefined;this.localPeerId="";this.configuration=undefined;this.signals=Promise.resolve();
    navigator.mediaDevices?.removeEventListener("devicechange",this.refreshDevices);this.value=emptyCall();this.emit();
  };
  private refreshDevices=async()=>{const epoch=this.epoch;try{const devices=await navigator.mediaDevices.enumerateDevices();if(this.live(epoch)){this.value.devices=devices.filter(device=>device.kind!=="audiooutput");this.emit();}}catch{/* Optional device labels must not interrupt an established call. */}};
  private scheduleRefresh(epoch:number){
    if(!this.configuration?.credentialsExpireAt)return;
    const delay=Math.max(30_000,(Date.parse(this.configuration.credentialsExpireAt)-Date.now())/2);
    this.refreshTimer=setTimeout(async()=>{try{const next=await api.callConfiguration(this.channelId);if(!this.live(epoch))return;
      this.configuration=next;for(const peer of this.peers.values())peer.pc.setConfiguration(this.rtcConfiguration(next));this.scheduleRefresh(epoch);
    }catch{if(this.live(epoch)){this.error("Call credentials could not be renewed. Rejoin the call.");this.leave();}}},delay);
  }
  private ensurePeer(peerId:string,userId:string,state:MediaState,epoch:number):Peer{
    const existing=this.peers.get(peerId);if(existing)return existing;
    if(this.peers.size>=(this.configuration?.maxParticipants??8)-1)throw Error("Participant limit");
    const pc=new RTCPeerConnection(this.rtcConfiguration(this.configuration!));
    // Only one side creates the initial offer. The answerer reuses the offered
    // transceivers: creating its own before rollback would duplicate all tracks.
    const streams=[this.microphone,this.camera,this.screen];
    const slots=this.localPeerId<peerId?streams.map((stream,index)=>pc.addTransceiver(stream?.getTracks()[0]??(index===0?"audio":"video"),{direction:"sendrecv",...(stream?{streams:[stream]}:{})})):[];
    const peer:Peer={pc,slots,view:{peerId,userId,state:this.mediaStates.get(peerId)??state,connectionState:"new"},makingOffer:false,ignoreOffer:false,settingAnswer:false,candidates:[],restartCount:0};
    this.peers.set(peerId,peer);
    pc.onicecandidate=event=>{if(event.candidate&&this.live(epoch))this.send({type:"ice",target:peerId,payload:event.candidate.toJSON()});};
    pc.onnegotiationneeded=()=>{void(async()=>{
      try{peer.makingOffer=true;await pc.setLocalDescription();if(this.live(epoch))this.send({type:pc.localDescription!.type,target:peerId,payload:pc.localDescription!.toJSON()});}
      catch{if(this.live(epoch)&&pc.signalingState!=="closed")this.error("A participant could not connect. Try reconnecting.");}
      finally{peer.makingOffer=false;}
    })();};
    pc.ontrack=event=>{if(!this.live(epoch))return;
      const index=pc.getTransceivers().indexOf(event.transceiver);const key=index===0?"audio":index===1?"camera":"screen";
      peer.view[key]=new MediaStream([event.track]);this.emit();};
    pc.onconnectionstatechange=()=>{if(!this.live(epoch))return;peer.view.connectionState=pc.connectionState;this.emit();clearTimeout(peer.disconnectTimer);
      if(pc.connectionState==="failed")this.restartPeer(peer);
      else if(pc.connectionState==="disconnected")peer.disconnectTimer=setTimeout(()=>{if(this.live(epoch))this.restartPeer(peer);},10_000);
    };
    this.emit();return peer;
  }
  private restartPeer(peer:Peer){if(peer.restartCount++<1&&peer.pc.signalingState!=="closed")peer.pc.restartIce();}
  reconnect=()=>{for(const peer of this.peers.values()){peer.restartCount=0;this.restartPeer(peer);}};
  private async receive(message:Record<string,unknown>,epoch:number){
    if(message.type==="presence"){
      if(message.protocol!==2||typeof message.peerId!=="string"||!Array.isArray(message.peers))throw Error("Unsupported call protocol");
      this.localPeerId=message.peerId;clearTimeout(this.connectTimer);this.value.status="connected";
      for(const item of message.peers){if(validPresence(item))this.ensurePeer(item.peerId,item.userId,item.state,epoch);}
      this.publish();return;
    }
    if(message.type==="peer.joined"&&validPresence(message)){this.ensurePeer(message.peerId,message.userId,message.state,epoch);return;}
    if(message.type==="peer.left"&&typeof message.peerId==="string"){
      this.mediaStates.delete(message.peerId);
      const peer=this.peers.get(message.peerId);if(peer){clearTimeout(peer.disconnectTimer);this.peers.delete(message.peerId);peer.pc.onconnectionstatechange=null;peer.pc.close();this.emit();}return;
    }
    if(typeof message.sender!=="string")return;
    if(message.type==="media-state"&&validState(message.state)){
      if(this.mediaStates.size<(this.configuration?.maxParticipants??8)||this.mediaStates.has(message.sender))this.mediaStates.set(message.sender,message.state);
      const peer=this.peers.get(message.sender);if(peer){peer.view.state=message.state;this.emit();}return;
    }
    const peer=this.peers.get(message.sender);if(!peer)return;
    if(!message.payload||typeof message.payload!=="object")return;
    const pc=peer.pc;
    if(message.type==="offer"||message.type==="answer"){
      const description=message.payload as RTCSessionDescriptionInit;
      const ready=!peer.makingOffer&&(pc.signalingState==="stable"||peer.settingAnswer);
      peer.ignoreOffer=this.localPeerId<message.sender&&description.type==="offer"&&!ready;
      if(peer.ignoreOffer){peer.candidates=[];return;}
      peer.settingAnswer=description.type==="answer";
      try{await pc.setRemoteDescription(description);}finally{peer.settingAnswer=false;}
      if(!this.live(epoch))return;
      if(description.type==="offer"&&peer.slots.length===0){
        const offered=pc.getTransceivers();
        if(offered.length!==3||offered.some((slot,index)=>slot.receiver.track.kind!==(index===0?"audio":"video")))throw Error("Invalid call tracks");
        peer.slots=offered;const streams=[this.microphone,this.camera,this.screen];
        await Promise.all(offered.map(async(slot,index)=>{slot.direction="sendrecv";const stream=streams[index];slot.sender.setStreams(...(stream?[stream]:[]));await slot.sender.replaceTrack(stream?.getTracks()[0]??null);}));
        if(!this.live(epoch))return;
      }
      for(const candidate of peer.candidates.splice(0))await this.addCandidate(peer,candidate);
      if(description.type==="offer"){await pc.setLocalDescription();if(this.live(epoch))this.send({type:"answer",target:message.sender,payload:pc.localDescription!.toJSON()});}
    }else if(message.type==="ice"&&!peer.ignoreOffer){
      const candidate=message.payload as RTCIceCandidateInit;
      if(!pc.remoteDescription){if(peer.candidates.length<128)peer.candidates.push(candidate);}
      else await this.addCandidate(peer,candidate);
    }
  }
  private async addCandidate(peer:Peer,candidate:RTCIceCandidateInit){
    if(candidate.usernameFragment&&!peer.pc.remoteDescription?.sdp?.includes(`a=ice-ufrag:${candidate.usernameFragment}`))return;
    try{await peer.pc.addIceCandidate(candidate);}catch(error){if(!peer.ignoreOffer&&peer.pc.signalingState!=="closed")throw error;}
  }
  private async replaceTrack(slot:number,track:MediaStreamTrack|null){
    const updates=[...this.peers.values()].filter(peer=>peer.slots[slot]&&peer.pc.signalingState!=="closed").map(peer=>({peer,sender:peer.slots[slot]!.sender,previous:peer.slots[slot]!.sender.track}));
    const results=await Promise.allSettled(updates.map(item=>item.sender.replaceTrack(track)));
    const failed=results.findIndex((result,index)=>result.status==="rejected"&&updates[index]!.peer.pc.signalingState!=="closed");
    if(failed<0)return;
    // Do not leave some participants on a new input after another sender fails.
    await Promise.allSettled(updates.map((item,index)=>results[index]!.status==="fulfilled"&&item.peer.pc.signalingState!=="closed"?item.sender.replaceTrack(item.previous):Promise.resolve()));
    throw (results[failed] as PromiseRejectedResult).reason;
  }
  private watchMicrophone(stream:MediaStream){stream.getAudioTracks().forEach(track=>{track.onended=()=>{if(this.microphone===stream){this.value.muted=true;this.publish();}};});}
  toggleMuted=async()=>{if(this.value.status!=="connected"||this.value.microphonePending)return;
    if(!this.microphone?.getAudioTracks().some(track=>track.readyState==="live")){await this.selectMicrophone(this.value.microphoneId,true);return;}
    this.value.muted=!this.value.muted;
    this.microphone?.getAudioTracks().forEach(track=>{track.enabled=!this.value.muted;});this.publish();};
  toggleDeafened=()=>{this.value.deafened=!this.value.deafened;this.emit();};
  toggleCamera=async()=>{if(this.value.status!=="connected"||this.value.cameraPending)return;await this.setCamera(!this.camera,this.epoch);};
  private async setCamera(enabled:boolean,epoch:number){
    if(this.value.cameraPending)return;this.value.cameraPending=true;this.emit();
    try{
      if(!enabled){const previous=this.camera;this.camera=undefined;try{await this.replaceTrack(1,null);}finally{this.stop(previous);this.publish();}return;}
      const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{width:{ideal:1280},height:{ideal:720},frameRate:{ideal:24,max:30},...(this.value.cameraId?{deviceId:{exact:this.value.cameraId}}:{})}});
      if(!this.live(epoch)){this.stop(stream);return;}
      const previous=this.camera;
      try{await this.replaceTrack(1,stream.getVideoTracks()[0]??null);}catch(error){this.stop(stream);throw error;}
      if(!this.live(epoch)){this.stop(stream);return;}
      this.camera=stream;this.stop(previous);stream.getVideoTracks().forEach(track=>{track.onended=()=>{if(this.camera===stream)void this.setCamera(false,this.epoch);};});
      this.publish();void this.refreshDevices();
    }catch{if(this.live(epoch))this.error("Camera access was denied or the device is unavailable.");}
    finally{if(this.live(epoch)){this.value.cameraPending=false;this.emit();}}
  }
  toggleScreen=async()=>{
    if(this.value.status!=="connected"||this.value.screenPending)return;const epoch=this.epoch;this.value.screenPending=true;this.emit();
    try{
      if(this.screen){await this.stopScreen();return;}
      if(!navigator.mediaDevices.getDisplayMedia)throw Error("Unsupported");
      const stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:15,max:30}},audio:false});
      if(!this.live(epoch)){this.stop(stream);return;}
      try{await this.replaceTrack(2,stream.getVideoTracks()[0]??null);}catch(error){this.stop(stream);throw error;}
      if(!this.live(epoch)){this.stop(stream);return;}
      this.screen=stream;stream.getVideoTracks().forEach(track=>{track.onended=()=>{if(this.screen===stream)void this.stopScreen();};});this.publish();
    }catch{if(this.live(epoch))this.error("Screen sharing was cancelled or is unavailable.");}
    finally{if(this.live(epoch)){this.value.screenPending=false;this.emit();}}
  };
  private async stopScreen(){const epoch=this.epoch;const previous=this.screen;this.screen=undefined;
    try{await this.replaceTrack(2,null);}catch{if(this.live(epoch))this.error("Screen sharing was cancelled or is unavailable.");}
    finally{this.stop(previous);if(this.live(epoch))this.publish();}}
  selectCamera=async(id:string)=>{this.value.cameraId=id;this.emit();if(this.camera)await this.setCamera(true,this.epoch);};
  selectMicrophone=async(id:string,unmute=false)=>{
    if(this.value.status!=="connected"||this.value.microphonePending)return;const epoch=this.epoch;this.value.microphonePending=true;this.emit();
    try{const stream=await navigator.mediaDevices.getUserMedia({video:false,audio:{...(id?{deviceId:{exact:id}}:{}),echoCancellation:true,noiseSuppression:true}});
      // Keep a replacement muted until every sender has accepted it.
      if(!this.live(epoch)){this.stop(stream);return;}stream.getAudioTracks().forEach(track=>{track.enabled=false;});
      const previous=this.microphone;try{await this.replaceTrack(0,stream.getAudioTracks()[0]??null);}catch(error){this.stop(stream);throw error;}
      if(!this.live(epoch)){this.stop(stream);return;}this.microphone=stream;this.stop(previous);this.watchMicrophone(stream);this.value.microphoneId=id;
      if(unmute)this.value.muted=false;stream.getAudioTracks().forEach(track=>{track.enabled=!this.value.muted;});this.publish();
    }catch{if(this.live(epoch))this.error("The microphone could not be changed.");}
    finally{if(this.live(epoch)){this.value.microphonePending=false;this.emit();}}
  };
}
function validState(value:unknown):value is MediaState{return Boolean(value&&typeof value==="object"&&["muted","camera","screen"].every(key=>typeof(value as Record<string,unknown>)[key]==="boolean"));}
function validPresence(value:unknown):value is {peerId:string;userId:string;state:MediaState}{if(!value||typeof value!=="object")return false;
  const item=value as Record<string,unknown>;return typeof item.peerId==="string"&&typeof item.userId==="string"&&validState(item.state);}
