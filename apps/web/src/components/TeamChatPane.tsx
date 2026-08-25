import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  api,
  type ChatChannel,
  type ChatMessage,
  type OrganizationMember,
  type ProjectResource
} from "../api";
import { uploadProjectFile } from "../resourceUpload";
import { ChatMessageList } from "./ChatMessageList";
import { useVoiceRoom } from "./useVoiceRoom";

interface Props {
  projectId: string;
  currentUserId: string;
  members: OrganizationMember[];
  canContribute: boolean;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

export function TeamChatPane({
  projectId,
  currentUserId,
  members,
  canContribute,
  onError,
  onNotice
}: Props) {
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [library, setLibrary] = useState<ProjectResource[]>([]);
  const [pendingResources, setPendingResources] = useState<ProjectResource[]>([]);
  const [creatingChannel, setCreatingChannel] = useState(false);
  const [progress, setProgress] = useState<{ label: string; percent: number }>();
  const fileInput = useRef<HTMLInputElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const selectedChannel = channels.find((channel) => channel.id === selectedChannelId);
  const voice = useVoiceRoom(selectedChannelId, currentUserId, onError);

  const loadChannels = useCallback(async () => {
    try {
      const next = await api.chatChannels(projectId);
      setChannels(next);
      setSelectedChannelId((current) =>
        current && next.some((item) => item.id === current) ? current : next[0]?.id);
    } catch {
      onError("Impossible de charger les salons.");
    }
  }, [onError, projectId]);

  const loadMessages = useCallback(async () => {
    if (!selectedChannelId) {
      setMessages([]);
      return;
    }
    try {
      setMessages(await api.chatMessages(selectedChannelId));
    } catch {
      onError("Impossible de charger les messages.");
    }
  }, [onError, selectedChannelId]);

  useEffect(() => {
    void loadChannels();
    void api.projectResources(projectId).then(setLibrary).catch(() => undefined);
  }, [loadChannels, projectId]);
  useEffect(() => { void loadMessages(); }, [loadMessages]);
  useEffect(() => {
    const stream = new EventSource("/api/v1/events");
    stream.addEventListener("chat.message_created", () => void loadMessages());
    stream.addEventListener("chat.channel_created", () => void loadChannels());
    stream.addEventListener("project.resource_available", () =>
      void api.projectResources(projectId).then(setLibrary));
    return () => stream.close();
  }, [loadChannels, loadMessages, projectId]);

  async function createChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const channel = await api.createChatChannel(projectId, {
        name: String(data.get("name")),
        topic: String(data.get("topic"))
      });
      setChannels((current) => [...current.filter((item) => item.id !== channel.id), channel]);
      setSelectedChannelId(channel.id);
      setCreatingChannel(false);
      form.reset();
      onNotice("Salon créé.");
    } catch {
      onError("Impossible de créer ce salon.");
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedChannelId) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const body = String(data.get("body")).trim() || (pendingResources.length ? "Fichier partagé" : "");
    if (!body) return;
    const normalized = body.toLocaleLowerCase("fr");
    const mentionedUserIds = members
      .filter((member) => normalized.includes("@" + member.displayName.toLocaleLowerCase("fr")))
      .map((member) => member.userId);
    try {
      const message = await api.createChatMessage(selectedChannelId, {
        body,
        resourceIds: pendingResources.map((resource) => resource.id),
        mentionedUserIds
      });
      setMessages((current) => [...current.filter((item) => item.id !== message.id), message]);
      setPendingResources([]);
      form.reset();
      composer.current?.focus();
    } catch {
      onError("Impossible d’envoyer ce message.");
    }
  }

  async function upload(files: File[]) {
    if (!canContribute || !files.length || progress) return;
    try {
      for (const file of files) {
        const resource = await uploadProjectFile(projectId, null, file,
          (label, percent) => setProgress({ label: file.name + " · " + label, percent }));
        setLibrary((current) => [resource, ...current.filter((item) => item.id !== resource.id)]);
        setPendingResources((current) => [...current, resource]);
      }
    } catch {
      onError("Impossible d’ajouter ce fichier au message.");
    } finally {
      setProgress(undefined);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function mention(member: OrganizationMember) {
    const textarea = composer.current;
    if (!textarea) return;
    const separator = textarea.value && !textarea.value.endsWith(" ") ? " " : "";
    textarea.value += separator + "@" + member.displayName + " ";
    textarea.focus();
  }

  return (
    <section className="team-chat-pane">
      <aside className="chat-channels">
        <header><div><small>DISCUSSIONS</small><strong>Salons d’équipe</strong></div>
          {canContribute && <button type="button" onClick={() => setCreatingChannel(true)}>+</button>}</header>
        {creatingChannel && (
          <form onSubmit={createChannel}>
            <input name="name" placeholder="Nom du salon" maxLength={80} required autoFocus />
            <input name="topic" placeholder="Sujet (optionnel)" maxLength={500} />
            <button type="submit">Créer</button>
            <button type="button" onClick={() => setCreatingChannel(false)}>Annuler</button>
          </form>
        )}
        <nav>
          {channels.map((channel) => (
            <button className={channel.id === selectedChannelId ? "active" : ""} type="button"
              key={channel.id} onClick={() => setSelectedChannelId(channel.id)}>
              <span>#</span><span><strong>{channel.name}</strong><small>{channel.topic || "Salon texte et vocal"}</small></span>
            </button>
          ))}
        </nav>
        {channels.length === 0 && (
          <div className="channel-empty"><span>#</span><p>Créez le premier salon de ce projet.</p>
            {canContribute && <button type="button" onClick={() => setCreatingChannel(true)}>Créer # général</button>}</div>
        )}
      </aside>

      <section className="chat-conversation">
        {selectedChannel ? (
          <>
            <header className="chat-room-header">
              <div><h2># {selectedChannel.name}</h2><p>{selectedChannel.topic || "Discussion du projet"}</p></div>
              <div className="voice-actions">
                {!voice.active ? (
                  <button type="button" onClick={() => void voice.join()}>◉ Rejoindre le vocal</button>
                ) : (
                  <>
                    <span className="voice-live">● Vocal · {voice.remoteStreams.length + 1}</span>
                    <button type="button" onClick={() => void voice.toggleScreen()}>
                      {voice.screenStream ? "Arrêter le partage" : "Partager l’écran"}
                    </button>
                    <button type="button" onClick={voice.leave}>Quitter</button>
                  </>
                )}
              </div>
            </header>
            {voice.screenStream && <ScreenPreview stream={voice.screenStream} />}
            {voice.remoteStreams.map(([peerId, stream]) => <RemoteMedia key={peerId} stream={stream} />)}
            <ChatMessageList messages={messages} members={members} currentUserId={currentUserId} />
            {canContribute && (
              <form className="chat-composer" onSubmit={sendMessage}>
                {pendingResources.length > 0 && (
                  <div className="pending-chat-files">
                    {pendingResources.map((resource) => (
                      <button type="button" key={resource.id}
                        onClick={() => setPendingResources((current) => current.filter((item) => item.id !== resource.id))}>
                        {resource.name} ×
                      </button>
                    ))}
                  </div>
                )}
                {progress && <div className="chat-upload-progress"><span>{progress.label}</span><progress value={progress.percent} max={100} /></div>}
                <textarea ref={composer} name="body" placeholder={"Écrire dans #" + selectedChannel.name + " · utilisez @Nom pour ping"} maxLength={10000} rows={2} />
                <footer>
                  <div>
                    <button type="button" onClick={() => fileInput.current?.click()}>＋ Fichier</button>
                    <select aria-label="Joindre un fichier existant" defaultValue=""
                      onChange={(event) => {
                        const resource = library.find((item) => item.id === event.currentTarget.value);
                        if (resource) setPendingResources((current) => current.some((item) => item.id === resource.id) ? current : [...current, resource]);
                        event.currentTarget.value = "";
                      }}>
                      <option value="">Joindre depuis l’espace…</option>
                      {library.filter((item) => item.status === "available").map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
                    </select>
                    <input ref={fileInput} hidden multiple type="file"
                      onChange={(event) => void upload(Array.from(event.currentTarget.files ?? []))} />
                  </div>
                  <button className="primary-button small" type="submit">Envoyer</button>
                </footer>
                <div className="mention-shortcuts">
                  <span>Ping :</span>{members.slice(0, 8).map((member) => (
                    <button type="button" key={member.userId} onClick={() => mention(member)}>@{member.displayName}</button>
                  ))}
                </div>
              </form>
            )}
          </>
        ) : <div className="chat-no-channel"><span>✦</span><h2>Choisissez ou créez un salon</h2><p>Texte, médias, vocal et partage d’écran sont réunis ici.</p></div>}
      </section>
    </section>
  );
}

function RemoteMedia({ stream }: { stream: MediaStream }) {
  const element = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (element.current) element.current.srcObject = stream; }, [stream]);
  return <video className="remote-media" ref={element} autoPlay playsInline />;
}

function ScreenPreview({ stream }: { stream: MediaStream }) {
  const element = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (element.current) element.current.srcObject = stream; }, [stream]);
  return <div className="screen-preview"><video ref={element} autoPlay muted playsInline /><span>Votre écran est partagé</span></div>;
}
