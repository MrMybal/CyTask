---
id: calls
title: Voice, video and screen sharing
order: 11
description: Join voice or video calls and share a screen independently of your camera.
section: Team
parent: chat
revision: 2
---

Voice and video rooms support live WebRTC calls. Joining is explicit: opening a room does not silently enable your microphone or camera.

## Join and control a call {#join-and-control-a-call}
1. Open a voice or video room and choose Join.
2. Allow microphone access when asked; allow the camera only if you want video.
3. Use mute, deafen, camera and device controls during the call.
4. Start screen sharing separately, then choose the screen or window in the browser’s native chooser.
5. Stop sharing or leave when finished. Changing rooms or closing the workspace ends the current call.

Camera and screen sharing are separate streams. Sharing a screen does not imply system-audio capture. Permission to view a project is not necessarily permission to join an interactive call.

## Network requirements {#network-requirements}
Remote deployments require HTTPS for browser media access. Loopback development has a browser-specific secure-context exception. The administrator may configure STUN/TURN servers, particularly for users behind different routers or restrictive networks.

Without a suitable relay, direct local calls may work while remote peers cannot connect. Check microphone permission first, then network and TURN configuration.

## Capacity and limits {#capacity-and-limits}
The implementation is a peer-to-peer mesh. The configured participant limit defaults to 8 and is capped at 16; it is not an SFU for large broadcasts. Each additional participant increases device and network load.

Recording, persistent background calls and guaranteed system-audio sharing are not provided. Screen content is visible to call participants: close unrelated windows and disable personal notifications before sharing.

For technical deployment details, see [administration](doc:administration); for failures, see [troubleshooting](doc:troubleshooting).
