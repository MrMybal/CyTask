---
id: mfa
title: Two-factor authentication
order: 18
description: Enroll an authenticator or email factor and keep recovery codes.
section: Server
parent: administration
revision: 2
---

The server administrator chooses whether two-factor authentication is disabled, optional or required. You manage your factors in Settings and tools → Account security.

## Enroll an authenticator {#enroll-an-authenticator}
Choose authenticator setup, confirm your password and scan the QR code with a compatible app such as Google Authenticator. You can also enter the displayed setup key manually. Enter the current six-digit code to finish.

Codes change every 30 seconds. Keep device and server clocks synchronized. The QR code is generated in the browser; this method does not require a Google account connection.

## Email and recovery {#email-and-recovery}
Email codes are available only when the server permits them and its TLS mail delivery is configured. Use the newest code after a resend; codes expire. A mail failure does not bypass the second factor.

Enrollment or regeneration displays single-use recovery codes once. Store them privately outside CyTask, preferably in a password manager. Regenerating them invalidates previous codes.

To replace a lost authenticator, sign in with an unused recovery code and use account security to replace the factor. Management can require your password and another valid proof. There is no unauthenticated reset or automatic administrator bypass.

## Policy and sessions {#policy-and-sessions}
Required policy prevents access until enrollment succeeds and prevents removing the last usable factor. Optional policy still requires the second factor on later logins once enrolled. A retained valid session does not ask for a new code on every refresh; there is no separate remembered-device bypass.

Pure local solo mode uses its local handshake rather than interactive MFA. API and agent tokens are separate credentials and are not protected by a TOTP prompt on each call.

Administrators should see [administration](doc:administration). For failed codes see [troubleshooting](doc:troubleshooting).
