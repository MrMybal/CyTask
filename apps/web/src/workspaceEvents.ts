// Keep one resumable SSE connection per renderer, even when several panes listen.
let source: EventSource | undefined;
let consumers = 0;

export function createWorkspaceEventStream() {
  const current = source ??= new EventSource("/api/v1/events");
  consumers++;
  const listeners: Array<[string, EventListenerOrEventListenerObject]> = [];
  let closed = false;
  return {
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      if (closed) return;
      current.addEventListener(type, listener);
      listeners.push([type, listener]);
    },
    close() {
      if (closed) return;
      closed = true;
      for (const [type, listener] of listeners) current.removeEventListener(type, listener);
      if (--consumers === 0) { current.close(); source = undefined; }
    }
  };
}
