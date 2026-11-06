---
id: team-server
title: Connect to a team server
order: 2
description: Connect to your team, accept an invitation and keep server sessions separate.
section: Start
parent: getting-started
revision: 2
---

A team server lets several people work with individual accounts. The server address and account must come from your administrator; the demonstration workspace is not a production account service.

## Connect {#connect}
1. In a browser, open the server URL. In desktop mode, add a server using its full address, including scheme and port when needed.
2. Use HTTPS outside an isolated local development environment.
3. Sign in, or accept an invitation and create your account if registration is offered.
4. Complete the second factor if required. Then select a project from the project rail.

An invitation can expire or already have been used. Ask for a replacement rather than reusing another member’s account.

## Retained sessions {#retained-sessions}
CyTask retains a valid session so that normal restarts do not always require the password. Signing out, revoking a session, changing server policy or reaching its expiration can invalidate it. Credentials for different server addresses are isolated in the desktop client.

Never place a token directly in a server URL, screenshot or shared room link. A room or task link identifies content; it does not grant access to it.

## First administrator {#first-administrator}
On a new deployment, follow the server’s initial-owner setup. Use a unique production password. Demo seed scripts and their accounts are for test environments only.

Configure the public address, allowed hosts, storage, database and mail before inviting a team. Validate HTTPS, backup recovery and permissions with a separate non-administrator account.

See [project permissions](doc:permissions), [two-factor authentication](doc:mfa) and [server administration](doc:administration).
