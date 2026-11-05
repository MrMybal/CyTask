---
id: permissions
title: Members, roles and project access
section: Team collaboration
order: 13
revision: 1
---

Permissions are enforced by the server, not just by hiding buttons. A copied task URL, resource identifier or chat preview must still pass access checks.

## Roles {#roles}
| Role | Typical responsibility |
| --- | --- |
| Owner | Owns the workspace and its administrative configuration |
| Admin | Manages members, projects and administrative features |
| Member | Participates and edits permitted project work |
| Viewer | Reads permitted work without normal write actions |

A project can inherit workspace access or use an explicit private membership list. Organization administrators retain administrative project access. Private chat groups additionally check their participants.

## Configure safely {#configure-safely}
Manage members from the team and project settings. Verify access with a separate member or viewer account after changing project visibility. Do not test only with the owner account, which naturally has broader rights.

Invitation and agent tokens are credentials. Use the intended invitation flow for people; create a dedicated scoped agent identity for automation instead of sharing a personal administrator account.

## Scope and limits {#scope-and-limits}
Project permissions are not a full channel-by-channel deny/allow matrix. Categories and folders organize content but do not automatically create independent security boundaries.

A local shared-folder workspace trusts access to its data folder. Filesystem or synchronization access is outside the protection of the Web interface’s role controls.

If a button is unavailable or the server returns a forbidden response, first check membership, role and private-group participation. See [troubleshooting](doc:troubleshooting) and [agents](doc:agents-api).
