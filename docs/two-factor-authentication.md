# Two-factor authentication

CyTask supports time-based authenticator codes (TOTP) and email verification codes.
The server administrator chooses the policy; individual users manage their factors
under **Settings and tools → Account security · Two-factor authentication**. The same
Web flow is used by the desktop client when connecting to a team server.

Serve team installations over HTTPS. Production authentication cookies are Secure;
plain HTTP is for explicitly local development, not a remote team deployment.

## Server policy

| `CyTask__MfaPolicy` | Behavior |
| --- | --- |
| `disabled` (default) | No interactive second-factor requirement; factor setup is unavailable. Existing factor records are retained. |
| `optional` | Users can enroll themselves. Once enrolled, their interactive logins require a second factor. |
| `required` | Every interactive user must enroll before entering the workspace, including the first owner and invited members. The last usable factor cannot be disabled. |

Pure local solo workspaces (`LocalMode=true`) do not use MFA; they still require the
existing loopback/local-access-key handshake. Do not expose a solo-mode process as a
team server. Passwordless automation members and scoped API tokens remain separate
non-interactive credentials, not interactive MFA sessions. Protect and rotate these
tokens separately; MFA does not turn a stolen API token into a second-factor challenge.

By default only authenticator setup is allowed when MFA is enabled. Use
`CyTask__MfaAuthenticatorEnabled=true|false` and `CyTask__MfaEmailEnabled=true|false`
to select the allowed methods. At least one method must be available when the policy
is enabled. Enabling email requires valid SMTP settings. Invalid combinations fail
server startup instead of silently falling back to password-only authentication.

## Persistent encryption and SMTP

PostgreSQL migration 31 must be applied before enabling the policy on an existing
installation. For persistent server storage, enabling MFA requires `CyTask__MfaEncryptionKey`, a
random, base64-encoded **32-byte key**. Generate it with a cryptographically secure
secret-management tool, inject it into the server environment and retain it across
restarts alongside protected database backups. It is separate from
`CyTask__PluginSecretKey`; both settings keep their existing purposes. Never replace
the MFA key casually: existing authenticator secrets would become unreadable.
In-memory development workspaces use an ephemeral key and lose account/factor state
when their server exits. Local solo snapshots do not contain MFA material.

| Server setting | Default / requirement |
| --- | --- |
| `CyTask__MfaIssuer` | `CyTask`; label shown in authenticator apps. |
| `CyTask__SmtpHost` | Required when email codes are enabled. |
| `CyTask__SmtpPort` | `587`. |
| `CyTask__SmtpSecurity` | `StartTls` (mandatory upgrade) or `SslOnConnect` (commonly port 465). No plaintext fallback. |
| `CyTask__SmtpFrom` | Required sender email address. |
| `CyTask__SmtpUsername` / `CyTask__SmtpPassword` | Both supplied for authenticated SMTP, or both omitted for an administratively controlled TLS relay. |

Docker Compose maps the equivalent `CYTASK_MFA_*` and `CYTASK_SMTP_*` variables from
`infra/.env.example`; supply their deployment-specific values through your secret manager.
The SMTP server must permit the configured sender and have a valid TLS certificate.
Configure DNS/delivery policy with your mail provider and test delivery before
requiring email MFA for a real team. A delivery failure blocks verification; it
never opens a password-only session. External mail delivery still needs validation
with the deployment's real SMTP service.

## Enrollment and recovery

Authenticator enrollment generates the QR code inside the browser, without an
external QR-image provider. The provisioning URI uses the Google Authenticator
compatible [key URI format](https://github.com/google/google-authenticator/wiki/Key-Uri-Format):
SHA-1 TOTP, six digits, 30-second periods. A manually enterable setup key is also
shown. A Google account or an OAuth connection is not required by CyTask for this
method. Keep server and device clocks synchronized; the verifier accepts at most
one adjacent time step and rejects an already accepted step for that account.

Email enrollment verifies the account's existing email address before enabling the
factor. Email codes expire within five minutes; resending is limited to once per
minute per account and invalidates the previous email code in that challenge. Email
MFA depends on the security of the mailbox and is generally weaker than a separate
authenticator. See the [OWASP MFA guidance](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html).

Enabling/replacing a factor or regenerating recovery codes displays ten random
single-use recovery codes. They are shown only once, with explicit copy/download
controls. Store them in a password manager or another private location. Changing a
factor or regenerating codes invalidates previous recovery codes and old interactive
sessions/native access proofs; the current flow receives a new session. Management
requires the current password and an existing factor when one is configured.

Lost authenticators can be replaced after signing in with a recovery code; another
unused code can confirm the replacement action. There is no automatic administrator
bypass or unauthenticated reset endpoint. Disabling server-wide MFA weakens access
for the entire installation; it is not an ordinary per-account recovery procedure.

## Protocol and storage

`POST /api/v1/sessions`, `/bootstrap` and `/invitations/accept` return either the
normal session or `{ "mfaRequired": true, "challenge": { ... } }`. A pending challenge
is not a session and cannot access projects, mint API tokens or authorize a native
client. Challenge tokens are bound to a Strict/HttpOnly browser cookie, stay out of
URLs. The UI holds its copy only in page memory. Reloading resumes through
`GET /api/v1/auth/mfa/pending`. Responses use `Cache-Control: no-store`.

`POST /api/v1/auth/mfa/advance` takes `{ token, operation, method?, code? }`:

- `operation: "method"` chooses `totp` or `email` during enrollment.
- `operation: "email"` sends/resends an email code when permitted.
- `operation: "verify"` submits `totp`, `email` or `recovery` verification.

The response is a new challenge or `{ "kind": "complete", "session": { ... },
"recoveryCodes": [] }`. Cancellation uses `POST /api/v1/auth/mfa/cancel` with the token.
Authenticated cookie-session users read `/api/v1/account/mfa` and start management
with `POST` `{ password, action }`, requiring the normal CSRF header. Actions are
`enable-totp`, `enable-email`, `disable-totp`, `disable-email`, and `recovery`.

Challenges expire after five minutes, allow at most five failed code attempts, and
are capped at three pending challenges per account. Ten failures within ten minutes
block further verification/login challenges for that window. Starting another
challenge does not reset the account failure budget. HTTP requests are also rate
limited. There is no remembered-device bypass; normal authenticated sessions retain
their configured lifetime, so refreshing the page does not ask for another code.

PostgreSQL migration 31 adds the server-only `account_mfa` table. Authenticator keys
are authenticated-encrypted and bound to the account, email codes have keyed/scoped
digests, and recovery codes are stored only as hashes. Per-account row locks make
code consumption, budget updates and proof/version changes atomic across processes.
MFA records are excluded from project exports and local/sync snapshots. Native PKCE
authorization transfers the verified session assurance rather than skipping MFA.
Already-running calls/SSE streams recheck proof validity while connected.

## Regression tests

The server suite includes RFC 6238 vectors, required/optional policies, enrollment,
cookie binding, TOTP replay, single-use recovery, concurrent recovery consumption,
session/native proof invalidation, expiry, attempt limits and failed email delivery.
Email tests use an injected in-memory mailbox and never send real messages.

After building Release server and Web assets, run `npm run test:mfa --prefix apps/web`
for the isolated browser flow; Playwright uses fictional accounts and blocks all
non-fixture HTTP traffic. `CYTASK_TEST_BROWSER=msedge` selects installed Edge on
Windows; otherwise install Playwright Chromium. Screenshots remain in ignored
`.build/mfa-tests/`. The PostgreSQL smoke test also checks factor persistence,
encryption, old-session denial and consumption of a recovery code.
