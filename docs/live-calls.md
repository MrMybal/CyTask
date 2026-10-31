# Live voice, video and screen sharing

Open a voice/video room and choose **Join voice** or **Join video**. Camera and
screen are independent, so a participant can share both at once. Controls include
microphone mute, incoming-audio deafen, camera on/off, screen sharing, full-screen
display, input-device selection and a manual connection retry. Leaving the room,
changing rooms or losing access closes peer connections and releases captures.
Cancelling a pending permission request also releases any capture that arrives late.

The Web client and the Electron client use the same call implementation. Electron
asks before granting microphone/camera access to the trusted server, and uses the
system screen picker where supported, or an explicit screen/window chooser.
Microphone/camera permissions are not an automatic grant to every connected site.

## Connectivity

Serve remote clients over HTTPS and proxy the same-origin
`/api/v1/chat/channels/{channelId}/signal` WebSocket upgrade. Loopback HTTP is
supported for local development. The Vite development proxy forwards WebSockets.
With TLS terminated at a reverse proxy, set `CyTask__WebRtcPublicOrigin` to the exact
public HTTPS origin and allow that host through `AllowedHosts`. Docker Compose
exposes this as `CYTASK_PUBLIC_ORIGIN`. Keep the application port private: arbitrary
`X-Forwarded-*` headers are not trusted as a substitute for this origin setting.
No public STUN/TURN provider is contacted by default. With empty ICE-server lists,
connectivity is limited to networks where direct host candidates can connect.

Configure these server options through environment variables or private deployment
configuration, not the frontend:

| Option | Default | Meaning |
| --- | --- | --- |
| `CyTask__WebRtcPublicOrigin` | unset | Exact public HTTPS origin when TLS is terminated by a proxy. |
| `CyTask__WebRtcStunUrls__0` | unset | Your `stun:host:port` or `stuns:host:port` URL; add indexed entries as needed. |
| `CyTask__WebRtcTurnUrls__0` | unset | Your `turn:host:port?transport=udp` or `turns:host:port?transport=tcp` URL. |
| `CyTask__WebRtcTurnSharedSecret` | unset | 32–1024-character secret shared with your TURN service. |
| `CyTask__WebRtcTurnCredentialSeconds` | `3600` | Temporary credential lifetime, from 300 to 86400 seconds. |
| `CyTask__WebRtcRelayOnly` | `false` | Require TURN relay candidates; startup fails if no TURN URL is configured. |
| `CyTask__CallMaxParticipants` | `8` | Per-room connected-tab limit, from 2 to 16. |
| `CyTask__CallAccessCheckSeconds` | `15` | Session and channel/project access revalidation interval, from 1 to 60 seconds. |

TURN URLs require the shared secret. Credentials follow the coturn TURN REST
format: an expiry-prefixed, user/channel-scoped username and an HMAC-derived
temporary password. The shared secret is never included in the client response.
Clients renew the temporary configuration before expiry. Configure coturn with
`use-auth-secret`, a matching `static-auth-secret`, your realm, certificates and
appropriate relay address/port/firewall settings. Deploying CyTask does not install
or configure a TURN server automatically. See the
[coturn configuration reference](https://github.com/coturn/coturn/blob/master/README.turnserver).

Direct peer connections can reveal network addresses to other call participants.
Use `WebRtcRelayOnly` if your deployment requires relay-only routing; this needs a
working TURN service and consumes relay bandwidth. Temporary TURN credentials are
usable by authorized participants until expiry, even if they subsequently lose
project access. Do not treat username scoping as a TURN-side channel ACL.

## Authorization and limits

Call configuration and signaling require a browser session, channel membership
and a writable project role. API tokens and read-only viewers cannot join. Signaling
checks the WebSocket origin and revalidates access during the call. Revoked sessions,
removed channel members and roles downgraded to viewer are disconnected on the next
check. The shared call-start limit is 120 requests/minute per source IP, separate
from authentication attempt limits; individual signal frames are also bounded.

This is a small-group mesh: each participant sends media to every other participant.
Eight connected tabs is the default ceiling, not a performance guarantee. Bandwidth
and CPU grow with participant count; there is no SFU, recording, streaming broadcast,
screen-system-audio capture or background-call persistence across room navigation.
The signaling hub is in-process. Use one server process for calls; deployments with
multiple replicas need shared room routing/signaling before they can support calls
reliably. TURN relays media but does not solve that signaling limitation.

Camera/microphone/screen support depends on browser, OS and permission settings.
System audio is deliberately excluded from screen captures. If autoplay is blocked,
use the displayed **Enable audio** or **Play video** control. Device permissions,
cross-network TURN operation and supported desktop platforms need deployment-specific
testing on real machines; simulated tests do not validate these environments.

## Automated regression test

Build the Release server and Web client first, then run:

```text
dotnet build CyTask.slnx --configuration Release
npm ci --prefix apps/web
npm run build --prefix apps/web
npx --prefix apps/web playwright install chromium
npm run test:calls --prefix apps/web
```

The smoke test launches its own loopback server with an isolated in-memory workspace
and fictional members. It uses only synthetic microphones, synthetic cameras and a
canvas-generated display stream, never physical devices or the desktop. On Windows,
`CYTASK_TEST_BROWSER=msedge` selects an already installed Edge instead of downloaded
Chromium. Generated screenshots stay under ignored `.build/call-tests/`.
