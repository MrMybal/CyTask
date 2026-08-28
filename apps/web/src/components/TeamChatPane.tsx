import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  api,
  type ChatChannel,
  type ChatMessage,
  type OrganizationMember,
  type ProjectResource,
  type TaskOption
} from "../api";
import { uploadProjectFile } from "../resourceUpload";
import { ChatMessageList } from "./ChatMessageList";
import { useVoiceRoom } from "./useVoiceRoom";
import { useI18n } from "../i18n";

interface Props {
  projectId: string;
  currentUserId: string;
  members: OrganizationMember[];
  canContribute: boolean;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  tasks: TaskOption[];
  onOpenTask: (taskId: string) => void;
}

export function TeamChatPane({
  projectId,
  currentUserId,
  members,
  canContribute,
  onError,
  onNotice,
  tasks,
  onOpenTask
}: Props) {
  const { locale, t } = useI18n();
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [library, setLibrary] = useState<ProjectResource[]>([]);
  const [pendingResources, setPendingResources] = useState<ProjectResource[]>([]);
  const [creatingChannel, setCreatingChannel] = useState(false);
  const [progress, setProgress] = useState<{ label: string; percent: number }>();
  const [newChannelType, setNewChannelType] = useState<"channel" | "group">("channel");
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
      onError(t("Unable to load channels."));
    }
  }, [onError, projectId, t]);

  const loadMessages = useCallback(async () => {
    if (!selectedChannelId) {
      setMessages([]);
      return;
    }
    try {
      setMessages(await api.chatMessages(selectedChannelId));
    } catch {
      onError(t("Unable to load messages."));
    }
  }, [onError, selectedChannelId, t]);

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
        topic: String(data.get("topic")),
        channelType: String(data.get("channelType")) as "channel" | "group",
        memberIds: data.getAll("memberIds").map(String)
      });
      setChannels((current) => [...current.filter((item) => item.id !== channel.id), channel]);
      setSelectedChannelId(channel.id);
      setCreatingChannel(false);
      setNewChannelType("channel");
      form.reset();
      onNotice(t(channel.channelType === "group" ? "Private group created." : "Channel created."));
    } catch {
      onError(t("Unable to create this channel."));
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedChannelId) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const body = String(data.get("body")).trim() || (pendingResources.length ? t("Shared file") : "");
    if (!body) return;
    const normalized = body.toLocaleLowerCase(locale);
    const mentionedUserIds = members
      .filter((member) => normalized.includes("@" + member.displayName.toLocaleLowerCase(locale)))
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
      onError(t("Unable to send this message."));
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
      onError(t("Unable to add this file to the message."));
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

  function linkTask(taskId: string) {
    const task = tasks.find((item) => item.id === taskId);
    const textarea = composer.current;
    if (!task || !textarea) return;
    const separator = textarea.value && !textarea.value.endsWith(" ") ? " " : "";
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}#/tasks/${task.id}`;
    textarea.value += `${separator}${task.key} · ${url} `;
    textarea.focus();
  }

  return (
    <section className="team-chat-pane">

      <aside className="chat-channels">
        <header><div><small>{t("DISCUSSIONS")}</small><strong>{t("Team channels")}</strong></div>
          {canContribute && <button type="button" onClick={() => setCreatingChannel(true)}>+</button>}</header>
        {creatingChannel && (
          <form onSubmit={createChannel}>
            <input name="name" placeholder={t("Channel name")} maxLength={80} required autoFocus />
            <select name="channelType" value={newChannelType}
              onChange={(event) => setNewChannelType(event.currentTarget.value as "channel" | "group")}>
              <option value="channel">{t("Public channel")}</option>
              <option value="group">{t("Private group")}</option>
            </select>
            {newChannelType === "group" && (
              <fieldset className="chat-group-members">
                <legend>{t("Group members")}</legend>
                {members.filter((member) => member.userId !== currentUserId).map((member) => (
                  <label key={member.userId}>
                    <input type="checkbox" name="memberIds" value={member.userId} />
                    <span>{member.displayName}</span>
                  </label>
                ))}
              </fieldset>
            )}
            <input name="topic" placeholder={t("Topic (optional)")} maxLength={500} />
            <button type="submit">{t("Create")}</button>
            <button type="button" onClick={() => setCreatingChannel(false)}>{t("Cancel")}</button>
          </form>
        )}
        <nav>
          {channels.map((channel) => (
            <button className={channel.id === selectedChannelId ? "active" : ""} type="button"
              key={channel.id} onClick={() => setSelectedChannelId(channel.id)}>
              <span>{channel.channelType === "group" ? "◉" : "#"}</span>
              <span><strong>{channel.name}</strong><small>
                {channel.topic || (channel.channelType === "group"
                  ? t("Private group") : t("Text and voice channel"))}
              </small></span>
            </button>
          ))}
        </nav>
        {channels.length === 0 && (
          <div className="channel-empty"><span>#</span><p>{t("Create the first channel for this project.")}</p>
            {canContribute && <button type="button" onClick={() => setCreatingChannel(true)}>{t("Create # general")}</button>}</div>
        )}
      </aside>

      <section className="chat-conversation">
        {selectedChannel ? (
          <>
            <header className="chat-room-header">
              <div>
                <h2>{selectedChannel.channelType === "group" ? "◉" : "#"} {selectedChannel.name}</h2>
                <p>{selectedChannel.topic || (selectedChannel.channelType === "group"
                  ? t("Private group · invited members only")
                  : t("Project discussion"))}</p>
              </div>
              <div className="voice-actions">
                {!voice.active ? (
                  <button type="button" onClick={() => void voice.join()}>◉ {t("Join voice")}</button>
                ) : (
                  <>
                    <span className="voice-live">● {t("Voice")} · {voice.remoteStreams.length + 1}</span>
                    <button type="button" onClick={() => void voice.toggleScreen()}>
                      {t(voice.screenStream ? "Stop sharing" : "Share screen")}
                    </button>
                    <button type="button" onClick={voice.leave}>{t("Leave")}</button>
                  </>
                )}
              </div>
            </header>
            {voice.screenStream && <ScreenPreview stream={voice.screenStream} />}
            {voice.remoteStreams.map(([peerId, stream]) => <RemoteMedia key={peerId} stream={stream} />)}
            <ChatMessageList messages={messages} members={members}
              currentUserId={currentUserId} tasks={tasks}
              onOpenTask={onOpenTask} />
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
                <textarea ref={composer} name="body" placeholder={t("Write in #{name} · use @Name to ping", { name: selectedChannel.name })} maxLength={10000} rows={2} />
                <footer>
                  <div>
                    <button type="button" onClick={() => fileInput.current?.click()}>＋ {t("File")}</button>
                    <select aria-label={t("Attach an existing file")} defaultValue=""
                      onChange={(event) => {
                        const resource = library.find((item) => item.id === event.currentTarget.value);
                        if (resource) setPendingResources((current) => current.some((item) => item.id === resource.id) ? current : [...current, resource]);
                        event.currentTarget.value = "";
                      }}>
                      <option value="">{t("Attach from workspace…")}</option>
                      {library.filter((item) => item.status === "available").map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
                    </select>
                    <select aria-label={t("Link a task")} defaultValue=""
                      onChange={(event) => {
                        linkTask(event.currentTarget.value);
                        event.currentTarget.value = "";
                      }}>
                      <option value="">{t("Link a task…")}</option>
                      {tasks.map((task) => (
                        <option value={task.id} key={task.id}>{task.key} · {task.title}</option>
                      ))}
                    </select>
                    <input ref={fileInput} hidden multiple type="file"
                      onChange={(event) => void upload(Array.from(event.currentTarget.files ?? []))} />
                  </div>
                  <button className="primary-button small" type="submit">{t("Send")}</button>
                </footer>
                <div className="mention-shortcuts">
                  <span>{t("Ping:")}</span>{members.slice(0, 8).map((member) => (
                    <button type="button" key={member.userId} onClick={() => mention(member)}>@{member.displayName}</button>
                  ))}
                </div>
              </form>
            )}
          </>
        ) : <div className="chat-no-channel"><span>✦</span><h2>{t("Choose or create a channel")}</h2><p>{t("Text, media, voice and screen sharing are all here.")}</p></div>}
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
  const { t } = useI18n();
  const element = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (element.current) element.current.srcObject = stream; }, [stream]);
  return <div className="screen-preview"><video ref={element} autoPlay muted playsInline /><span>{t("Your screen is being shared")}</span></div>;
}
