[**English**](README.md) | [Français](README.fr.md)

# CyTask Desktop

Electron client for Windows, Linux and macOS. It connects to a remote CyTask instance or starts a self-contained local engine from a folder. It remembers up to twenty workspaces: HTTPS domains, local IP addresses or Syncthing-compatible local projects.

English is the default interface language. French can be selected with the persistent **EN / FR** control.

## Development

```powershell
Push-Location apps/client
npm ci
npm run check
npm run dev
Pop-Location
```

For the server demo, use `http://127.0.0.1:5173` and explicitly accept the HTTP warning. A production team instance must use HTTPS.

## Local and Sync mode

The **Local folder** selector starts the sidecar on `127.0.0.1` and creates the manifest, snapshots and `.stignore` file in the chosen folder. The same folder can be added to Syncthing or transported by the CyRevision Sync engine.

Build only the Web application and the current Windows sidecar:

```powershell
npm run server:win
```

## Distribution

```powershell
npm run dist:win
npm run dist:linux
npm run dist:mac
```

These commands build the Web application, publish the self-contained .NET sidecar for the target platform and include it in the Electron resources. Artifacts are written to `apps/client/release`: portable and NSIS on Windows, AppImage and DEB on Linux, DMG and ZIP on macOS. Each platform should ideally be built and signed on its native operating system.

## Security

- the local selector uses the private `cytask-client://` protocol and a strict CSP;
- CyTask content opens in a separate window without preload or Node APIs;
- `nodeIntegration` and WebViews are disabled while context isolation and the Chromium sandbox remain enabled;
- navigation and new windows outside the approved origin are sent to the system browser;
- every remote origin or local folder gets a separate persistent cookie partition;
- the local sidecar listens only on `127.0.0.1` and a free port;
- camera, microphone, notifications, fullscreen and CyTask window sharing are granted only to the exact trusted origin;
- invalid TLS certificates are never bypassed;
- `servers.json` contains only names, URLs or folder paths, never passwords or tokens;
- the device identity remains outside the synchronized folder;
- shutdown allows the periodic snapshot to make the last mutation durable before stopping the sidecar.

See also [Local mode and folder synchronization](../../docs/09-mode-local-sync.md).
