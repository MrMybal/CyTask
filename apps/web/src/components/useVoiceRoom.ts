import { useCallback, useEffect, useRef, useState } from "react";

interface SignalMessage {
  type: "presence" | "peer.joined" | "peer.left" | "offer" | "answer" | "ice";
  userId?: string;
  users?: string[];
  sender?: string;
  payload?: RTCSessionDescriptionInit | RTCIceCandidateInit;
}

export function useVoiceRoom(
  channelId: string | undefined,
  userId: string,
  onError: (message: string) => void
) {
  const [active, setActive] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [screenStream, setScreenStream] = useState<MediaStream>();
  const socket = useRef<WebSocket | undefined>(undefined);
  const microphone = useRef<MediaStream | undefined>(undefined);
  const screenShare = useRef<MediaStream | undefined>(undefined);
  const peers = useRef(new Map<string, RTCPeerConnection>());

  const send = useCallback((message: object) => {
    if (socket.current?.readyState === WebSocket.OPEN)
      socket.current.send(JSON.stringify(message));
  }, []);

  const ensurePeer = useCallback((peerId: string) => {
    const existing = peers.current.get(peerId);
    if (existing) return existing;
    const connection = new RTCPeerConnection();
    const localMicrophone = microphone.current;
    localMicrophone?.getTracks().forEach((track) => connection.addTrack(track, localMicrophone));
    screenShare.current?.getVideoTracks().forEach((track) => connection.addTrack(track, screenShare.current!));
    connection.onicecandidate = (event) => {
      if (event.candidate) send({ type: "ice", target: peerId, payload: event.candidate.toJSON() });
    };
    connection.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      setRemoteStreams((current) => new Map(current).set(peerId, stream));
    };
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === "failed" || connection.connectionState === "closed") {
        connection.close();
        peers.current.delete(peerId);
        setRemoteStreams((current) => {
          const next = new Map(current);
          next.delete(peerId);
          return next;
        });
      }
    };
    peers.current.set(peerId, connection);
    return connection;
  }, [send]);

  const negotiate = useCallback(async (peerId: string) => {
    const connection = ensurePeer(peerId);
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    send({ type: "offer", target: peerId, payload: offer });
  }, [ensurePeer, send]);

  const leave = useCallback(() => {
    const currentSocket = socket.current;
    socket.current = undefined;
    currentSocket?.close();
    microphone.current?.getTracks().forEach((track) => track.stop());
    microphone.current = undefined;
    screenShare.current?.getTracks().forEach((track) => track.stop());
    screenShare.current = undefined;
    setScreenStream(undefined);
    peers.current.forEach((connection) => connection.close());
    peers.current.clear();
    setRemoteStreams(new Map());
    setActive(false);
  }, []);

  const join = useCallback(async () => {
    if (!channelId || active) return;
    try {
      microphone.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false
      });
      const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
      const nextSocket = new WebSocket(
        scheme + "//" + window.location.host + "/api/v1/chat/channels/" + channelId + "/signal"
      );
      socket.current = nextSocket;
      nextSocket.onmessage = (event) => {
        void (async () => {
          const message = JSON.parse(String(event.data)) as SignalMessage;
          if (message.type === "presence") {
            for (const peerId of message.users ?? [])
              if (userId.localeCompare(peerId) < 0) await negotiate(peerId);
            return;
          }
          if (message.type === "peer.joined" && message.userId) {
            if (userId.localeCompare(message.userId) < 0) await negotiate(message.userId);
            return;
          }
          if (message.type === "peer.left" && message.userId) {
            const departingUserId = message.userId;
            peers.current.get(departingUserId)?.close();
            peers.current.delete(departingUserId);
            setRemoteStreams((current) => {
              const next = new Map(current);
              next.delete(departingUserId);
              return next;
            });
            return;
          }
          if (!message.sender || !message.payload) return;
          const connection = ensurePeer(message.sender);
          if (message.type === "offer") {
            await connection.setRemoteDescription(message.payload as RTCSessionDescriptionInit);
            const answer = await connection.createAnswer();
            await connection.setLocalDescription(answer);
            send({ type: "answer", target: message.sender, payload: answer });
          } else if (message.type === "answer") {
            await connection.setRemoteDescription(message.payload as RTCSessionDescriptionInit);
          } else if (message.type === "ice") {
            await connection.addIceCandidate(message.payload as RTCIceCandidateInit);
          }
        })().catch(() => onError("La connexion vocale avec un membre a échoué."));
      };
      nextSocket.onopen = () => setActive(true);
      nextSocket.onerror = () => {
        onError("Le salon vocal n’est pas disponible.");
        leave();
      };
      nextSocket.onclose = () => {
        if (socket.current === nextSocket) leave();
        else setActive(false);
      };
    } catch {
      onError("Autorisez le microphone pour rejoindre le salon vocal.");
      leave();
    }
  }, [active, channelId, ensurePeer, leave, negotiate, onError, send, userId]);

  const toggleScreen = useCallback(async () => {
    if (screenStream) {
      const track = screenStream.getVideoTracks()[0];
      if (!track) return;
      for (const [peerId, connection] of peers.current) {
        const sender = connection.getSenders().find((item) => item.track === track);
        if (sender) connection.removeTrack(sender);
        await negotiate(peerId);
      }
      screenShare.current = undefined;
      screenStream.getTracks().forEach((item) => item.stop());
      setScreenStream(undefined);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      screenShare.current = stream;
      setScreenStream(stream);
      const track = stream.getVideoTracks()[0];
      if (!track) {
        screenShare.current = undefined;
        stream.getTracks().forEach((item) => item.stop());
        setScreenStream(undefined);
        return;
      }
      track.onended = () => {
        if (screenShare.current === stream) {
          screenShare.current = undefined;
          setScreenStream(undefined);
        }
      };
      for (const [peerId, connection] of peers.current) {
        connection.addTrack(track, stream);
        await negotiate(peerId);
      }
    } catch {
      onError("Le partage d’écran a été annulé ou refusé.");
    }
  }, [negotiate, onError, screenStream]);

  useEffect(() => () => leave(), [channelId, leave]);
  return {
    active,
    join,
    leave,
    toggleScreen,
    screenStream,
    remoteStreams: [...remoteStreams.entries()]
  };
}
